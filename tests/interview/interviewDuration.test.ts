import assert from 'node:assert/strict';
import {
  DEFAULT_INTERVIEW_DURATION_MINUTES,
  getInterviewDurationMinutesForQuestionCount,
  normalizeInterviewDuration,
} from '../../src/lib/interviewDuration.ts';

assert.equal(normalizeInterviewDuration(15), 15);
assert.equal(normalizeInterviewDuration('15'), 15);
assert.equal(normalizeInterviewDuration(25), DEFAULT_INTERVIEW_DURATION_MINUTES);
assert.equal(normalizeInterviewDuration(null), DEFAULT_INTERVIEW_DURATION_MINUTES);

assert.equal(getInterviewDurationMinutesForQuestionCount(3), 15);
assert.equal(getInterviewDurationMinutesForQuestionCount('5'), 20);
assert.equal(getInterviewDurationMinutesForQuestionCount(8), 30);
assert.equal(getInterviewDurationMinutesForQuestionCount(10), 45);

console.log('interviewDuration tests passed');
