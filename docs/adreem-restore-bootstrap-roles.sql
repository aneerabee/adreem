\set ON_ERROR_STOP on

\if :{?adreem_required_roles}
\else
\set adreem_required_roles '["anon","authenticated","service_role"]'
\endif

begin;

create temporary table adreem_restore_required_roles (
  role_name text primary key
) on commit drop;

insert into adreem_restore_required_roles (role_name)
select value
from jsonb_array_elements_text(:'adreem_required_roles'::jsonb) as required(value);

do $adreem_roles$
declare
  required_role text;
begin
  if exists (
    select 1
    from adreem_restore_required_roles
    where role_name !~ '^[a-z_][a-z0-9_]{0,62}$'
  ) then
    raise exception 'ADREEM restore role names must be unquoted lowercase PostgreSQL identifiers';
  end if;
  if exists (
    select 1
    from unnest(array['anon', 'authenticated', 'service_role']) as baseline(role_name)
    where not exists (
      select 1 from adreem_restore_required_roles as required where required.role_name = baseline.role_name
    )
  ) then
    raise exception 'ADREEM restore roles must include anon, authenticated, and service_role';
  end if;
  if exists (
    select 1
    from pg_roles
    where rolname in ('anon', 'authenticated')
      and (rolcanlogin or rolinherit or rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls)
  ) then
    raise exception 'anon/authenticated role attributes are unsafe for an ADREEM restore drill';
  end if;
  if exists (
    select 1
    from pg_roles
    where rolname = 'service_role'
      and (rolcanlogin or rolinherit or rolsuper or rolcreatedb or rolcreaterole or rolreplication or not rolbypassrls)
  ) then
    raise exception 'service_role attributes do not match the Supabase service role baseline';
  end if;

  for required_role in
    select required.role_name
    from adreem_restore_required_roles as required
    where not exists (select 1 from pg_roles where rolname = required.role_name)
    order by required.role_name
  loop
    execute format(
      'create role %I nologin noinherit nosuperuser nocreatedb nocreaterole noreplication %s',
      required_role,
      case when required_role = 'service_role' then 'bypassrls' else 'nobypassrls' end
    );
  end loop;
end;
$adreem_roles$;

commit;
