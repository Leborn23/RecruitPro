import { requireAuth } from '../_shared/auth.ts';
import { HttpError, errorResponse, handleCors, jsonResponse, nowIso, readJsonBody } from '../_shared/http.ts';

interface FinishPayload {
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
    const body = await readJsonBody<FinishPayload>(req);

    const interviewId = String(body.interviewId ?? '').trim();
    const sessionId = String(body.sessionId ?? '').trim();

    if (!interviewId || !sessionId) {
      throw new HttpError(400, 'interviewId and sessionId are required');
    }

    const { data: session, error: sessionError } = await client
      .from('interview_sessions')
      .select('id,interview_id,status')
      .eq('id', sessionId)
      .single();

    if (sessionError || !session) {
      throw new HttpError(404, 'Session not found');
    }

    if (String(session.interview_id) !== interviewId) {
      throw new HttpError(400, 'Session and interview mismatch');
    }

    const now = nowIso();

    const { error: updateSessionError } = await client
      .from('interview_sessions')
      .update({
        status: 'scoring',
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
        ended_at: now,
        session_id: sessionId,
        updated_by: user.id
      })
      .eq('id', interviewId);

    if (updateInterviewError) {
      throw new HttpError(500, `Update interview failed: ${updateInterviewError.message}`);
    }

    const { data: turns } = await client
      .from('interview_turns')
      .select('speaker')
      .eq('session_id', sessionId);

    const candidateTurns = (turns ?? []).filter((turn: any) => turn.speaker === 'candidate').length;
    const aiTurns = (turns ?? []).filter((turn: any) => turn.speaker === 'ai').length;

    return jsonResponse(200, {
      ok: true,
      interview_id: interviewId,
      session_id: sessionId,
      status: 'scoring',
      candidate_turns: candidateTurns,
      ai_turns: aiTurns
    });
  } catch (error) {
    return errorResponse(error);
  }
});
