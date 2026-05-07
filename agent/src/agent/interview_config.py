"""Runtime configuration helpers for interview behavior."""

import os
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Iterator


_question_count_override: ContextVar[int | None] = ContextVar("question_count_override", default=None)


def _read_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return int(raw.strip())
    except (TypeError, ValueError):
        return default


@dataclass(frozen=True)
class InterviewQuestionConfig:
    min_questions: int
    max_questions: int


def get_interview_question_config() -> InterviewQuestionConfig:
    override = _question_count_override.get()
    if override is not None and override > 0:
        return InterviewQuestionConfig(
            min_questions=override,
            max_questions=override,
        )

    min_questions = max(1, _read_int("INTERVIEW_MIN_QUESTIONS", 3))
    max_questions = max(1, _read_int("INTERVIEW_MAX_QUESTIONS", 5))

    if min_questions > max_questions:
        min_questions = max_questions

    return InterviewQuestionConfig(
        min_questions=min_questions,
        max_questions=max_questions,
    )


@contextmanager
def interview_question_count_override(question_count: int | None) -> Iterator[None]:
    if question_count is None or question_count <= 0:
        yield
        return

    token = _question_count_override.set(int(question_count))
    try:
        yield
    finally:
        _question_count_override.reset(token)
