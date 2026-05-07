"""Auditor node module."""

import logging

from src.agent.langsmith_utils import traceable
from src.agent.llm_service import default_llm
from src.agent.prompts.auditor_prompts import RESUME_AUDIT_PROMPT
from src.agent.schemas import AuditResult
from src.agent.state import InterviewState


logger = logging.getLogger(__name__)


@traceable(name="node.audit_resume", run_type="chain")
def audit_resume_node(state: InterviewState):
    """Run resume integrity and consistency checks."""
    logger.info("Running resume audit node.")

    jd = state.get("jd_text", "No JD provided.")
    resume = state.get("resume_text", "No resume provided.")

    audit_data = default_llm.invoke_structured(
        system_prompt=RESUME_AUDIT_PROMPT.format(jd_text=jd, resume_text=resume),
        user_prompt="Perform a full integrity and consistency audit on the candidate resume relative to the JD.",
        schema=AuditResult,
    )

    if audit_data.risks:
        logger.info("Resume audit found %s potential risks.", len(audit_data.risks))
        for risk in audit_data.risks:
            logger.debug(
                "Resume audit risk: level=%s category=%s description=%s",
                risk.risk_level.value,
                risk.category,
                risk.description[:80],
            )
    else:
        logger.info("Resume audit found no major risks.")

    return {"audit_result": audit_data}
