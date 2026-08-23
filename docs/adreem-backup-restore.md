# ADREEM External Backup and Restore Drill

## Scope

These tools back up only the dedicated ADREEM PostgreSQL database and the configured ADREEM attachment bucket. They do not read application files, edit the database, delete remote objects, or overwrite an existing backup object.

The encrypted backup is written to an S3-compatible provider outside Contabo. The database archive and attachments are packaged together before encryption. The external provider sees only encrypted bytes plus a signed manifest containing counts and hashes, not attachment names.

## Required tools

- PostgreSQL client tools compatible with the server: `pg_dump`, `pg_restore`, and `psql`.
- AWS CLI v2 for S3-compatible reads and writes.
- `tar`.
- `age` is strongly recommended. When unavailable, the tool uses AES-256-GCM through Node's OpenSSL-backed cryptography.

The backup command fails before upload when a required tool or guard is missing. `--dry-run` performs no database connection, storage read, upload, download, or restore.

## Security model

- The database password is passed to PostgreSQL only through the child environment, never in process arguments or logs.
- Every real PostgreSQL connection requires `sslmode=verify-full` and an explicit readable CA file. The only exception is an explicit unit-test mode restricted to `NODE_ENV=test`, a loopback host, and `sslmode=disable`.
- The database host and name must match the explicit ADREEM guard variables.
- Database counts and `pg_dump` use the same exported PostgreSQL snapshot.
- PostgreSQL grants, revokes, policy roles, and default privileges are retained in the custom archive. Backup format version 2 also signs the complete referenced-role list.
- Attachment objects are read-only. Their inventory is compared before and after copying; a change aborts the backup.
- Every database-referenced attachment must exist in the copied bucket.
- The destination must use HTTPS and resolve to a public address outside the local/Contabo private network.
- `ADREEM_BACKUP_FORBIDDEN_HOSTS` must list the Contabo public and private addresses; the destination is rejected if its name resolves to one of them.
- Backup object names include a random identifier. Single uploads and multipart completion use `If-None-Match: *`, so an existing object cannot be overwritten.
- Objects up to 5 GiB use a conditional single upload. Larger artifacts use multipart upload with bounded temporary parts; any incomplete multipart session is aborted on failure.
- Every uploaded object records the local SHA-256 in object metadata. A following `HeadObject` must return the same SHA-256 and byte size.
- The encrypted artifact is authenticated. The manifest has a separate HMAC-SHA256 signature.
- Plaintext files exist only in a private temporary directory and are removed after success or failure.
- Restore refuses the source database and refuses any target containing user relations.
- Restore checks every signed role before running `pg_restore`; it never creates cluster roles automatically.
- Restore uses one PostgreSQL transaction and never calls `clean`, `drop`, or destructive synchronization against the database.
- Restore requires a separately guarded, empty attachment bucket. It uploads and verifies every attachment, and deletes only the objects created by the failed restore attempt if upload, database restore, or post-restore verification fails.
- Restore verifies the exact non-owner `EXECUTE` grants for every ADREEM `SECURITY DEFINER` function before reporting success.

The external backup provider must support the S3 operations `PutObject`, `CreateMultipartUpload`, `UploadPart`, `CompleteMultipartUpload`, `AbortMultipartUpload`, `HeadObject`, object metadata, and conditional completion with `If-None-Match`. Grant the backup writer only those operations on the configured prefix. Give the restore host separate `GetObject` access to the backup prefix. Enable versioning and retention/object-lock on the external backup bucket. The tools never prune completed backups.

The live attachment-source credential needs only `ListBucket` and `GetObject` for `ADREEM_ATTACHMENTS_BUCKET`. The restore attachment credential targets a different empty bucket and needs `ListBucket`, upload and multipart operations, `HeadObject`/read metadata, `AbortMultipartUpload`, `DeleteObject`, and `DeleteObjectVersion` when bucket versioning is enabled. The restore records returned version identifiers and removes those exact versions during rollback. Do not enable object lock on the disposable restore bucket while testing rollback.

## Configuration

Create a private environment file from `docs/adreem-backup.env.example` and set its permission to `0600`. Never commit the completed file.

Obtain the PostgreSQL CA certificate from the database provider through an authenticated administrative channel. Store it outside Git and point `ADREEM_BACKUP_DATABASE_CA_FILE` and `ADREEM_RESTORE_DATABASE_CA_FILE` to the appropriate source and target CA files. A URL using `require` or `verify-ca` is rejected.

For `age`, generate the identity on a trusted device. Put only the public recipient on Contabo. Keep the private identity and the manifest HMAC key in an offline password manager or encrypted vault. This preserves the ability to restore even if Contabo is lost.

AES-256-GCM is a fallback. Its passphrase must be at least 32 random characters. Because the backup server needs that passphrase, `age` offers stronger separation between Contabo and the decryption key.

Production must keep `ADREEM_BACKUP_INCLUDE_STORAGE=true`. It may be false only while the attachment table contains no stored files; otherwise the backup command stops.

## Dry-run

```bash
node server/ops/backupAdreem.js --dry-run
```

Expected result: a redacted plan, database fingerprint, destination host/bucket/prefix, encryption method, and missing tool list. No secret value is printed.

## Real backup

Run only after the dry-run reports `readyForExecution: true`:

```bash
node server/ops/backupAdreem.js --execute
```

The command uploads the encrypted artifact first and the signed manifest last. The manifest is the completion marker. Artifacts above 5 GiB use multipart upload automatically. If the command fails between artifact and manifest completion, an orphan encrypted artifact may remain; no existing completed backup is changed or deleted.

## Restore drill

Always use a separate disposable and empty PostgreSQL database and a separate empty attachment bucket. Never use the live ADREEM database or live attachment bucket. Keep `ADREEM_STORAGE_S3_ENDPOINT` and `ADREEM_ATTACHMENTS_BUCKET` configured on the restore host even for an offline archive; the restore plan uses their non-secret host and bucket names to reject the live attachment source explicitly.

PostgreSQL roles are cluster-wide, so a truly empty database can and must already have every role referenced by the archive. The signed manifest records those role names. The first execution authenticates the manifest, confirms that the database is empty, and fails before restore with the exact missing role list. On an isolated drill cluster, pass that verified list as a JSON array to the bootstrap while connected as a cluster role administrator:

```bash
psql --set=ON_ERROR_STOP=1 \
  --set=adreem_required_roles='["anon","authenticated","service_role"]' \
  --file docs/adreem-restore-bootstrap-roles.sql
```

Replace the JSON array with the complete list reported by the authenticated restore preflight. With no variable, the script defaults to the three baseline roles only. It accepts only simple lowercase PostgreSQL role names and creates every missing role as `NOLOGIN`, `NOINHERIT`, and without administrative privileges; only `service_role` receives `BYPASSRLS`. It refuses unsafe existing baseline attributes. It creates no database, schema, table, password, or login, so the target database remains truly empty for the next restore attempt. Do not run it on a shared cluster without reviewing the cluster-wide role impact.

Dry-run from the external bucket:

```bash
node server/ops/restoreAdreem.js --dry-run \
  --manifest-key production/adreem/YYYY/MM/DD/FILE.manifest.json
```

Execution requires the exact confirmation value shown in the example environment file:

```bash
node server/ops/restoreAdreem.js --execute \
  --manifest-key production/adreem/YYYY/MM/DD/FILE.manifest.json
```

For an offline copy downloaded separately, first set both files to permission `0600`, then run:

```bash
node server/ops/restoreAdreem.js --execute \
  --manifest-file /secure/path/FILE.manifest.json \
  --artifact-file /secure/path/FILE.backup.tar.age
```

The drill authenticates the version 2 manifest, verifies the encrypted file hash and size, checks that the database and attachment bucket targets are empty, validates all signed PostgreSQL roles, decrypts and validates the archive, uploads every attachment to the target bucket and verifies its SHA-256 and size, restores the database and its ACL entries in one transaction, verifies critical function privileges, then compares all signed ADREEM table counts.

Version 1 archives omitted database privileges and are intentionally rejected by the current restore command. Create a fresh version 2 backup before relying on the drill.

The returned restore result names the guarded target bucket and reports the uploaded object count and upload modes. Point a temporary ADREEM deployment at that restored database and bucket for the independent application-level drill. Do not repoint production until all database, privilege, attachment, login, and web checks pass.

## Failure rules

Treat the backup as failed when any command returns nonzero, the source changes while attachments are copied, a referenced attachment is missing, the external object size differs, or the manifest upload fails. Do not rename an artifact to look complete and do not bypass the checks.

Treat the restore as failed when either target is not empty, the database target matches the source, a signed role is missing, a baseline Supabase role has unsafe attributes, authentication fails, a tar path is unsafe, attachment hashes differ, upload rollback fails, `pg_restore` fails, critical function privileges differ, or restored table counts differ. A `pg_restore` error rolls back its single transaction. Attachment objects created by the failed attempt are removed. Preserve a failed nonempty database target for investigation, then create a new empty database and confirm the restore bucket is empty before retrying; never add `clean` or bypass either empty-target guard.

## Scheduling

After one manual backup and one independent restore drill pass, schedule the backup with a service timer. Use overlap prevention at the scheduler level and alert on any nonzero exit. Do not schedule automatic deletion. Perform a restore drill at least monthly and after changes to PostgreSQL major version, storage provider, encryption keys, or database schema.
