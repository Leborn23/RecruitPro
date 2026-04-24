export const INTERVIEW_QUESTION_COUNT_OPTIONS = [
  { value: 3, label: '精简', description: '3 题，适合快速初筛。' },
  { value: 5, label: '标准', description: '5 题，覆盖基础能力与岗位匹配。' },
  { value: 8, label: '深入', description: '8 题，增加项目与追问深度。' },
  { value: 10, label: '完整', description: '10 题，适合高优先级岗位。' },
] as const;

export const DEFAULT_INTERVIEW_QUESTION_COUNT = 5;

const ALLOWED_COUNTS = new Set<number>(INTERVIEW_QUESTION_COUNT_OPTIONS.map((item) => item.value));

export function normalizeInterviewQuestionCount(value: unknown): number {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && ALLOWED_COUNTS.has(parsed)) {
    return parsed;
  }
  return DEFAULT_INTERVIEW_QUESTION_COUNT;
}

export function getInterviewQuestionCountOption(value: unknown) {
  const normalized = normalizeInterviewQuestionCount(value);
  return (
    INTERVIEW_QUESTION_COUNT_OPTIONS.find((item) => item.value === normalized) ??
    INTERVIEW_QUESTION_COUNT_OPTIONS[1]
  );
}
