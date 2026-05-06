import assert from 'node:assert/strict';
import {
  deriveInterviewClockView,
  deriveInterviewQuestionMetrics,
  deriveInterviewStartState
} from '../../src/lib/interviewRoomState.ts';

const notStarted = deriveInterviewClockView({
  startedAt: null,
  nowMs: Date.now(),
  durationMinutes: 20
});

assert.equal(notStarted.state, 'not_started');
assert.equal(notStarted.title, '未开始');
assert.equal(notStarted.value, '20:00');
assert.equal(notStarted.hint, '默认时长 20 分钟');

const running = deriveInterviewClockView({
  startedAt: '2026-04-21T10:00:00.000Z',
  nowMs: new Date('2026-04-21T10:05:30.000Z').getTime(),
  durationMinutes: 20
});

assert.equal(running.state, 'running');
assert.equal(running.title, '剩余时间');
assert.equal(running.value, '14:30');
assert.equal(running.hint, '已进行 05:30');

const overtime = deriveInterviewClockView({
  startedAt: '2026-04-21T10:00:00.000Z',
  nowMs: new Date('2026-04-21T10:21:10.000Z').getTime(),
  durationMinutes: 20
});

assert.equal(overtime.state, 'overtime');
assert.equal(overtime.title, '已超时');
assert.equal(overtime.value, '+01:10');
assert.match(overtime.hint, /仍可继续作答/);
assert.match(overtime.hint, /不会自动提交/);

const brokenStartedSession = deriveInterviewStartState({
  messages: []
});

assert.equal(brokenStartedSession.hasInterviewStarted, false);

const serverStartedSessionWithoutVisibleTurns = deriveInterviewStartState({
  messages: [],
  startedAt: '2026-05-05T09:52:49.592+00:00',
  status: 'in_progress',
  sessionId: 'session-1'
});

assert.equal(serverStartedSessionWithoutVisibleTurns.hasInterviewStarted, true);

const visibleQuestionSession = deriveInterviewStartState({
  messages: [{ speaker: 'ai', kind: 'question', content: 'Q1' }]
});

assert.equal(visibleQuestionSession.hasInterviewStarted, true);

const inProgressMetrics = deriveInterviewQuestionMetrics(
  [
    { speaker: 'ai', kind: 'question', content: 'Q1' },
    { speaker: 'candidate', content: 'A1' },
    { speaker: 'ai', kind: 'question', content: 'Q2' },
    { speaker: 'candidate', content: 'A2' }
  ],
  4,
  false
);

assert.deepEqual(inProgressMetrics, {
  askedCount: 2,
  completedCount: 1,
  totalCount: 4,
  completionRate: 25
});

const followupBeyondPlanMetrics = deriveInterviewQuestionMetrics(
  [
    { speaker: 'ai', kind: 'question', content: 'Q1' },
    { speaker: 'candidate', content: 'A1' },
    { speaker: 'ai', kind: 'question', content: 'Q2 follow-up' }
  ],
  1,
  false
);

assert.deepEqual(followupBeyondPlanMetrics, {
  askedCount: 2,
  completedCount: 1,
  totalCount: 2,
  completionRate: 50
});

const unansweredFollowupMetrics = deriveInterviewQuestionMetrics(
  [
    { speaker: 'ai', kind: 'question', content: 'Q1' },
    { speaker: 'candidate', content: 'A1' },
    { speaker: 'ai', kind: 'question', content: 'Q2' },
    { speaker: 'candidate', content: 'A2' },
    { speaker: 'ai', kind: 'followup', content: 'Q2 follow-up' }
  ],
  2,
  false
);

assert.deepEqual(unansweredFollowupMetrics, {
  askedCount: 2,
  completedCount: 2,
  totalCount: 2,
  completionRate: 100
});

const finalizedMetrics = deriveInterviewQuestionMetrics(
  [
    { speaker: 'ai', kind: 'question', content: 'Q1' },
    { speaker: 'candidate', content: 'A1' },
    { speaker: 'ai', kind: 'question', content: 'Q2' },
    { speaker: 'candidate', content: 'A2' }
  ],
  2,
  true
);

assert.deepEqual(finalizedMetrics, {
  askedCount: 2,
  completedCount: 2,
  totalCount: 2,
  completionRate: 100
});

console.log('interviewRoomState tests passed');
