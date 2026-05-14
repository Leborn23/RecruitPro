import { DEFAULT_INTERVIEW_QUESTION_COUNT, normalizeInterviewQuestionCount } from './interviewQuestionCount.ts';

export const INTERVIEW_DURATION_OPTIONS = [
  { value: 15, label: '15 分钟', description: '适合 3 题快速初筛。' },
  { value: 20, label: '20 分钟', description: '适合 5 题标准初面。' },
  { value: 30, label: '30 分钟', description: '适合 8 题深入追问。' },
  { value: 45, label: '45 分钟', description: '适合 10 题完整结构化面试。' },
] as const;

export const DEFAULT_INTERVIEW_DURATION_MINUTES = 20;

const ALLOWED_DURATIONS = new Set<number>(INTERVIEW_DURATION_OPTIONS.map((item) => item.value));

export function normalizeInterviewDuration(value: unknown): number {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && ALLOWED_DURATIONS.has(parsed)) {
    return parsed;
  }
  return DEFAULT_INTERVIEW_DURATION_MINUTES;
}

export function getInterviewDurationOption(value: unknown) {
  const normalized = normalizeInterviewDuration(value);
  return (
    INTERVIEW_DURATION_OPTIONS.find((item) => item.value === normalized) ??
    INTERVIEW_DURATION_OPTIONS[1]
  );
}

export function getInterviewDurationMinutesForQuestionCount(questionCount: unknown): number {
  const normalized = normalizeInterviewQuestionCount(questionCount);
  switch (normalized) {
    case 3:
      return 15;
    case 5:
      return 20;
    case 8:
      return 30;
    case 10:
      return 45;
    default:
      return getInterviewDurationMinutesForQuestionCount(DEFAULT_INTERVIEW_QUESTION_COUNT);
  }
}
