const PENDING_FINAL_REPORT_TEXT =
  'The AI interview is complete and waiting for human confirmation before the final report is generated.';

const RECOMMENDATION_LABELS: Record<string, string> = {
  hire: '建议通过',
  hold: '建议保留',
  needs_review: '建议复核',
  reject: '建议淘汰'
};

export function normalizeReportText(value: string | null | undefined): string {
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (text === PENDING_FINAL_REPORT_TEXT) {
    return 'AI 面试已完成，正在等待生成最终评分报告。';
  }

  const simpleSummary = text.match(/^Recommendation:\s*([a-z_]+)\.\s*Overall score:\s*(\d+|-)\.$/i);
  if (simpleSummary) {
    const recommendation = RECOMMENDATION_LABELS[simpleSummary[1].toLowerCase()] ?? '建议复核';
    return `建议结论：${recommendation}。\n综合得分：${simpleSummary[2]} 分。`;
  }

  return text
    .replace(/^Recommendation:\s*/i, '建议结论：')
    .replace(/\bOverall score:\s*/gi, '综合得分：')
    .replace(/\bStrengths:\s*/gi, '\n优势：')
    .replace(/\bRisks:\s*/gi, '\n风险：')
    .replace(/([。；;])\s*(综合得分|优势|风险|有效回答|最低有效回答要求|缺失点|建议方向|改进建议)[:：]/g, '$1\n$2：')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
