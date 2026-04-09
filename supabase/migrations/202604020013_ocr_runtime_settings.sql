alter table public.company_settings
  add column if not exists ocr_enabled boolean not null default false;

alter table public.company_settings
  add column if not exists ocr_base_url text;

alter table public.company_settings
  add column if not exists ocr_api_key text;

alter table public.company_settings
  add column if not exists ocr_timeout_ms integer not null default 45000;

alter table public.company_settings
  drop constraint if exists company_settings_ocr_timeout_ms_check;

alter table public.company_settings
  add constraint company_settings_ocr_timeout_ms_check
  check (ocr_timeout_ms between 5000 and 180000);
