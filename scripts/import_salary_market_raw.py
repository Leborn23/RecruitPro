from __future__ import annotations

import argparse
import csv
import hashlib
import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))
BACKEND_DIR = ROOT_DIR / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from backend import main as backend_main  # noqa: E402

RAW_TABLE = "market_salary_raw_records"
DEFAULT_PRESET = "generic"

PRESET_FIELD_ALIASES: dict[str, dict[str, list[str]]] = {
    "generic": {
        "source": ["source", "source_name", "site", "来源", "平台"],
        "source_job_title": ["source_job_title", "job_title", "title", "role", "position", "职位名称", "岗位名称", "职位", "岗位"],
        "source_city": ["source_city", "city", "location", "城市", "工作城市", "工作地点", "所在城市"],
        "source_salary_text": ["source_salary_text", "salary_text", "salary", "compensation", "salary_range", "薪资", "薪资范围", "薪酬", "年薪", "月薪"],
        "salary_min": ["salary_min", "min_salary", "最低薪资", "薪资下限", "月薪下限", "年薪下限"],
        "salary_max": ["salary_max", "max_salary", "最高薪资", "薪资上限", "月薪上限", "年薪上限"],
        "salary_period": ["salary_period", "period", "pay_period", "薪资周期", "计薪周期"],
        "currency": ["currency", "币种"],
        "experience_text": ["experience_text", "experience", "years_experience", "经验要求", "工作经验", "经验"],
        "education_text": ["education_text", "education", "学历要求", "学历"],
        "company_name": ["company_name", "company", "公司名称", "公司", "企业名称"],
        "captured_at": ["captured_at", "created_at", "scraped_at", "published_at", "date", "抓取时间", "发布时间", "更新时间"],
    },
    "boss_zhipin": {
        "source_job_title": ["职位名称", "岗位名称", "职位"],
        "source_city": ["城市", "工作地点", "工作城市"],
        "source_salary_text": ["薪资", "薪资范围"],
        "experience_text": ["经验要求", "工作经验"],
        "education_text": ["学历要求", "学历"],
        "company_name": ["公司名称", "公司"],
        "captured_at": ["抓取时间", "发布时间", "更新时间"],
    },
    "liepin": {
        "source_job_title": ["职位", "职位名称", "岗位"],
        "source_city": ["工作地点", "城市", "所在地"],
        "source_salary_text": ["年薪", "薪资", "薪酬"],
        "experience_text": ["工作年限", "经验要求"],
        "education_text": ["学历", "学历要求"],
        "company_name": ["公司", "公司名称"],
        "captured_at": ["更新时间", "发布时间", "抓取时间"],
    },
    "lagou": {
        "source_job_title": ["职位名称", "岗位名称", "职位"],
        "source_city": ["工作城市", "城市", "工作地点"],
        "source_salary_text": ["薪资范围", "薪资"],
        "experience_text": ["经验要求", "工作经验"],
        "education_text": ["学历要求", "学历"],
        "company_name": ["公司简称", "公司名称", "公司"],
        "captured_at": ["发布时间", "更新时间", "抓取时间"],
    },
}


def normalize_scalar(value: Any) -> Any:
    if isinstance(value, str):
        return value.strip()
    return value


def normalize_payload(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): normalize_payload(item) for key, item in value.items()}
    if isinstance(value, list):
        return [normalize_payload(item) for item in value]
    if isinstance(value, tuple):
        return [normalize_payload(item) for item in value]
    return normalize_scalar(value)


def as_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    return str(value).strip()


def pick_text(record: dict[str, Any], keys: list[str]) -> str:
    for key in keys:
        text = as_text(record.get(key))
        if text:
            return text
    return ""


def pick_number(record: dict[str, Any], keys: list[str]) -> float | None:
    for key in keys:
        value = record.get(key)
        if value is None or value == "":
            continue
        if isinstance(value, bool):
            continue
        if isinstance(value, (int, float)):
            return float(value)
        text = as_text(value)
        if not text:
            continue
        parsed = backend_main._parse_salary_amount(text)
        if parsed is not None:
            return parsed
    return None


def get_field_aliases(preset: str) -> dict[str, list[str]]:
    preset_key = (preset or DEFAULT_PRESET).strip().lower()
    aliases = {key: list(value) for key, value in PRESET_FIELD_ALIASES[DEFAULT_PRESET].items()}
    for key, extra_values in PRESET_FIELD_ALIASES.get(preset_key, {}).items():
        base = aliases.setdefault(key, [])
        for extra in extra_values:
            if extra not in base:
                base.insert(0, extra)
    return aliases


def apply_source_preset(record: dict[str, Any], preset: str) -> dict[str, Any]:
    aliases = get_field_aliases(preset)
    normalized = dict(record)
    for field, keys in aliases.items():
        if normalized.get(field) not in (None, ""):
            continue
        value = None
        if field in {"salary_min", "salary_max"}:
            value = pick_number(normalized, keys)
        else:
            value = pick_text(normalized, keys)
        if value not in (None, ""):
            normalized[field] = value
    if not normalized.get("source"):
        normalized["source"] = preset if preset != DEFAULT_PRESET else ""
    if preset == "liepin" and not normalized.get("salary_period"):
        normalized["salary_period"] = "yearly"
    return normalized


def load_json_records(path: Path) -> list[dict[str, Any]]:
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    if isinstance(data, list):
        return [row for row in data if isinstance(row, dict)]
    if isinstance(data, dict):
        for key in ("records", "items", "data", "results", "rows"):
            value = data.get(key)
            if isinstance(value, list):
                return [row for row in value if isinstance(row, dict)]
        if any(
            key in data
            for key in (
                "source_job_title",
                "job_title",
                "title",
                "role",
                "position",
                "salary_text",
                "source_salary_text",
            )
        ):
            return [data]
    raise ValueError("JSON input must be an array, a record wrapper, or a single record object")


def load_jsonl_records(path: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for line_no, raw_line in enumerate(path.read_text(encoding="utf-8-sig").splitlines(), start=1):
        line = raw_line.strip()
        if not line:
            continue
        row = json.loads(line)
        if not isinstance(row, dict):
            raise ValueError(f"JSONL line {line_no} is not an object")
        records.append(row)
    return records


def load_csv_records(path: Path) -> list[dict[str, Any]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        return [
            {key: value for key, value in row.items() if key is not None}
            for row in reader
        ]


def load_input_records(path: Path) -> list[dict[str, Any]]:
    suffix = path.suffix.lower()
    if suffix == ".json":
        return load_json_records(path)
    if suffix in {".jsonl", ".ndjson"}:
        return load_jsonl_records(path)
    if suffix == ".csv":
        return load_csv_records(path)
    raise ValueError(f"Unsupported file type: {path.suffix}")


def build_raw_record(
    record: dict[str, Any],
    *,
    preset: str,
    default_source: str,
    input_path: Path,
    index: int,
) -> tuple[dict[str, Any], dict[str, Any], str | None]:
    adapted_record = apply_source_preset(record, preset)
    normalized_payload = normalize_payload(adapted_record)
    source = pick_text(adapted_record, ["source"]) or default_source
    source_job_title = pick_text(adapted_record, ["source_job_title"])
    source_city = pick_text(adapted_record, ["source_city"])
    source_salary_text = pick_text(adapted_record, ["source_salary_text"])
    salary_min = pick_number(adapted_record, ["salary_min"])
    salary_max = pick_number(adapted_record, ["salary_max"])
    salary_period = pick_text(adapted_record, ["salary_period"]) or "monthly"
    currency = pick_text(adapted_record, ["currency"]) or "CNY"
    experience_text = pick_text(adapted_record, ["experience_text"])
    education_text = pick_text(adapted_record, ["education_text"])
    company_name = pick_text(adapted_record, ["company_name"])
    captured_at = pick_text(adapted_record, ["captured_at"])

    if not source_salary_text and salary_min is not None and salary_max is not None:
        source_salary_text = f"{salary_min:g}-{salary_max:g}"

    if not source_job_title or not source_salary_text:
        return (
            {},
            {
                "row": index,
                "source": source or default_source,
                "reason": "missing_required_fields",
                "required": {
                    "source_job_title": bool(source_job_title),
                    "source_salary_text": bool(source_salary_text),
                },
                "input_file": str(input_path),
            },
            None,
        )

    canonical_raw = {
        "source": source,
        "source_job_title": source_job_title,
        "source_city": source_city or None,
        "source_salary_text": source_salary_text,
        "salary_min": salary_min,
        "salary_max": salary_max,
        "salary_period": salary_period,
        "currency": currency,
        "experience_text": experience_text or None,
        "education_text": education_text or None,
        "company_name": company_name or None,
        "captured_at": captured_at or None,
        "raw_payload": normalized_payload,
    }
    hash_material = json.dumps(
        {
            "file": str(input_path.resolve()),
            "row": canonical_raw,
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    canonical_raw["hash_key"] = hashlib.sha256(hash_material.encode("utf-8")).hexdigest()
    normalized_preview = backend_main.normalize_market_salary_record(canonical_raw)
    return canonical_raw, normalized_preview, None


def main() -> int:
    parser = argparse.ArgumentParser(description="Import local JSON/JSONL/CSV salary market rows into raw records.")
    parser.add_argument("input_path", help="Path to the local JSON, JSONL, or CSV file")
    parser.add_argument("--source", help="Default source name when a row does not provide one")
    parser.add_argument("--preset", choices=sorted(PRESET_FIELD_ALIASES.keys()), default=DEFAULT_PRESET, help="Column mapping preset for exported source files")
    parser.add_argument("--dry-run", action="store_true", help="Validate and print a summary without writing to Supabase")
    parser.add_argument("--limit", type=int, help="Only process the first N parsed rows")
    args = parser.parse_args()

    input_path = Path(args.input_path).expanduser().resolve()
    if not input_path.exists():
        raise SystemExit(f"Input file not found: {input_path}")

    records = load_input_records(input_path)
    if args.limit is not None:
        records = records[: max(args.limit, 0)]

    default_source = args.source or input_path.stem
    raw_rows: list[dict[str, Any]] = []
    previews: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    invalid_reasons: Counter[str] = Counter()

    for index, record in enumerate(records, start=1):
        canonical_raw, normalized_preview, skip_reason = build_raw_record(
            record,
            preset=args.preset,
            default_source=default_source,
            input_path=input_path,
            index=index,
        )
        if skip_reason is not None:
            skipped.append(skip_reason)
            continue
        raw_rows.append(canonical_raw)
        previews.append(normalized_preview)
        if not normalized_preview.get("is_valid"):
            invalid_reasons[str(normalized_preview.get("invalid_reason") or "unknown")] += 1

    print(f"Loaded {len(records)} input rows from {input_path}")
    print(f"Prepared {len(raw_rows)} raw records")
    if skipped:
        print(f"Skipped {len(skipped)} rows")
        for item in skipped[:5]:
            print(f"  row {item['row']}: {item['reason']} ({item['required']})")
    if invalid_reasons:
        print("Invalid preview reasons:")
        for reason, count in sorted(invalid_reasons.items()):
            print(f"  {reason}: {count}")

    if args.dry_run:
        print("Dry run only; no database writes performed.")
        return 0

    if not raw_rows:
        print("No raw rows to import.")
        return 0

    client = backend_main.db.get_client()
    crawl_job = backend_main.db.first(
        client.table("market_salary_crawl_jobs")
        .insert(
            {
                "source": default_source,
                "status": "running",
                "started_at": backend_main.now_iso(),
                "records_fetched": len(records),
                "records_valid": 0,
            }
        )
        .execute()
    )
    crawl_job_id = backend_main.normalize_text((crawl_job or {}).get("id"))

    try:
        import_records = [
            {
                key: value
                for key, value in row.items()
                if key != "hash_key"
            }
            for row in raw_rows
        ]
        ingestion_summary = backend_main.ingest_market_salary_records(client, default_source, import_records)
        refresh_summary = backend_main.refresh_market_salary_benchmarks(client)
        if crawl_job_id:
            client.table("market_salary_crawl_jobs").update(
                {
                    "status": "success",
                    "finished_at": backend_main.now_iso(),
                    "records_fetched": len(records),
                    "records_valid": ingestion_summary["normalized_valid"],
                    "error_message": None,
                }
            ).eq("id", crawl_job_id).execute()
    except Exception as exc:
        if crawl_job_id:
            client.table("market_salary_crawl_jobs").update(
                {
                    "status": "failed",
                    "finished_at": backend_main.now_iso(),
                    "records_fetched": len(records),
                    "records_valid": 0,
                    "error_message": str(exc)[:500],
                }
            ).eq("id", crawl_job_id).execute()
        raise

    print(f"Imported {ingestion_summary['raw_inserted']} raw records into {RAW_TABLE}")
    print(f"Wrote {ingestion_summary['normalized_written']} normalized rows")
    print(f"Published {refresh_summary['benchmark_count']} salary benchmarks")
    print(f"Validated {len(previews)} rows using backend.main.normalize_market_salary_record")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
