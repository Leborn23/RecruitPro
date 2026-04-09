import { requireAuth } from '../_shared/auth.ts';
import { HttpError, errorResponse, handleCors, jsonResponse, nowIso, readJsonBody } from '../_shared/http.ts';
import { invokeAgentStatus, mapAgentReportToInterviewReport } from '../_shared/agentGateway.ts';

interface ScorePayload {
  interviewId?: string;
  sessionId?: string;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  try {
    const { client, user } = await requireAuth(req);
    const body = await readJsonBody<ScorePayload>(req);

    const interviewId = String(body.interviewId ?? '').trim();
    const sessionId = String(body.sessionId ?? '').trim();

    if (!interviewId || !sessionId) {
      throw new HttpError(400, 'interviewId and sessionId are required');
    }

    const { data: session, error: sessionError } = await client
      .from('interview_sessions')
      .select('id,interview_id,candidate_id,status')
      .eq('id', sessionId)
      .single();

    if (sessionError || !session) {
      throw new HttpError(404, 'Session not found');
    }

    if (String(session.interview_id) !== interviewId) {
      throw new HttpError(400, 'Session and interview mismatch');
    }

    const agentStatus = await invokeAgentStatus(sessionId);
    const finalReport = agentStatus.response?.final_report ?? null;

    if (!finalReport) {
      const pendingSummary =
        'The AI interview is complete and waiting for human confirmation before the final report is generated.';
      const { data: pendingReport, error: reportError } = await client
        .from('interview_reports')
        .upsert(
          [
            {
              session_id: sessionId,
              interview_id: interviewId,
              candidate_id: session.candidate_id,
              recommendation: 'needs_review',
              summary: pendingSummary,
              evidence: [
                {
                  agent_status: agentStatus.response?.status ?? 'unknown',
                  state_snapshot: agentStatus.state_snapshot ?? {}
                }
              ],
              generated_by: user.id,
              updated_at: nowIso()
            }
          ],
          { onConflict: 'session_id' }
        )
        .select('id,overall_score,recommendation,risk_score,summary,dimension_scores,strengths,risks,evidence')
        .single();

      if (reportError || !pendingReport) {
        throw new HttpError(500, `Write pending report failed: ${reportError?.message ?? 'unknown error'}`);
      }

      return jsonResponse(200, {
        ok: true,
        interview_id: interviewId,
        session_id: sessionId,
        report: pendingReport,
        pending_human_review: true
      });
    }

    const mapped = mapAgentReportToInterviewReport(finalReport);
    const { data: report, error: reportError } = await client
      .from('interview_reports')
      .upsert(
        [
          {
            session_id: sessionId,
            interview_id: interviewId,
            candidate_id: session.candidate_id,
            overall_score: mapped.overall_score,
            dimension_scores: mapped.dimension_scores,
            strengths: mapped.strengths,
            risks: mapped.risks,
            recommendation: mapped.recommendation,
            evidence: mapped.evidence,
            summary: mapped.summary,
            risk_score: mapped.risk_score,
            generated_by: user.id,
            updated_at: nowIso()
          }
        ],
        { onConflict: 'session_id' }
      )
      .select('id,overall_score,recommendation,risk_score,summary,dimension_scores,strengths,risks,evidence')
      .single();

    if (reportError || !report) {
      throw new HttpError(500, `Write report failed: ${reportError?.message ?? 'unknown error'}`);
    }

    const now = nowIso();
    const { error: updateSessionError } = await client
      .from('interview_sessions')
      .update({ status: 'done', ended_at: now })
      .eq('id', sessionId);

    if (updateSessionError) {
      throw new HttpError(500, `Update session failed: ${updateSessionError.message}`);
    }

    const { error: updateInterviewError } = await client
      .from('upcoming_interviews')
      .update({
        status: 'completed',
        ai_report_id: report.id,
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
      report
    });
  } catch (error) {
    return errorResponse(error);
  }
});
