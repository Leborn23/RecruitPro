import logging
import os
import time
from typing import Type, TypeVar, Optional
from pydantic import BaseModel

from src.agent.llm.registry import ProviderRegistry
from src.agent.llm.config import get_llm_config

T = TypeVar('T', bound=BaseModel)
logger = logging.getLogger(__name__)

class LLMService:
    """ 
    Facade for all LLM interactions in the HireGraph project. 
    It manages provider selection and falls back to Mock in dev mode.
    """
    
    def __init__(self, model_override: Optional[str] = None):
        self.config = get_llm_config()
        if model_override:
            self.config.model = model_override
            
        self.mode = os.environ.get("AGENT_MODE", "dev").lower()
        self.api_key = self.config.api_key or ""
        self.provider = None
        
        # 只要存在可用凭证或 base_url，就优先初始化真实 Provider。
        # dev 模式仅在“完全缺少可用配置”时才走 Mock。
        should_initialize_provider = bool(self.api_key or self.config.base_url)
        if should_initialize_provider:
            try:
                self.provider = ProviderRegistry.get_provider(self.config)
            except Exception:
                if self.mode in ["demo", "eval", "prod"]:
                    raise
                self.provider = None

    def invoke_structured(self, system_prompt: str, user_prompt: str, schema: Type[T]) -> T:
        """ 
        Unified entry point for structured outputs. 
        Delegates to the active provider or falls back to Mock if in dev mode.
        """
        # 结构化输出是主链路核心；demo/prod 下不允许静默降级为 Mock。
        if not self.provider:
            if self.mode in ["eval", "demo", "prod"]:
                raise RuntimeError(f"CRITICAL: API Key for {self.config.provider_name} missing in {self.mode} mode.")
            logger.warning("No API key for %s in %s mode. Using Mock LLM.", self.config.provider_name, self.mode)
            return self._generate_mock_output(schema)

        return self.provider.invoke_structured(system_prompt, user_prompt, schema)

    def invoke_plain(self, system_prompt: str, user_prompt: str) -> str:
        """ Unified entry point for plain text output. """
        # 纯文本调用用于提问/澄清等节点，不走 schema 校验。
        if not self.provider:
            if self.mode in ["eval", "demo", "prod"]:
                raise RuntimeError(f"CRITICAL: API Key for {self.config.provider_name} missing in {self.mode} mode.")
            return "No API key provided. This is a mock response."

        return self.provider.invoke_plain(system_prompt, user_prompt)

    def _generate_mock_output(self, schema: Type[T]) -> T:
        """ Centralized Mock fallback mapping logic (Preserved from legacy LLMService). """
        name = schema.__name__
        if name == "JobProfile":
            return schema(title="Mock AI", required_skills=["Python"], experience_years=2.0, key_responsibilities=["Mocking"])
        elif name == "CandidateProfile":
            return schema(name="Alice Candidate", skills=["Python", "LangChain"], experience_years=3.0, recent_roles=["AI Engineer"], education_level="BSc", key_achievements=["主导RAG系统开发，检索准确率提升35%", "负责日均500万请求的API网关优化"])
        elif name == "GapAnalysis":
            return schema(matching_skills=["Python"], missing_skills=["Go"], experience_gap_years=1.0, focus_areas=["Go"], overall_fit_score=80)
        elif name == "InterviewPlan":
            from src.agent.schemas import InterviewQuestion
            return schema(questions=[
                InterviewQuestion(
                    topic="Python 并发处理", 
                    question_text="能否说说 Python 中多线程和多进程的区别及适用场景？", 
                    expected_key_points=["GIL", "CPU-bound vs I/O-bound", "multiprocessing"],
                    rendered_text="你好！很高兴今天能和你交流。我看你简历中提到深度参与过高并发系统优化，那我们就从这里开始吧。关于并发处理，由于你提到过使用 Python，能否详细说说 Python 中多线程和多进程的区别及适用场景？"
                ),
                InterviewQuestion(
                    topic="分布式系统一致性",
                    question_text="在您重构的订单系统中，你是如何解决分布式事务或一致性问题的？",
                    expected_key_points=["TCC", "Saga", "Transactional Outbox", "Redis Distributed Lock"],
                    rendered_text="好的，理解了。那我们进入下一个话题。你在简历中写到了主导千万级请求的订单系统重构，我想请教一下，在如此高并发的场景下，你是如何解决分布式事务或保证最终一致性的？"
                ),
                InterviewQuestion(
                    topic="技术架构选型",
                    question_text="面对未来 10 倍流量增长，你会如何进一步演进当前的系统架构？",
                    expected_key_points=["Microservices", "CQRS", "Sharding", "Elastic Scaling"],
                    rendered_text="非常精彩的回答。最后一个问题，作为一名资深架构师，如果面对未来 10 倍的流量增长，结合你之前的调优经验，你会如何进一步演进当前的系统架构？"
                )
            ], estimated_duration_minutes=30)
        elif name == "AnswerEvaluation":
            from src.agent.schemas import ScoreDimensions
            return schema(
                question="Q", 
                answer="A", 
                dimensions=ScoreDimensions(technical_depth=8, communication_logic=7, problem_solving=8), 
                feedback="Nice",
                missing_logic_elements=[]
            )
        elif name == "FinalInterviewReport":
            from src.agent.schemas import HireRecommendation, EvidenceItem
            return schema(
                candidate_name="Alice Candidate", 
                overall_score=85, 
                strengths=[EvidenceItem(claim="技术深度扎实", source_question_index=0)], 
                weaknesses=[EvidenceItem(claim="缺少量化结果描述", source_question_index=0)], 
                hire_recommendation=HireRecommendation.HIRE, 
                detailed_evaluations=[]
            )
        elif name == "AuditResult":
            from src.agent.schemas import ResumeRisk, RiskLevel
            return schema(
                risks=[
                    ResumeRisk(category="Timeline", description="Detected 3-month overlap between Company A and B.", risk_level=RiskLevel.MEDIUM),
                    ResumeRisk(category="Tech", description="Claims 10 years of FastAPI experience (FastAPI released in 2018).", risk_level=RiskLevel.HIGH)
                ],
                summary="Candidate has high technical capability but chronology and tech-tenure inconsistencies require verification."
            )
        
        raise ValueError(f"No mock defined for {name}")

class LazyLLMService:
    """Lazy proxy that defers provider initialization until first use."""

    def __init__(self):
        self._service: Optional[LLMService] = None

    def _get_service(self) -> LLMService:
        # 延迟初始化可避免“import 时机早于 .env 加载”的问题。
        if self._service is None:
            self._service = LLMService()
        return self._service

    def reset(self) -> None:
        self._service = None

    @property
    def provider(self):
        return self._get_service().provider

    @property
    def mode(self) -> str:
        return self._get_service().mode

    @property
    def config(self):
        return self._get_service().config

    def invoke_structured(self, system_prompt: str, user_prompt: str, schema: Type[T]) -> T:
        return self._get_service().invoke_structured(system_prompt, user_prompt, schema)

    def invoke_plain(self, system_prompt: str, user_prompt: str) -> str:
        return self._get_service().invoke_plain(system_prompt, user_prompt)

    def __getattr__(self, item):
        return getattr(self._get_service(), item)


# Export a lazy default instance for easy access
default_llm = LazyLLMService()
