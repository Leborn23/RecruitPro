export function removeInterviewFromLocalState<Row extends { id: string }, Report>(
  rows: Row[],
  reportsByInterviewId: Record<string, Report>,
  interviewId: string
): { rows: Row[]; reportsByInterviewId: Record<string, Report> } {
  const nextReports = { ...reportsByInterviewId };
  delete nextReports[interviewId];

  return {
    rows: rows.filter((row) => row.id !== interviewId),
    reportsByInterviewId: nextReports
  };
}
