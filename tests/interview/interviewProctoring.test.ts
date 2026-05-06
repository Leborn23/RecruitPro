import assert from 'node:assert/strict';
import {
  buildSnapshotPath,
  deriveProctoringSeverity,
  resolveTimedEventSession,
  shouldOpenTimedEvent,
  summarizeProctoringEvents,
  type ProctoringEventRow,
} from '../../src/lib/interviewProctoring.ts';

assert.equal(deriveProctoringSeverity('camera_denied', 0), 'high');
assert.equal(deriveProctoringSeverity('camera_closed', 0), 'high');
assert.equal(deriveProctoringSeverity('multiple_faces', 0), 'high');
assert.equal(deriveProctoringSeverity('no_face', 5200), 'medium');
assert.equal(deriveProctoringSeverity('off_screen_attention', 9000), 'medium');
assert.equal(deriveProctoringSeverity('page_hidden', 12000), 'medium');
assert.equal(deriveProctoringSeverity('window_blur', 0), 'low');

assert.equal(shouldOpenTimedEvent('no_face', 799), false);
assert.equal(shouldOpenTimedEvent('no_face', 800), true);
assert.equal(shouldOpenTimedEvent('multiple_faces', 799), false);
assert.equal(shouldOpenTimedEvent('multiple_faces', 800), true);
assert.equal(shouldOpenTimedEvent('off_screen_attention', 999), false);
assert.equal(shouldOpenTimedEvent('off_screen_attention', 1000), true);
assert.equal(shouldOpenTimedEvent('page_hidden', 10000), true);

assert.equal(resolveTimedEventSession(null, 'session-1'), null);
assert.equal(resolveTimedEventSession('preview-session', 'session-1'), null);
assert.equal(resolveTimedEventSession('session-1', null), null);
assert.equal(resolveTimedEventSession('session-1', 'session-1'), 'session-1');

assert.equal(
  buildSnapshotPath({
    interviewId: 'interview-1',
    sessionId: 'session-1',
    eventType: 'multiple_faces',
    timestampMs: new Date('2026-05-06T10:11:12.000Z').getTime(),
  }),
  'interview-1/session-1/multiple_faces-2026-05-06T10-11-12-000Z.webp'
);

const events: ProctoringEventRow[] = [
  {
    id: 'event-1',
    interview_id: 'interview-1',
    session_id: 'session-1',
    event_type: 'multiple_faces',
    severity: 'high',
    confidence: 0.98,
    started_at: '2026-05-06T10:11:12.000Z',
    ended_at: null,
    duration_ms: 3000,
    snapshot_paths: ['interview-1/session-1/multiple_faces-2026-05-06T10-11-12-000Z.webp'],
    metadata: {},
  },
  {
    id: 'event-2',
    interview_id: 'interview-1',
    session_id: 'session-1',
    event_type: 'page_hidden',
    severity: 'medium',
    confidence: 1,
    started_at: '2026-05-06T10:12:12.000Z',
    ended_at: '2026-05-06T10:12:22.000Z',
    duration_ms: 10000,
    snapshot_paths: [],
    metadata: { hidden: true },
  },
];

const summary = summarizeProctoringEvents(events);

assert.equal(summary.eventCount, 2);
assert.equal(summary.highCount, 1);
assert.equal(summary.mediumCount, 1);
assert.equal(summary.lowCount, 0);
assert.equal(summary.riskScore, 35);
assert.match(summary.summaryText, /多人入镜/);
assert.match(summary.summaryText, /页面离开/);

console.log('interviewProctoring tests passed');
