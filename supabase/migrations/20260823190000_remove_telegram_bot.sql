begin;

create or replace function adreem_private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_legacy_ledger_id text := nullif(new.raw_app_meta_data ->> 'adreem_legacy_ledger_id', '');
begin
  if lower(coalesce(new.raw_app_meta_data ->> 'adreem_member', 'false')) <> 'true' then
    update public.adreem_profiles
    set is_active = false
    where id = new.id;
    return new;
  end if;

  insert into public.adreem_profiles (
    id,
    email,
    display_name,
    language,
    is_system_owner,
    is_active
  ) values (
    new.id,
    coalesce(new.email, concat(new.id::text, '@invalid.local')),
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), ''),
    case when new.raw_user_meta_data ->> 'language' = 'en' then 'en' else 'ar' end,
    lower(coalesce(new.raw_app_meta_data ->> 'adreem_system_owner', 'false')) = 'true',
    lower(coalesce(new.raw_app_meta_data ->> 'adreem_disabled', 'true')) <> 'true'
  )
  on conflict (id) do update set
    email = excluded.email,
    display_name = excluded.display_name,
    language = excluded.language,
    is_system_owner = excluded.is_system_owner,
    is_active = excluded.is_active;

  insert into public.adreem_ledgers (owner_id, legacy_ledger_id)
  values (new.id, v_legacy_ledger_id)
  on conflict (owner_id) do update set
    legacy_ledger_id = coalesce(public.adreem_ledgers.legacy_ledger_id, excluded.legacy_ledger_id);

  return new;
end;
$$;

revoke all on function adreem_private.handle_new_auth_user() from public, anon, authenticated, service_role;

update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) - 'adreem_telegram_user_id'
where coalesce(raw_app_meta_data, '{}'::jsonb) ? 'adreem_telegram_user_id';

drop function if exists public.adreem_bot_state_get(text, text);
drop function if exists public.adreem_bot_state_set(text, text, jsonb, timestamptz);
drop function if exists public.adreem_bot_state_delete(text, text);
drop function if exists public.adreem_bot_state_set_if_absent(text, text, jsonb, timestamptz);
drop function if exists public.adreem_bot_state_clean_expired(text, timestamptz);
drop function if exists public.adreem_bot_state_claim(text, text, jsonb, bigint);
drop function if exists public.adreem_bot_state_claim(text, text, jsonb, bigint, bigint);
drop function if exists public.adreem_bot_state_renew_claim(text, text, text, jsonb, bigint);
drop function if exists public.adreem_bot_state_complete_claim(text, text, text, jsonb, bigint);
drop function if exists public.adreem_bot_state_release_claim(text, text, text);
drop function if exists public.adreem_bot_state_fail_claim(text, text, text, jsonb, bigint);
drop function if exists public.adreem_bot_state_claim_effect(text, text, text, text, jsonb, bigint);
drop function if exists public.adreem_bot_state_complete_effect(text, text, text, text, jsonb, bigint);

drop table if exists adreem_private.adreem_bot_state;
alter table public.adreem_profiles drop column if exists telegram_user_id;

commit;
