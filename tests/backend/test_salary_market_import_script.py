from __future__ import annotations

import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
SCRIPTS_DIR = ROOT / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import import_salary_market_raw as importer  # noqa: E402


class SalaryMarketImportPresetTest(unittest.TestCase):
    def test_boss_preset_maps_chinese_export_fields(self) -> None:
        record = {
            "职位名称": "计算机视觉算法工程师",
            "城市": "北京",
            "薪资": "25K-45K",
            "经验要求": "3-5年",
            "学历要求": "本科",
            "公司名称": "星图视觉",
            "抓取时间": "2026-04-19T09:00:00Z",
        }

        adapted = importer.apply_source_preset(record, "boss_zhipin")

        self.assertEqual(adapted["source_job_title"], "计算机视觉算法工程师")
        self.assertEqual(adapted["source_city"], "北京")
        self.assertEqual(adapted["source_salary_text"], "25K-45K")
        self.assertEqual(adapted["experience_text"], "3-5年")
        self.assertEqual(adapted["education_text"], "本科")
        self.assertEqual(adapted["company_name"], "星图视觉")

    def test_liepin_preset_defaults_salary_period_to_yearly(self) -> None:
        record = {
            "职位": "算法工程师",
            "工作地点": "上海",
            "年薪": "40-60万",
            "工作年限": "5-8年",
            "学历": "硕士",
            "公司": "北辰智能",
        }

        adapted = importer.apply_source_preset(record, "liepin")

        self.assertEqual(adapted["source_job_title"], "算法工程师")
        self.assertEqual(adapted["source_city"], "上海")
        self.assertEqual(adapted["source_salary_text"], "40-60万")
        self.assertEqual(adapted["salary_period"], "yearly")

    def test_build_raw_record_accepts_lagou_export(self) -> None:
        record = {
            "职位名称": "后端工程师",
            "工作城市": "深圳",
            "薪资范围": "28k-42k",
            "经验要求": "3-5年",
            "学历要求": "本科",
            "公司简称": "海岸云",
            "发布时间": "2026-04-19T08:00:00Z",
        }

        raw_record, normalized_preview, skip_reason = importer.build_raw_record(
            record,
            preset="lagou",
            default_source="lagou-import",
            input_path=ROOT / "data" / "salary-market-sample.csv",
            index=1,
        )

        self.assertIsNone(skip_reason)
        self.assertEqual(raw_record["source_job_title"], "后端工程师")
        self.assertEqual(raw_record["source_city"], "深圳")
        self.assertEqual(raw_record["company_name"], "海岸云")
        self.assertEqual(normalized_preview["normalized_city"], "shenzhen")


if __name__ == "__main__":
    unittest.main()
