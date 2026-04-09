import { requireAuth } from '../_shared/auth.ts';
import { HttpError, errorResponse, handleCors, jsonResponse, nowIso, readJsonBody } from '../_shared/http.ts';

interface HumanConfirmPayload {
  interviewId?: string;
  reportId?: string;
  confirmed?: boolean;
  finalRecommendation?: 'hire' | 'hold' | 'reject' | 'needs_review' | null;
  note?: string | null;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  try {
    const { client, user } = await requireAuth(req);
    const body = await readJsonBody<HumanConfirmPayload>(req);

    const interviewId = String(body.interviewId ?? '').trim();
    const reportId = String(body.reportId ?? '').trim();
    const confirmed = Boolean(body.confirmed);
    const finalRecommendation = body.finalRecommendation ?? null;
    const note = String(body.note ?? '').trim();

    if (!interviewId || !reportId) {
      throw new HttpError(400, 'interviewId and reportId are required');
    }

    const { data: reportRow, error: reportError } = await client
      .from('interview_reports')
      .select(
        'id,session_id,interview_id,candidate_id,overall_score,dimension_scores,strengths,risks,recommendation,evidence,summary,risk_score'
      )
      .eq('id', reportId)
      .single();

    if (reportError || !reportRow) {
      throw new HttpError(404, 'Report not found');
    }

    if (String(reportRow.interview_id) !== interviewId) {
      throw new HttpError(400, 'Report and interview mismatch');
    }

    const sessionId = String(reportRow.session_id ?? '').trim();
    if (!sessionId) {
      throw new HttpError(400, 'Report missing session_id');
    }

    const recommendation = finalRecommendation ?? reportRow.recommendation ?? (confirmed ? 'hire' : 'reject');
    const now = nowIso();
    const mergedSummary = note
      ? `${String(reportRow.summary ?? '').trim()}\n\nHuman review note: ${note}`.trim()
      : reportRow.summary;

    const { data: updatedReport, error: updateReportError } = await client
      .from('interview_reports')
      .update({
        overall_score: reportRow.overall_score,
        dimension_scores: reportRow.dimension_scores,
        strengths: reportRow.strengths,
        risks: reportRow.risks,
        recommendation,
        evidence: reportRow.evidence,
        summary: mergedSummary,
        risk_score: reportRow.risk_score,
        human_confirmed: confirmed,
        human_confirmed_by: user.id,
        human_confirmed_at: now,
        updated_at: now
      })
      .eq('id', reportId)
      .select('id,overall_score,recommendation,risk_score,summary,dimension_scores,strengths,risks,evidence,human_confirmed,human_confirmed_by,human_confirmed_at')
      .single();

    if (updateReportError || !updatedReport) {
      throw new HttpError(500, `Update report failed: ${updateReportError?.message ?? 'unknown error'}`);
    }

    const { error: updateSessionError } = await client
      .from('interview_sessions')
      .update({
        status: 'done',
        ended_at: now
      })
      .eq('id', sessionId);

    if (updateSessionError) {
      throw new HttpError(500, `Update session failed: ${updateSessionError.message}`);
    }

    const { error: updateInterviewError } = await client
      .from('upcoming_interviews')
      .update({
        status: 'completed',
        ai_report_id: reportId,
        ended_at: now,
        updated_by: user.id
      })
      .eq('id', interviewId);

    if (updateInterviewError) {
      throw new HttpError(500, `Update interview failed: ${updateInterviewError.message}`);
    }

    return jsonResponse(200, {
      ok: true,
      interview_id: interviewId,
      session_id: sessionId,
      report: updatedReport
    });
  } catch (error) {
    return errorResponse(error);
  }
});
