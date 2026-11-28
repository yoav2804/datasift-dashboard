-- 2026-11-28 · Textivo, read only: a raw copy of what Textivo reports, plus a run log.
-- New objects only. No existing table is changed and nothing is deleted.
-- The API key is kept in Supabase Vault as 'textivo_api_key' (added by a person, never in code or chat).

create table if not exists textivo_raw (
  kind        text not null,                 -- campaign | campaign_kpi | message | opt_out | list | contact | opportunity | pipeline
  ext_id      text not null,                 -- Textivo's id (or phone for opt-outs)
  data        jsonb not null,                -- the object exactly as the API returned it
  first_seen  timestamptz not null default now(),
  fetched_at  timestamptz not null default now(),
  primary key (kind, ext_id)
);
create index if not exists textivo_raw_kind_fetched on textivo_raw (kind, fetched_at desc);

create table if not exists textivo_sync_runs (
  run_id      bigint generated always as identity primary key,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  ok          boolean,
  counts      jsonb,
  error       text
);

alter table textivo_raw enable row level security;        -- no policies: only the server's service key can read or write
alter table textivo_sync_runs enable row level security;

-- Reads one secret from Vault. Only the server (service_role) may call it.
create or replace function app_secret(p_name text) returns text
language sql security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = p_name limit 1
$$;
revoke all on function app_secret(text) from public, anon, authenticated;
grant execute on function app_secret(text) to service_role;

select 'textivo_raw' t, count(*) from textivo_raw union all select 'textivo_sync_runs', count(*) from textivo_sync_runs;
