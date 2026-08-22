import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const schemaSql = readFileSync(new URL('../../supabase/migrations/20260820213626_create_adreem_v3_schema.sql', import.meta.url), 'utf8')
const ledgerSql = readFileSync(new URL('../../supabase/migrations/20260820213628_create_adreem_v3_ledger_functions.sql', import.meta.url), 'utf8')
const botCasSql = readFileSync(new URL('../../supabase/migrations/20260820213629_add_adreem_bot_state_claim_cas.sql', import.meta.url), 'utf8')
const botEffectCasSql = readFileSync(new URL('../../supabase/migrations/20260820213631_add_adreem_bot_effect_cas.sql', import.meta.url), 'utf8')
const legacyCleanupSql = readFileSync(new URL('../../supabase/migrations/20260820213833_remove_empty_legacy_state_from_v3.sql', import.meta.url), 'utf8')
const summaryScopeSql = readFileSync(new URL('../../supabase/migrations/20260822090000_add_summary_scope_and_record_only.sql', import.meta.url), 'utf8')
const accountDeletionSql = readFileSync(new URL('../../supabase/migrations/20260822170000_add_unused_account_deletion.sql', import.meta.url), 'utf8')

describe('ADREEM v3 database migration invariants', () => {
  it('keeps financial numbers inside the exact application range', () => {
    expect(schemaSql).not.toContain('numeric(20, 0)')
    expect(schemaSql).toContain('balance_dinar numeric(15, 0)')
    expect(schemaSql).toContain('amount numeric(15, 0)')
    expect(schemaSql).toContain('rate numeric(15, 8)')
    expect(schemaSql).toContain('structure_locked boolean not null default false')
    expect(ledgerSql).toContain('delta numeric(15, 0)')
    expect(ledgerSql).toContain('abs(v_amount) > 999999999999999')
    expect(ledgerSql).toContain('v_rate > 9999999')
  })

  it('requires explicit membership in every authenticated ledger function', () => {
    expect(schemaSql).toContain('is_active boolean not null default false')
    expect(schemaSql).toContain("'adreem_member'")
    expect(ledgerSql.match(/ADREEM_MEMBERSHIP_REQUIRED/g)).toHaveLength(3)
    expect(ledgerSql).toContain("movement.movement_type <> 'opening_balance'")
    expect(ledgerSql).toContain('adreem_private.handle_new_auth_user()')
    expect(ledgerSql).toContain('create trigger adreem_on_auth_user_created')
    expect(ledgerSql).toContain("lower(coalesce(new.raw_app_meta_data ->> 'adreem_member', 'false'))")
  })

  it('keeps row isolation forced and movement search indexed', () => {
    expect(schemaSql.match(/force row level security;/g)?.length).toBeGreaterThanOrEqual(10)
    expect(schemaSql).toContain('adreem_movements_note_trgm_idx')
    expect(schemaSql).toContain('adreem_attachments_account_recent_idx')
    expect(schemaSql).toContain('adreem_reconciliations_account_recent_idx')
    expect(schemaSql).toContain('extensions.gin_trgm_ops')
    expect(schemaSql).toContain('adreem_normalize_search_text')
    expect(ledgerSql).toContain('public.adreem_normalize_search_text(p_query)')
  })

  it('enforces movement immutability and blocks browser resets in the database', () => {
    expect(ledgerSql).toContain('ADREEM_CLIENT_RESET_NOT_ALLOWED')
    expect(ledgerSql).toContain('ADREEM_VOIDED_MOVEMENT_IMMUTABLE')
    expect(ledgerSql).toContain('ADREEM_MOVEMENT_CREATED_AT_IMMUTABLE')
    expect(ledgerSql).toContain('ADREEM_MOVEMENT_EDIT_WINDOW_EXPIRED')
    expect(ledgerSql.match(/least\(v_existing_movement_occurred_at, v_existing_movement_created_at\)/g)).toHaveLength(2)
    expect(ledgerSql).toContain('ADREEM_NONZERO_ACCOUNT_CANNOT_BE_DISABLED')
    expect(ledgerSql).toContain('ADREEM_NEGATIVE_OWN_BALANCE')
    expect(ledgerSql).toContain('ADREEM_ACTIVE_RECURRING_RULE_LIMIT')
    expect(ledgerSql).toContain('adreem_merge_account_references')
    expect(ledgerSql).toContain('ADREEM_INVALID_MOVEMENT_STATUS_TRANSITION')
    expect(ledgerSql).toContain('ADREEM_MOVEMENT_VOID_WINDOW_EXPIRED')
    expect(ledgerSql).toContain('public.adreem_latest_account_attachments')
    expect(ledgerSql).toContain('public.adreem_latest_reconciliations')
    expect(ledgerSql).toContain("least(coalesce(\n        nullif(v_item ->> 'createdAt'")
    expect(ledgerSql).not.toContain('reconciled_at = excluded.reconciled_at')
    expect(ledgerSql).toContain('cross join lateral')
    expect(ledgerSql).not.toContain('row_number() over')
  })

  it('fences Telegram claims with service-only atomic functions', () => {
    for (const functionName of [
      'adreem_bot_state_claim',
      'adreem_bot_state_renew_claim',
      'adreem_bot_state_complete_claim',
      'adreem_bot_state_release_claim',
    ]) {
      expect(botCasSql).toContain(`function public.${functionName}`)
      expect(botCasSql).toContain(`grant execute on function public.${functionName}`)
    }
    expect(botCasSql).toContain("state.payload #>> '{value,claimId}' = p_claim_token")
    expect(botCasSql).toContain('to service_role;')
    for (const functionName of [
      'adreem_bot_state_claim',
      'adreem_bot_state_fail_claim',
      'adreem_bot_state_claim_effect',
      'adreem_bot_state_complete_effect',
    ]) {
      expect(botEffectCasSql).toContain(`function public.${functionName}`)
      expect(botEffectCasSql).toContain(`grant execute on function public.${functionName}`)
    }
    expect(botEffectCasSql).toContain('to service_role;')
  })

  it('removes the legacy blob tables only from an empty v3 target', () => {
    expect(legacyCleanupSql).toContain("to_regclass('public.adreem_ledgers')")
    expect(legacyCleanupSql).toContain("raise exception 'ADREEM_LEGACY_STATE_NOT_EMPTY'")
    expect(legacyCleanupSql).toContain("raise exception 'ADREEM_LEGACY_BACKUP_NOT_EMPTY'")
    expect(legacyCleanupSql).toContain("execute 'lock table public.ml_state in access exclusive mode'")
    expect(legacyCleanupSql).toContain("execute 'lock table adreem_private.ml_state_backup_20260819 in access exclusive mode'")
    expect(legacyCleanupSql.indexOf("raise exception 'ADREEM_LEGACY_STATE_NOT_EMPTY'"))
      .toBeLessThan(legacyCleanupSql.indexOf("execute 'drop table public.ml_state'"))
    expect(legacyCleanupSql.indexOf("raise exception 'ADREEM_LEGACY_BACKUP_NOT_EMPTY'"))
      .toBeLessThan(legacyCleanupSql.indexOf("execute 'drop table adreem_private.ml_state_backup_20260819'"))
  })

  it('supports record-only movements without permitting a silent posting-mode change', () => {
    expect(summaryScopeSql).toContain("'record_only'")
    expect(summaryScopeSql).toContain('ADREEM_RECORD_ONLY_NOTE_REQUIRED')
    expect(summaryScopeSql).toContain('ADREEM_RECORD_ONLY_ACCOUNTS_NOT_ALLOWED')
    expect(summaryScopeSql).toContain('ADREEM_MOVEMENT_POSTING_MODE_IMMUTABLE')
    expect(summaryScopeSql).toContain('create trigger adreem_prevent_record_only_mode_flip')
    expect(summaryScopeSql).toContain("when 'record_only' then")
  })

  it('deletes only unused accounts under an owner-scoped revision lock', () => {
    expect(accountDeletionSql).toContain('function public.adreem_delete_unused_account')
    expect(accountDeletionSql).toContain('for update;')
    expect(accountDeletionSql).toContain('ADREEM_REVISION_CONFLICT')
    expect(accountDeletionSql).toContain('ADREEM_ACCOUNT_DELETE_IN_USE')
    expect(accountDeletionSql).toContain('ADREEM_ACCOUNT_DELETE_LINKED')
    expect(accountDeletionSql).toContain('from public.adreem_movement_entries')
    expect(accountDeletionSql).toContain('from public.adreem_attachments')
    expect(accountDeletionSql).toContain('from public.adreem_reconciliations')
    expect(accountDeletionSql).toContain('from public.adreem_recurring_rules')
    expect(accountDeletionSql).toContain('delete from public.adreem_audit_events')
    expect(accountDeletionSql).toContain("'unused_account_deleted'")
    expect(accountDeletionSql).toContain('to authenticated, service_role;')
  })
})
