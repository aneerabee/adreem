# ADREEM v3 migration

This runbook moves each legacy ledger into the dedicated relational ADREEM database. Production remains on the legacy store until every verification below succeeds.

## Safety rules

- Use a dedicated ADREEM Supabase project as the target.
- Never link or push this migration history to the legacy shared source project; it is read-only input for this procedure.
- Stop every legacy writer (API, jobs, and operator writes) before capturing the source freeze values. Keep them stopped until cutover or rollback.
- Record and require the exact source `updated_at` for every mapped row. If the legacy payload has a monotonic revision, require that revision too.
- Keep the environment, user mapping, and checkpoint files outside Git with mode `600`.
- Give every user an explicit, unique `ledgerId`.
- Give every source row an explicit expected application, tenant, and ledger identity. Defaults are not accepted.
- Start only with an empty target ledger.
- Keep the dedicated target disconnected from production traffic. The migration keeps Auth users banned until data verification finishes and unbans each user as its final target mutation.
- Never delete the legacy source during this procedure.

## User mapping

```json
[
  {
    "email": "owner@example.com",
    "legacyRowId": "adreem:adreem:main",
    "ledgerId": "main",
    "displayName": "Owner",
    "password": "temporary-password",
    "isOwner": true,
    "language": "ar",
    "expectedSourceAppId": "adreem",
    "expectedSourceTenantId": "adreem",
    "expectedSourceLedgerId": "main",
    "expectedSourceUpdatedAt": "2026-08-20T01:00:00.000Z",
    "expectedSourceRevision": 42
  }
]
```

Exactly one row must have `isOwner: true`. Emails, source rows, and ledger IDs must be unique. Omit `expectedSourceRevision` only when that legacy payload has no revision field; `expectedSourceUpdatedAt` is always required.

The resume identity fingerprint covers the email, source row, target ledger, display name, owner permission, language, source identity, source freeze values, and fixed ADREEM membership/disabled claims. Changing any of them requires a clean migration, not a checkpoint edit.

## Source freeze gate

1. Stop and verify all legacy writers are stopped.
2. Take and verify the source backup.
3. Read each source row directly and copy its exact `updated_at`, identity fields, and optional revision into the private mapping.
4. Run `--dry-run` while writers remain stopped.
5. Re-read the same fields immediately before `--apply`; do not continue if any value changed.

The migration re-reads and fingerprints the source before and after attachment handling, around every target batch, and before activation. A change fails closed and leaves the target user banned.

## Execution

1. Apply the complete dedicated-project migration history in filename order. The latest cleanup retires obsolete integrations, while the earlier legacy cleanup refuses to run if either compatibility table contains a row.
2. Configure the target database URL with certificate verification and its explicit expected host. The operator needs `psql` locally.
3. Create the private user mapping and checkpoint paths.
4. Load the private environment file in the shell.
5. Complete the source freeze gate.
6. Run the validation-only pass:

```bash
pnpm ops:migrate-v3 -- --dry-run
```

7. Start the migration while the source remains frozen:

```bash
pnpm ops:migrate-v3 -- --apply
```

8. If the process stops, resume only with:

```bash
pnpm ops:migrate-v3 -- --resume
```

Before every apply call, the checkpoint stores a deterministic pending-batch fingerprint and both expected revisions. If the process stops after the database commit but before the progress checkpoint, `--resume` accepts only the two recorded revision states. When the target is at the post-apply revision, it deeply verifies that exact batch, including derived movement entries, before advancing without replay.

The dry-run target connection is read-only. Its preflight verifies every schema table, the apply and account-deletion function signatures and execution grants, exact row policies, enabled and forced row isolation, table grants, and restricted profile column grants before any Auth mutation.

Every uploaded attachment is downloaded from the target and checked against the source bytes by SHA-256 and byte length. Final verification compares every migrated payload, all derived movement entries, balances, ignored external accounts, and reset time. Only known database-derived account balance fields and movement sequence are ignored.

## Failure cleanup and retry

- Do not edit the checkpoint or advance its revision manually.
- For an ordinary interruption with an unchanged source, keep the source frozen and run `--resume`.
- For a source-freeze failure, keep the target user banned. Either restore the exact frozen source row and retry `--resume`, or abandon the run.
- To abandon a run, remove the incomplete target Auth user and its cascaded ledger data, delete every object under that user's target storage prefix, verify the target identity and ledger are absent, then remove the checkpoint. Only after those checks may a new `--apply` begin with newly captured freeze values.
- A target revision outside the checkpoint's exact stable or pending states, a batch payload mismatch, an identity mismatch, or an attachment mismatch requires abandonment and cleanup. Do not retry by changing checkpoint content.
- An interruption after final unban leaves `pendingActivation` in the checkpoint. `--resume` verifies all data and source fingerprints, observes that activation already succeeded, and completes without another batch or duplicate activation.

## Cutover gate

Do not switch the API until all of these are true:

- the checkpoint marks every configured user as completed;
- the source writers remained stopped and every captured freeze value still matches;
- source and target payloads, movement entries, counts, IDs, balances, and attachments match;
- user A cannot read user B data through SQL, API, or web;
- an encrypted external backup and an independent restore drill succeed;
- production secrets point only to the dedicated ADREEM project.
