export type InterviewRoomMessage = {
  speaker: 'ai' | 'candidate';
  content: string;
  kind?: string;
  answerGuidance?: string;
};

export type InterviewClockState = 'not_started' | 'running' | 'overtime' | 'closed';

export type InterviewClockView = {
  state: InterviewClockState;
  title: string;
  value: string;
  hint: string;
};

export type InterviewQuestionMetrics = {
  askedCount: number;
  completedCount: number;
  totalCount: number;
  completionRate: number;
};

function formatDuration(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const mm = Math.floor(safeSeconds / 60);
  const ss = safeSeconds % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

export function deriveInterviewClockView(params: {
  startedAt: string | null | undefined;
  nowMs: number;
  durationMinutes: number;
  closed?: boolean;
}): InterviewClockView {
  const { startedAt, nowMs, durationMinutes, closed = false } = params;
  const totalSeconds = Math.max(0, Math.floor(durationMinutes * 60));

  if (!startedAt) {
    return {
      state: 'not_started',
      title: '未开始',
      value: formatDuration(totalSeconds),
      hint: `默认时长 ${durationMinutes} 分钟`
    };
  }

  const startMs = new Date(startedAt).getTime();
  const elapsed = Math.max(0, Math.floor((nowMs - startMs) / 1000));
  const left = totalSeconds - elapsed;

  if (closed) {
    return {
      state: 'closed',
      title: left >= 0 ? '已提交' : '超时后已提交',
      value: formatDuration(elapsed),
      hint: left >= 0 ? `总用时 ${formatDuration(elapsed)}` : `超时 ${formatDuration(Math.abs(left))}`
    };
  }

  if (left >= 0) {
    return {
      state: 'running',
      title: '剩余时间',
      value: formatDuration(left),
      hint: `已进行 ${formatDuration(elapsed)}`
    };
  }

  return {
    state: 'overtime',
    title: '已超时',
    value: `+${formatDuration(Math.abs(left))}`,
    hint: '已锁定作答，仅可提交，不会自动提交'
  };
}

export function deriveInterviewQuestionMetrics(
  messages: InterviewRoomMessage[],
  totalQuestionCount: number | null | undefined,
  sessionFinalized: boolean
): InterviewQuestionMetrics {
  const questionIndexes: number[] = [];
  messages.forEach((msg, index) => {
    if (msg.speaker === 'ai' && msg.kind === 'question') {
      questionIndexes.push(index);
    }
  });

  const askedCount = questionIndexes.length;
  const totalCount = totalQuestionCount && totalQuestionCount > 0 ? totalQuestionCount : askedCount;

  let completedCount = 0;
  questionIndexes.forEach((questionIndex, idx) => {
    const nextQuestionIndex = idx + 1 < questionIndexes.length ? questionIndexes[idx + 1] : messages.length;
    const segment = messages.slice(questionIndex + 1, nextQuestionIndex);
    const hasCandidateReply = segment.some((msg) => msg.speaker === 'candidate' && msg.content.trim());
    const closedBySystem = segment.some((msg) => msg.speaker === 'ai' && msg.kind === 'closing');
    const movedToNextQuestion = idx + 1 < questionIndexes.length;
    const reachedQuestionEnd = idx === questionIndexes.length - 1 && hasCandidateReply && askedCount >= totalCount;

    if (hasCandidateReply && (movedToNextQuestion || closedBySystem || reachedQuestionEnd || sessionFinalized)) {
      completedCount += 1;
    }
  });

  const completionRate = totalCount > 0 ? Math.min(100, Math.round((completedCount / totalCount) * 100)) : 0;

  return {
    askedCount,
    completedCount,
    totalCount,
    completionRate
  };
}
