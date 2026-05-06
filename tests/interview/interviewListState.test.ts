import assert from 'node:assert/strict';
import { removeInterviewFromLocalState } from '../../src/lib/interviewListState.ts';

const result = removeInterviewFromLocalState(
  [
    { id: 'interview-1', name: 'A' },
    { id: 'interview-2', name: 'B' }
  ],
  {
    'interview-1': { id: 'report-1' },
    'interview-2': { id: 'report-2' }
  },
  'interview-1'
);

assert.deepEqual(result.rows, [{ id: 'interview-2', name: 'B' }]);
assert.deepEqual(result.reportsByInterviewId, { 'interview-2': { id: 'report-2' } });

console.log('interviewListState tests passed');
