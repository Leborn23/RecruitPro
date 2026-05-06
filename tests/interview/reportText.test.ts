import assert from 'node:assert/strict';
import { normalizeReportText } from '../../src/lib/reportText.ts';

assert.equal(
  normalizeReportText('The AI interview is complete and waiting for human confirmation before the final report is generated.'),
  'AI 面试已完成，正在等待生成最终评分报告。'
);

assert.equal(normalizeReportText('Recommendation: hold. Overall score: 76.'), '建议结论：建议保留。综合得分：76 分。');

assert.equal(normalizeReportText(''), '');

console.log('reportText tests passed');
