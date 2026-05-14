from __future__ import annotations

import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
BACKEND_DIR = ROOT / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from backend import main  # noqa: E402


class ResumeProfileNormalizationTest(unittest.TestCase):
    def test_llm_profile_keeps_only_values_with_resume_evidence(self) -> None:
        base_profile = {
            "basic_profile": {
                "full_name": "吕德佳",
                "email": "real@example.com",
                "phone": "13800138000",
                "current_title": "计算机视觉算法工程师",
                "years_of_experience": 3,
            },
            "explicit_skills": [
                {"skill": "Python", "confidence": 0.8, "evidence_span_ids": ["sp_1"]},
            ],
            "inferred_skills": [],
            "projects": [
                {
                    "project_name": "医学图像分割项目",
                    "project_summary": "使用 Python 和 Unet 完成医学图像分割实验。",
                    "responsibilities": ["负责模型训练和评估"],
                    "tech_stack": ["Python", "Unet"],
                    "evidence_spans": ["sp_2"],
                    "confidence": 0.72,
                }
            ],
            "work_experience": [],
            "education": [],
            "certifications": [],
            "risk_flags": [],
            "extraction_confidence": {"overall": 0.7, "by_section": {"projects": 0.7, "skills": 0.7, "education": 0.5}},
            "evidence_spans": [
                {"span_id": "sp_1", "text_excerpt": "吕德佳 real@example.com 13800138000 Python Unet"},
                {"span_id": "sp_2", "text_excerpt": "医学图像分割项目：负责模型训练和评估"},
            ],
        }
        llm_payload = {
            "basic_profile": {
                "full_name": "王不存在",
                "email": "fake@example.com",
                "phone": "13999999999",
                "current_title": "CTO",
                "years_of_experience": 10,
            },
            "explicit_skills": [
                {"skill": "Rust", "confidence": 0.95, "evidence_span_ids": ["sp_missing"]},
                {"skill": "Python", "confidence": 0.92, "evidence_span_ids": ["sp_1"]},
            ],
            "projects": [
                {
                    "project_name": "虚构千万级平台",
                    "project_summary": "主导千万级平台架构。",
                    "tech_stack": ["Rust"],
                    "evidence_spans": ["sp_missing"],
                    "confidence": 0.99,
                },
                {
                    "project_name": "医学图像分割项目",
                    "project_summary": "使用 Python 和 Unet 完成医学图像分割实验。",
                    "responsibilities": ["负责模型训练和评估"],
                    "tech_stack": ["Python", "Unet"],
                    "evidence_spans": ["sp_2"],
                    "confidence": 0.86,
                },
            ],
            "extraction_confidence": {"overall": 0.99, "by_section": {"projects": 0.99, "skills": 0.99, "education": 0.5}},
        }

        normalized = main.normalize_profile_from_llm(llm_payload, base_profile)

        self.assertEqual(normalized["basic_profile"], base_profile["basic_profile"])
        self.assertEqual([item["skill"] for item in normalized["explicit_skills"]], ["Python"])
        self.assertEqual([item["project_name"] for item in normalized["projects"]], ["医学图像分割项目"])
        self.assertTrue(any(flag["type"] == "llm_evidence_rejected" for flag in normalized["risk_flags"]))


class ResumeMatchOutputTest(unittest.TestCase):
    def test_rule_match_output_uses_readable_chinese_and_evidence(self) -> None:
        profile = {
            "basic_profile": {"years_of_experience": 3},
            "explicit_skills": [{"skill": "Python", "evidence_span_ids": ["sp_1"]}],
            "inferred_skills": [],
            "projects": [
                {
                    "project_name": "医学图像分割项目",
                    "project_summary": "使用 Python 和 Unet 做医学图像分割。",
                    "tech_stack": ["Python", "Unet"],
                    "complexity_level": "high",
                    "evidence_spans": ["sp_2"],
                }
            ],
            "education": [{"degree": "本科"}],
            "risk_flags": [],
            "extraction_confidence": {"overall": 0.8},
        }
        requirement = {
            "must_have_skills": [{"skill": "Python"}, {"skill": "Golang"}],
            "nice_to_have_skills": [{"skill": "Unet"}],
            "project_keywords": ["医学图像", "Unet"],
            "required_experience_years": 2,
            "education_requirement": {"min_level": "本科"},
        }

        output = main.build_match_output(
            profile,
            requirement,
            {"must_have": 0.3, "skills": 0.25, "project": 0.2, "experience": 0.15, "education": 0.1},
        )

        readable_text = " ".join(
            [
                output["summary_reason"],
                *output["concerns"],
                *[item["reason"] for item in output["requirement_breakdown"]],
            ]
        )
        self.assertNotRegex(readable_text, r"[绮噯寤鸿娼滃鍊欓]")
        self.assertIn("缺少关键技能：Golang", output["concerns"])
        self.assertIn("sp_2", output["evidence_links"])
        self.assertIn(main.recommendation_to_tag(output["recommendation"]), {"强烈推荐", "建议面试", "建议复核", "暂不推荐"})


if __name__ == "__main__":
    unittest.main()
