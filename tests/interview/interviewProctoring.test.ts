import assert from 'node:assert/strict';
import {
  buildSnapshotPath,
  deriveProctoringSeverity,
  shouldOpenTimedEvent,
  summarizeProctoringEvents,
  type ProctoringEventRow,
} from '../../src/lib/interviewProctoring.ts';

assert.equal(deriveProctoringSeverity({ type: 'camera_closed' }), 'high');
assert.equal(deriveProctoringSeverity({ type: 'multiple_faces' }), 'high');
assert.equal(deriveProctoringSeverity({ type: 'no_face', durationMs: 5200 }), 'medium');
assert.equal(deriveProctoringSeverity({ type: 'off_screen_attention', durationMs: 9000 }), 'medium');
assert.equal(deriveProctoringSeverity({ type: 'page_hidden', durationMs: 12000 }), 'medium');
assert.equal(deriveProctoringSeverity({ type: 'window_blur' }), 'low');

assert.equal(shouldOpenTimedEvent('no_face', 4999), false);
assert.equal(shouldOpenTimedEvent('no_face', 5000), true);
assert.equal(shouldOpenTimedEvent('multiple_faces', 2999), false);
assert.equal(shouldOpenTimedEvent('multiple_faces', 3000), true);
assert.equal(shouldOpenTimedEvent('off_screen_attention', 8000), true);
assert.equal(shouldOpenTimedEvent('page_hidden', 10000), true);

assert.equal(
  buildSnapshotPath({
    interviewId: 'interview-1',
    sessionId: 'session-1',
    eventType: 'multiple_faces',
    timestamp: '2026-05-06T10:11:12.000Z',
  }),
  'interview-1/session-1/multiple_faces-2026-05-06T10-11-12-000Z.webp'
);

const events: ProctoringEventRow[] = [
  {
    id: 'event-1',
    interviewId: 'interview-1',
    sessionId: 'session-1',
    type: 'multiple_faces',
    severity: 'high',
    occurredAt: '2026-05-06T10:11:12.000Z',
  },
  {
    id: 'event-2',
    interviewId: 'interview-1',
    sessionId: 'session-1',
    type: 'page_hidden',
    severity: 'medium',
    occurredAt: '2026-05-06T10:12:12.000Z',
  },
];

const summary = summarizeProctoringEvents(events);

assert.equal(summary.eventCount, 2);
assert.equal(summary.highCount, 1);
assert.equal(summary.mediumCount, 1);
assert.equal(summary.riskScore, 45);
assert.match(summary.summaryText, /多人入镜/);
assert.match(summary.summaryText, /页面离开/);

console.log('interviewProctoring tests passed');
