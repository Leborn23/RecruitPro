import assert from 'node:assert/strict';
import { normalizeReportText } from '../../src/lib/reportText.ts';

const pending = normalizeReportText(
  'The AI interview is complete and waiting for human confirmation before the final report is generated.'
);
assert.ok(pending.length > 0);
assert.equal(pending.includes('The AI interview is complete'), false);

const summary = normalizeReportText('Recommendation: hold. Overall score: 76.');
assert.ok(summary.length > 0);
assert.equal(summary.includes('Recommendation:'), false);
assert.equal(summary.includes('Overall score:'), false);
assert.ok(summary.includes('76'));

assert.equal(normalizeReportText(''), '');

console.log('reportText tests passed');
