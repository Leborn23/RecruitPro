"""
Evaluation Script for the Recruitment Agent.
Responsibility: load goldens, run runtime, and optionally publish to LangSmith evaluate.
"""
from __future__ import annotations

import json
import logging
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Tuple

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.append(str(ROOT_DIR))

from src.agent.api_schemas import AgentActionType
from src.agent.runtime import InterviewAgentRuntime

load_dotenv(dotenv_path=ROOT_DIR / ".env", override=True)

logger = logging.getLogger("EvalRunner")
logger.setLevel(logging.INFO)
if not logger.handlers:
    logger.addHandler(logging.StreamHandler())

try:
    from langsmith.evaluation import evaluate as langsmith_evaluate

    HAS_LANGSMITH_EVALUATE = True
except Exception:
    HAS_LANGSMITH_EVALUATE = False


def _read_text(path_value: str) -> str:
    path = Path(path_value)
    if not path.exists():
        return ""
    return path.read_text(encoding="utf-8")


def evaluate_run(actual_report: Any, expected_output: Dict[str, Any]) -> Tuple[bool, Dict[str, Any]]:
    passed = True
    details: Dict[str, Any] = {}

    expected_rec = expected_output.get("hire_recommendation")
    if expected_rec and actual_report.hire_recommendation.value != expected_rec:
        details["recommendation_mismatch"] = {
            "expected": expected_rec,
            "actual": actual_report.hire_recommendation.value,
        }
        passed = False

    min_score = expected_output.get("overall_score_min")
    if min_score is not None and actual_report.overall_score < min_score:
        details["score_below_min"] = {
            "expected_min": min_score,
            "actual": actual_report.overall_score,
        }
        passed = False

    max_score = expected_output.get("overall_score_max")
    if max_score is not None and actual_report.overall_score > max_score:
        details["score_above_max"] = {
            "expected_max": max_score,
            "actual": actual_report.overall_score,
        }
        passed = False

    return passed, details


def run_case(case: Dict[str, Any]) -> Any:
    runtime = InterviewAgentRuntime()
    case_input = case.get("input", {})
    thread_id = f"eval_{case.get('test_id', 'unknown')}"

    resume_text = _read_text(case_input.get("resume_file", ""))
    jd_text = _read_text(case_input.get("jd_file", ""))
    response = runtime.start_interview(resume_text=resume_text, jd_text=jd_text, thread_id=thread_id)

    # Continue until END; keep this minimal and deterministic for golden checking.
    max_steps = 20
    while response.status != AgentActionType.FINISH and max_steps > 0:
        max_steps -= 1
        if response.status == AgentActionType.ASK:
            response = runtime.submit_answer(
                thread_id=response.thread_id,
                user_answer="I would approach this with clear assumptions, trade-offs, and measurable outcomes.",
            )
        elif response.status == AgentActionType.WAIT_FOR_REVIEW:
            response = runtime.submit_human_review(
                thread_id=response.thread_id,
                approved=True,
                comments="Auto-approved by evaluator.",
            )
        else:
            break

    return response.final_report


def run_all_evals() -> None:
    filepath = Path(__file__).with_name("golden_dataset.json")
    if not filepath.exists():
        logger.error("No golden dataset found.")
        return

    datasets: List[Dict[str, Any]] = json.loads(filepath.read_text(encoding="utf-8"))
    total = len(datasets)
    passed = 0

    logger.info("Starting Evaluation on %s Golden Cases", total)

    langsmith_rows: List[Dict[str, Any]] = []
    for case in datasets:
        logger.info("Running Eval: %s", case.get("test_id"))
        try:
            report = run_case(case)
            if not report:
                logger.error("No final report returned for %s", case.get("test_id"))
                continue

            ok, details = evaluate_run(report, case.get("expected_output", {}))
            if ok:
                passed += 1
            else:
                logger.error("Eval failed for %s: %s", case.get("test_id"), details)

            langsmith_rows.append(
                {
                    "inputs": case.get("input", {}),
                    "outputs": case.get("expected_output", {}),
                    "reference_outputs": {
                        "actual_recommendation": report.hire_recommendation.value,
                        "actual_overall_score": report.overall_score,
                        "passed": ok,
                        "details": details,
                    },
                    "metadata": {"test_id": case.get("test_id")},
                }
            )
        except Exception as exc:
            logger.exception("Eval crashed for %s: %s", case.get("test_id"), exc)

    logger.info("Eval Summary: %s/%s Passed.", passed, total)

    tracing_on = os.getenv("LANGSMITH_TRACING", "false").strip().lower() == "true"
    if HAS_LANGSMITH_EVALUATE and tracing_on and langsmith_rows:
        try:
            # Minimal LangSmith evaluate integration; keeps current golden-style evaluator logic.
            langsmith_evaluate(
                lambda inputs: {"inputs": inputs},
                data=langsmith_rows,
                experiment_prefix="hiregraph-golden",
            )
            logger.info("LangSmith evaluate submitted: %s rows", len(langsmith_rows))
        except Exception as exc:
            logger.warning("LangSmith evaluate submission skipped due to error: %s", exc)


if __name__ == "__main__":
    run_all_evals()
