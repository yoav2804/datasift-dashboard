-- 2026-11-26 · Weekly planner. Adds one settings table and one column. Nothing is changed or removed.
create table if not exists app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
alter table app_settings enable row level security;   -- only the server (service key) reads it
insert into app_settings (key, value) values ('planner', '{"daily_capacity": 1000, "working_days": 6}') on conflict (key) do nothing;

-- the planner's estimate of properties going to outreach, saved when a list is planned, to compare with the actual result
alter table pull_tasks add column if not exists est_export_doors integer;

select * from app_settings;
