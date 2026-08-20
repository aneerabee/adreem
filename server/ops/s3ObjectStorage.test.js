import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  S3_SINGLE_UPLOAD_MAX_BYTES,
  buildS3UploadPlan,
  createAwsCliS3Client,
  uploadFileWithVerification,
  uploadFilesWithRollback,
} from './s3ObjectStorage.js'

const temporaryDirectories = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function temporaryDirectory() {
  const path = await mkdtemp(join(tmpdir(), 'adreem-s3-test-'))
  temporaryDirectories.push(path)
  return path
}

function fakeStorageClient(options = {}) {
  const objects = new Map()
  const multipart = new Map()
  let uploadCounter = 0
  return {
    objects,
    multipart,
    putObject: vi.fn(async ({ key, filePath, sha256 }) => {
      objects.set(key, { bytes: await readFile(filePath), sha256 })
    }),
    createMultipartUpload: vi.fn(async ({ key, sha256 }) => {
      const uploadId = `upload-${++uploadCounter}`
      multipart.set(uploadId, { key, sha256, parts: [] })
      return uploadId
    }),
    uploadPart: vi.fn(async ({ uploadId, partNumber, filePath }) => {
      if (options.failPart === partNumber) throw new Error('simulated part failure')
      const bytes = await readFile(filePath)
      multipart.get(uploadId).parts[partNumber - 1] = bytes
      return `etag-${partNumber}`
    }),
    completeMultipartUpload: vi.fn(async ({ uploadId }) => {
      const upload = multipart.get(uploadId)
      objects.set(upload.key, { bytes: Buffer.concat(upload.parts), sha256: upload.sha256 })
      multipart.delete(uploadId)
    }),
    abortMultipartUpload: vi.fn(async ({ uploadId }) => multipart.delete(uploadId)),
    downloadObject: vi.fn(async ({ key, filePath }) => {
      const object = objects.get(key)
      if (!object) throw new Error('missing object')
      await writeFile(filePath, object.bytes)
    }),
    deleteObject: vi.fn(async (key) => objects.delete(key)),
  }
}

describe('S3 object upload execution', () => {
  it('builds conditional AWS CLI requests for single and multipart uploads', async () => {
    const directory = await temporaryDirectory()
    const downloaded = join(directory, 'downloaded.bin')
    const command = vi.fn()
      .mockResolvedValueOnce({ stdout: '{"VersionId":"version-1"}' })
      .mockResolvedValueOnce({ stdout: '{"UploadId":"upload-1"}' })
      .mockResolvedValueOnce({ stdout: '{"ETag":"etag-1"}' })
      .mockResolvedValueOnce({ stdout: '{"VersionId":"version-2"}' })
      .mockImplementationOnce(async () => {
        await writeFile(downloaded, 'downloaded')
        return { stdout: '{}' }
      })
      .mockResolvedValueOnce({ stdout: '{}' })
    const client = createAwsCliS3Client({
      executable: '/usr/bin/aws',
      config: {
        endpoint: 'https://objects.example.com',
        bucket: 'restore-bucket',
        region: 'us-east-1',
        accessKeyId: 'access-key',
        secretAccessKey: 'secret-key',
      },
      env: { PATH: '/usr/bin' },
      secrets: ['access-key', 'secret-key'],
      command,
    })

    await client.putObject({ key: 'owner/file.bin', filePath: '/tmp/file.bin', sha256: 'abc' })
    const uploadId = await client.createMultipartUpload({ key: 'owner/large.bin', sha256: 'def' })
    const etag = await client.uploadPart({ key: 'owner/large.bin', uploadId, partNumber: 1, filePath: '/tmp/part-1' })
    await client.completeMultipartUpload({ key: 'owner/large.bin', uploadId, parts: [{ ETag: etag, PartNumber: 1 }] })
    await client.downloadObject({ key: 'owner/file.bin', filePath: downloaded })
    await client.deleteObject('owner/file.bin', 'version-1')

    expect(command.mock.calls[0][1]).toEqual(expect.arrayContaining([
      'put-object', '--bucket', 'restore-bucket', '--key', 'owner/file.bin',
      '--if-none-match', '*', '--metadata', 'sha256=abc',
    ]))
    expect(command.mock.calls[3][1]).toEqual(expect.arrayContaining([
      'complete-multipart-upload', '--upload-id', 'upload-1', '--if-none-match', '*',
    ]))
    expect(command.mock.calls[4][1]).toEqual(expect.arrayContaining([
      'get-object', '--key', 'owner/file.bin', downloaded,
    ]))
    expect(command.mock.calls[5][1]).toEqual(expect.arrayContaining([
      'delete-object', '--key', 'owner/file.bin', '--version-id', 'version-1',
    ]))
  })

  it('selects multipart upload for artifacts larger than 5 GiB without allocating them', () => {
    const plan = buildS3UploadPlan(S3_SINGLE_UPLOAD_MAX_BYTES + 1)
    expect(plan.mode).toBe('multipart')
    expect(plan.partCount).toBeGreaterThan(1)
    expect(plan.partCount).toBeLessThanOrEqual(10_000)
  })

  it('downloads and hashes a single-part upload before accepting it', async () => {
    const directory = await temporaryDirectory()
    const source = join(directory, 'artifact.bin')
    const workDirectory = join(directory, 'verification')
    await writeFile(source, Buffer.from('single-adreem-artifact'))
    const client = fakeStorageClient()

    const result = await uploadFileWithVerification({
      client,
      localPath: source,
      key: 'backups/artifact.bin',
      workDirectory,
    })

    expect(result.uploadMode).toBe('single')
    expect(client.putObject).toHaveBeenCalledOnce()
    expect(client.downloadObject).toHaveBeenCalledWith({
      key: 'backups/artifact.bin',
      filePath: expect.stringContaining('s3-verify-'),
    })
    expect(await readdir(workDirectory)).toEqual([])
  })

  it('executes multipart upload and verifies the reconstructed SHA-256 and size', async () => {
    const directory = await temporaryDirectory()
    const source = join(directory, 'artifact.bin')
    const workDirectory = join(directory, 'parts')
    await writeFile(source, Buffer.from('multipart-adreem-artifact'))
    const client = fakeStorageClient()

    const result = await uploadFileWithVerification({
      client,
      localPath: source,
      key: 'backups/artifact.bin',
      workDirectory,
      uploadPlanOptions: { singleUploadMaxBytes: 4, minimumPartBytes: 5, preferredPartBytes: 5 },
    })

    expect(result.uploadMode).toBe('multipart')
    expect(client.uploadPart).toHaveBeenCalledTimes(5)
    expect(client.completeMultipartUpload).toHaveBeenCalledOnce()
    expect(client.downloadObject).toHaveBeenCalledWith({
      key: 'backups/artifact.bin',
      filePath: expect.stringContaining('s3-verify-'),
    })
    expect(await readdir(workDirectory)).toEqual([])
  })

  it.each([
    ['single', {}],
    ['multipart', { singleUploadMaxBytes: 4, minimumPartBytes: 5, preferredPartBytes: 5 }],
  ])('deletes a %s upload when downloaded content has the wrong SHA-256', async (_mode, uploadPlanOptions) => {
    const directory = await temporaryDirectory()
    const source = join(directory, 'artifact.bin')
    await writeFile(source, Buffer.from('corruption-check'))
    const client = fakeStorageClient()
    client.downloadObject.mockImplementationOnce(async ({ filePath }) => {
      await writeFile(filePath, Buffer.from('corrupted-object'))
    })

    await expect(uploadFileWithVerification({
      client,
      localPath: source,
      key: 'backups/artifact.bin',
      workDirectory: join(directory, 'verification'),
      rollbackCompletedObject: false,
      uploadPlanOptions,
    })).rejects.toMatchObject({ code: 'S3_VERIFICATION_FAILED' })

    expect(client.deleteObject).toHaveBeenCalledWith('backups/artifact.bin', '')
    expect(client.objects.size).toBe(0)
  })

  it('aborts an incomplete multipart upload when a part fails', async () => {
    const directory = await temporaryDirectory()
    const source = join(directory, 'artifact.bin')
    await writeFile(source, Buffer.from('multipart-adreem-artifact'))
    const client = fakeStorageClient({ failPart: 2 })

    await expect(uploadFileWithVerification({
      client,
      localPath: source,
      key: 'backups/artifact.bin',
      workDirectory: join(directory, 'parts'),
      uploadPlanOptions: { singleUploadMaxBytes: 4, minimumPartBytes: 5, preferredPartBytes: 5 },
    })).rejects.toThrow('simulated part failure')

    expect(client.abortMultipartUpload).toHaveBeenCalledOnce()
    expect(client.multipart.size).toBe(0)
    expect(client.objects.size).toBe(0)
  })

  it('deletes every uploaded attachment when a later upload fails verification', async () => {
    const directory = await temporaryDirectory()
    const first = join(directory, 'first.bin')
    const second = join(directory, 'second.bin')
    await writeFile(first, 'first')
    await writeFile(second, 'second')
    const client = fakeStorageClient()
    client.downloadObject
      .mockImplementationOnce(async ({ key, filePath }) => writeFile(filePath, client.objects.get(key).bytes))
      .mockImplementationOnce(async ({ filePath }) => writeFile(filePath, 'broken'))

    await expect(uploadFilesWithRollback({
      client,
      files: [
        { path: first, relativePath: 'owner/ledger/first.bin' },
        { path: second, relativePath: 'owner/ledger/second.bin' },
      ],
      workDirectory: join(directory, 'parts'),
    })).rejects.toMatchObject({ code: 'S3_VERIFICATION_FAILED' })

    expect(client.deleteObject).toHaveBeenCalledWith('owner/ledger/second.bin', '')
    expect(client.deleteObject).toHaveBeenCalledWith('owner/ledger/first.bin', '')
    expect(client.objects.size).toBe(0)
  })
})
