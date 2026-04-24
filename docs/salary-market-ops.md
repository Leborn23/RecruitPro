# Salary Market Operations

## Purpose

Import local salary market files into the full salary pipeline without re-implementing parsing logic. The importer reuses `backend.main.normalize_market_salary_record` for validation preview, then pushes the same rows through raw ingest, normalized record generation, benchmark refresh, and crawl job tracking.

## Supported Inputs

- JSON: an array of row objects, or a wrapper object with `records`, `items`, `data`, `results`, or `rows`
- JSONL / NDJSON: one object per line
- CSV: header row plus records

## Source Presets

The importer supports `--preset` for common exported market files:

- `generic`: default loose alias matching
- `boss_zhipin`: maps columns such as `职位名称 / 城市 / 薪资 / 经验要求 / 学历要求 / 公司名称`
- `liepin`: maps columns such as `职位 / 工作地点 / 年薪 / 工作年限 / 学历 / 公司`
- `lagou`: maps columns such as `职位名称 / 工作城市 / 薪资范围 / 经验要求 / 学历要求 / 公司简称`

Example:

```powershell
python .\scripts\import_salary_market_raw.py .\data\salary-market-boss-sample.csv --preset boss_zhipin --dry-run
python .\scripts\import_salary_market_raw.py .\data\salary-market-liepin-sample.csv --preset liepin --dry-run
python .\scripts\import_salary_market_raw.py .\data\salary-market-lagou-sample.csv --preset lagou --dry-run
```

## Required Row Fields

The importer maps common aliases into the raw table fields:

- `source` from `source`, `source_name`, or `site`
- `source_job_title` from `source_job_title`, `job_title`, `title`, `role`, or `position`
- `source_city` from `source_city`, `city`, or `location`
- `source_salary_text` from `source_salary_text`, `salary_text`, `salary`, `compensation`, or `salary_range`
- Optional fields: `salary_min`, `salary_max`, `salary_period`, `currency`, `experience_text`, `education_text`, `company_name`, `captured_at`
- If salary text is missing but both min and max are present, the importer synthesizes `source_salary_text` from the range

Rows missing `source_job_title` or any usable salary value are skipped and reported in the summary.

## Run It

Dry run first:

```powershell
python .\scripts\import_salary_market_raw.py .\data\salary-market-sample.json --dry-run
python .\scripts\import_salary_market_raw.py .\data\salary-market-sample.jsonl --dry-run
python .\scripts\import_salary_market_raw.py .\data\salary-market-sample.csv --dry-run
python .\scripts\import_salary_market_raw.py .\data\salary-market-boss-sample.csv --preset boss_zhipin --dry-run
python .\scripts\import_salary_market_raw.py .\data\salary-market-liepin-sample.csv --preset liepin --dry-run
python .\scripts\import_salary_market_raw.py .\data\salary-market-lagou-sample.csv --preset lagou --dry-run
```

Write to Supabase:

```powershell
python .\scripts\import_salary_market_raw.py .\data\salary-market-sample.json --source sample-json
python .\scripts\import_salary_market_raw.py .\data\salary-market-sample.jsonl --source sample-jsonl
python .\scripts\import_salary_market_raw.py .\data\salary-market-sample.csv --source sample-csv
```

## Environment

For write mode, the existing `backend.main.Database` helper reads:

- `SUPABASE_URL`, or `VITE_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Dry run does not need database credentials.

## What The Script Does

1. Reads the local file and normalizes each row shape.
2. Builds a canonical raw payload and previews validation with `backend.main.normalize_market_salary_record`.
3. Creates a `market_salary_crawl_jobs` row with `running` status.
4. Imports the rows into `market_salary_raw_records`.
5. Regenerates `market_salary_normalized_records` for the imported rows.
6. Refreshes `market_salary_benchmarks`.
7. Marks the crawl job `success` or `failed`.

## Sample Data

- `data/salary-market-sample.json`
- `data/salary-market-sample.jsonl`
- `data/salary-market-sample.csv`
- `data/salary-market-boss-sample.csv`
- `data/salary-market-liepin-sample.csv`
- `data/salary-market-lagou-sample.csv`

## Troubleshooting

- If a file fails to parse, check the extension and whether the JSON is an array or line-delimited objects.
- If rows are skipped, inspect the printed `missing_required_fields` summary and add the required aliases.
- If writes fail, verify the Supabase environment variables before rerunning.
- If no benchmark is published after import, inspect `market_salary_crawl_jobs` and confirm the valid normalized rows reach the benchmark sample threshold.
