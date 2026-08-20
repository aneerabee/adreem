import { randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { chmod, mkdir, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import {
  BackupSafetyError,
  runCommand,
  s3ProcessEnv,
  sha256File,
  validateObjectPath,
} from './adreemBackupShared.js'

export const S3_SINGLE_UPLOAD_MAX_BYTES = 5 * 1024 * 1024 * 1024
export const S3_MULTIPART_MIN_PART_BYTES = 5 * 1024 * 1024
export const S3_MULTIPART_DEFAULT_PART_BYTES = 64 * 1024 * 1024
export const S3_MULTIPART_MAX_PARTS = 10_000

function parseJsonOutput(result, label) {
  try {
    return JSON.parse(result.stdout || '{}')
  } catch {
    throw new BackupSafetyError(`${label} returned invalid JSON.`, 'S3_INVALID_RESPONSE')
  }
}

export function buildS3UploadPlan(size, options = {}) {
  const bytes = Number(size)
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    throw new BackupSafetyError('The S3 upload size is invalid.', 'INVALID_UPLOAD_SIZE')
  }
  const singleUploadMaxBytes = Number(options.singleUploadMaxBytes || S3_SINGLE_UPLOAD_MAX_BYTES)
  if (bytes <= singleUploadMaxBytes) return { mode: 'single', bytes }

  const minimumPartBytes = Number(options.minimumPartBytes || S3_MULTIPART_MIN_PART_BYTES)
  const preferredPartBytes = Number(options.preferredPartBytes || S3_MULTIPART_DEFAULT_PART_BYTES)
  const requiredPartBytes = Math.ceil(bytes / S3_MULTIPART_MAX_PARTS)
  const partBytes = Math.ceil(Math.max(minimumPartBytes, preferredPartBytes, requiredPartBytes) / minimumPartBytes) * minimumPartBytes
  const partCount = Math.ceil(bytes / partBytes)
  if (!Number.isSafeInteger(partBytes) || partCount > S3_MULTIPART_MAX_PARTS) {
    throw new BackupSafetyError('The S3 object is too large for multipart upload.', 'BACKUP_OBJECT_TOO_LARGE')
  }
  return { mode: 'multipart', bytes, partBytes, partCount }
}

export function createAwsCliS3Client({ executable, config, env = process.env, secrets = [], command = runCommand }) {
  if (!executable) throw new BackupSafetyError('AWS CLI is required for S3 operations.', 'MISSING_TOOLS')
  const common = ['--endpoint-url', config.endpoint, '--region', config.region, 's3api']
  const commandOptions = (label, maxStdoutBytes) => ({
    env: s3ProcessEnv(config, env),
    label,
    secrets,
    ...(maxStdoutBytes ? { maxStdoutBytes } : {}),
  })
  const invoke = (operation, args, label, maxStdoutBytes) => command(
    executable,
    [...common, operation, '--bucket', config.bucket, ...args, '--output', 'json'],
    commandOptions(label, maxStdoutBytes),
  )

  return {
    async assertEmpty() {
      const result = await invoke('list-objects-v2', ['--max-keys', '1'], 'S3 target bucket preflight')
      const payload = parseJsonOutput(result, 'S3 target bucket preflight')
      if (Number(payload.KeyCount || 0) !== 0 || (payload.Contents || []).length !== 0) {
        throw new BackupSafetyError('The restore attachment bucket is not empty.', 'RESTORE_STORAGE_NOT_EMPTY')
      }
    },
    async putObject({ key, filePath, sha256 }) {
      const result = await invoke('put-object', [
        '--key', validateObjectPath(key),
        '--body', filePath,
        '--if-none-match', '*',
        '--metadata', `sha256=${sha256}`,
      ], 'conditional S3 upload')
      return { versionId: String(parseJsonOutput(result, 'conditional S3 upload').VersionId || '') }
    },
    async createMultipartUpload({ key, sha256 }) {
      const result = await invoke('create-multipart-upload', [
        '--key', validateObjectPath(key),
        '--metadata', `sha256=${sha256}`,
      ], 'S3 multipart creation')
      const uploadId = String(parseJsonOutput(result, 'S3 multipart creation').UploadId || '')
      if (!uploadId) throw new BackupSafetyError('S3 did not return a multipart upload id.', 'S3_INVALID_RESPONSE')
      return uploadId
    },
    async uploadPart({ key, uploadId, partNumber, filePath }) {
      const result = await invoke('upload-part', [
        '--key', validateObjectPath(key),
        '--upload-id', uploadId,
        '--part-number', String(partNumber),
        '--body', filePath,
      ], `S3 multipart part ${partNumber}`)
      const etag = String(parseJsonOutput(result, `S3 multipart part ${partNumber}`).ETag || '')
      if (!etag) throw new BackupSafetyError('S3 did not return a multipart part ETag.', 'S3_INVALID_RESPONSE')
      return etag
    },
    async completeMultipartUpload({ key, uploadId, parts }) {
      const result = await invoke('complete-multipart-upload', [
        '--key', validateObjectPath(key),
        '--upload-id', uploadId,
        '--multipart-upload', JSON.stringify({ Parts: parts }),
        '--if-none-match', '*',
      ], 'S3 multipart completion', 4 * 1024 * 1024)
      return { versionId: String(parseJsonOutput(result, 'S3 multipart completion').VersionId || '') }
    },
    async abortMultipartUpload({ key, uploadId }) {
      await invoke('abort-multipart-upload', [
        '--key', validateObjectPath(key),
        '--upload-id', uploadId,
      ], 'S3 multipart rollback')
    },
    async downloadObject({ key, filePath }) {
      await invoke('get-object', [
        '--key', validateObjectPath(key),
        filePath,
      ], 'S3 upload content verification')
      await chmod(filePath, 0o600)
    },
    async deleteObject(key, versionId = '') {
      await invoke('delete-object', [
        '--key', validateObjectPath(key),
        ...(versionId ? ['--version-id', versionId] : []),
      ], 'S3 upload rollback')
    },
  }
}

async function writePartFile(sourcePath, destination, start, length) {
  await pipeline(
    createReadStream(sourcePath, { start, end: start + length - 1 }),
    createWriteStream(destination, { flags: 'wx', mode: 0o600 }),
  )
  await chmod(destination, 0o600)
}

async function rollbackObject(client, key, versionId, originalError) {
  try {
    await client.deleteObject(key, versionId)
  } catch (rollbackError) {
    const error = new BackupSafetyError(
      `S3 upload failed and rollback also failed: ${rollbackError?.message || 'unknown rollback error'}`,
      'S3_UPLOAD_ROLLBACK_FAILED',
    )
    error.cause = originalError
    throw error
  }
}

export async function uploadFileWithVerification({
  client,
  localPath,
  key,
  workDirectory,
  rollbackCompletedObject = true,
  uploadPlanOptions,
}) {
  const objectKey = validateObjectPath(key)
  const details = await stat(localPath)
  if (!details.isFile()) throw new BackupSafetyError('The S3 upload source is not a regular file.', 'INVALID_UPLOAD_FILE')
  const sha256 = await sha256File(localPath)
  const plan = buildS3UploadPlan(details.size, uploadPlanOptions)
  let uploadId = ''
  let completed = false
  let versionId = ''
  let partPath = ''
  let verificationPath = ''

  try {
    if (plan.mode === 'single') {
      const uploaded = await client.putObject({ key: objectKey, filePath: localPath, size: details.size, sha256 })
      versionId = String(uploaded?.versionId || '')
      completed = true
    } else {
      if (!workDirectory) throw new BackupSafetyError('Multipart upload requires a private work directory.', 'MISSING_UPLOAD_WORK_DIR')
      await mkdir(workDirectory, { recursive: true, mode: 0o700 })
      uploadId = await client.createMultipartUpload({ key: objectKey, size: details.size, sha256 })
      const parts = []
      for (let index = 0; index < plan.partCount; index += 1) {
        const partNumber = index + 1
        const start = index * plan.partBytes
        const length = Math.min(plan.partBytes, details.size - start)
        partPath = join(workDirectory, `s3-part-${String(partNumber).padStart(5, '0')}`)
        await writePartFile(localPath, partPath, start, length)
        const etag = await client.uploadPart({ key: objectKey, uploadId, partNumber, filePath: partPath, size: length })
        parts.push({ ETag: etag, PartNumber: partNumber })
        await rm(partPath, { force: true })
        partPath = ''
      }
      const uploaded = await client.completeMultipartUpload({ key: objectKey, uploadId, parts, size: details.size, sha256 })
      versionId = String(uploaded?.versionId || '')
      completed = true
      uploadId = ''
    }

    const verificationDirectory = workDirectory || dirname(localPath)
    await mkdir(verificationDirectory, { recursive: true, mode: 0o700 })
    verificationPath = join(verificationDirectory, `s3-verify-${randomUUID()}`)
    await client.downloadObject({ key: objectKey, filePath: verificationPath })
    const remoteDetails = await stat(verificationPath)
    const remoteSha256 = remoteDetails.isFile() ? await sha256File(verificationPath) : ''
    if (!remoteDetails.isFile() || remoteDetails.size !== details.size || remoteSha256 !== sha256) {
      const mismatch = new BackupSafetyError(
        'Downloaded object size or SHA-256 does not match the local file.',
        'S3_VERIFICATION_FAILED',
      )
      completed = false
      await rollbackObject(client, objectKey, versionId, mismatch)
      throw mismatch
    }
    return { key: objectKey, size: details.size, sha256, uploadMode: plan.mode, versionId }
  } catch (error) {
    if (uploadId) {
      try {
        await client.abortMultipartUpload({ key: objectKey, uploadId })
      } catch (rollbackError) {
        const rollbackFailure = new BackupSafetyError(
          `Multipart upload failed and abort also failed: ${rollbackError?.message || 'unknown rollback error'}`,
          'S3_UPLOAD_ROLLBACK_FAILED',
        )
        rollbackFailure.cause = error
        throw rollbackFailure
      }
    }
    if (completed && rollbackCompletedObject) {
      completed = false
      await rollbackObject(client, objectKey, versionId, error)
    }
    throw error
  } finally {
    if (partPath) await rm(partPath, { force: true })
    if (verificationPath) await rm(verificationPath, { force: true })
  }
}

export async function uploadFilesWithRollback({ client, files, workDirectory, uploadPlanOptions }) {
  const uploaded = []
  try {
    for (const file of files) {
      uploaded.push(await uploadFileWithVerification({
        client,
        localPath: file.path,
        key: file.relativePath,
        workDirectory,
        uploadPlanOptions,
      }))
    }
    return uploaded
  } catch (error) {
    await rollbackUploadedObjects(client, uploaded, error)
  }
}

export async function rollbackUploadedObjects(client, uploaded, originalError) {
  const rollbackErrors = []
  for (const item of [...uploaded].reverse()) {
    try {
      await client.deleteObject(item.key, item.versionId)
    } catch (rollbackError) {
      rollbackErrors.push(`${item.key}: ${rollbackError?.message || 'delete failed'}`)
    }
  }
  if (rollbackErrors.length) {
    const rollbackFailure = new BackupSafetyError(
      `Attachment upload rollback failed for ${rollbackErrors.join(', ')}`,
      'S3_UPLOAD_ROLLBACK_FAILED',
    )
    rollbackFailure.cause = originalError
    throw rollbackFailure
  }
  throw originalError
}
