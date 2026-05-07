"""Researcher node module."""

import logging

from src.agent.langsmith_utils import traceable
from src.agent.state import InterviewState
from src.agent.tools.web_search import execute_web_search


logger = logging.getLogger(__name__)


@traceable(name="node.researcher", run_type="chain")
def researcher_node(state: InterviewState):
    """Run fast single-query verification when high-risk audit signals exist."""
    logger.info("Running lightweight researcher node.")

    audit = state.get("audit_result")
    # 无风险直接跳过，优先保证首题速度。
    if not audit or not audit.risks:
        logger.info("No research triggers found. Skipping.")
        return {"research_notes": ["No external verification required."]}

    # 速度优先策略：默认仅 High 风险触发检索。
    high_risks = [r for r in audit.risks if str(r.risk_level.value).lower() == "high"]
    if not high_risks:
        logger.info("No high-risk flags. Skipping lightweight research.")
        return {"research_notes": ["Research skipped (no high-risk audit flags)."]}

    # 只取第一条高风险做一次确定性查询，避免多轮检索拖慢启动。
    risk = high_risks[0]
    query = f"{risk.category} {risk.description}"[:220]

    try:
        logger.info("Running single lightweight search query: %s", query)
        result = execute_web_search(query)
        # 轻量模式只返回一条 research note，供后续节点参考。
        note = f"[Unverified] {result}" if result else "[Unverified] No useful result from lightweight search."
        return {"research_notes": [note]}
    except Exception as exc:
        logger.warning("Research search failed. Proceeding without external intel.", exc_info=exc)
        return {"research_notes": [f"Research skipped due to error: {exc}"]}
