import { createAdminClient, requireAuth } from '../_shared/auth.ts';
import { HttpError, errorResponse, handleCors, jsonResponse, nowIso, readJsonBody } from '../_shared/http.ts';
import { invokeAgentAnswer, loadAgentLlmConfig } from '../_shared/agentGateway.ts';

interface TurnPayload {
  sessionId?: string;
  speaker?: 'system' | 'ai' | 'candidate' | 'interviewer';
  content?: string;
  inputMode?: 'text' | 'audio' | 'video' | 'metadata';
  metadata?: Record<string, unknown>;
}

async function nextTurnNo(client: any, sessionId: string): Promise<number> {
  const { data } = await client
    .from('interview_turns')
    .select('turn_no')
    .eq('session_id', sessionId)
    .order('turn_no', { ascending: false })
    .limit(1);

  const latest = data?.[0]?.turn_no ?? 0;
  return Number(latest) + 1;
}

function getMetaKind(meta: unknown): string {
  if (!meta || typeof meta !== 'object') return '';
  const kind = (meta as Record<string, unknown>).kind;
  return typeof kind === 'string' ? kind : '';
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  try {
    const { client } = await requireAuth(req);
    const adminClient = createAdminClient();
    const body = await readJsonBody<TurnPayload>(req);

    const sessionId = String(body.sessionId ?? '').trim();
    const speaker = body.speaker;
    const content = String(body.content ?? '').trim();
    const inputMode = body.inputMode ?? 'text';

    if (!sessionId || !speaker || !content) {
      throw new HttpError(400, 'sessionId, speaker and content are required');
    }

    const { data: session, error: sessionError } = await client
      .from('interview_sessions')
      .select('id,status,started_at')
      .eq('id', sessionId)
      .single();

    if (sessionError || !session) {
      throw new HttpError(404, 'Session not found');
    }

    if (!['running', 'ready'].includes(String(session.status))) {
      throw new HttpError(400, `Session status ${session.status} does not accept turns`);
    }

    if (String(session.status) === 'ready') {
      await client
        .from('interview_sessions')
        .update({ status: 'running', started_at: session.started_at ?? nowIso() })
        .eq('id', sessionId);
    }

    const turnNo = await nextTurnNo(client, sessionId);
    const turnMeta = body.metadata ?? {};

    const { data: insertedTurn, error: insertTurnError } = await client
      .from('interview_turns')
      .insert([
        {
          session_id: sessionId,
          turn_no: turnNo,
          speaker,
          content,
          input_mode: inputMode,
          metadata: turnMeta
        }
      ])
      .select('id,turn_no,speaker,content,metadata,created_at')
      .single();

    if (insertTurnError || !insertedTurn) {
      throw new HttpError(500, `Insert turn failed: ${insertTurnError?.message ?? 'unknown error'}`);
    }

    let aiReply: { turn_no: number; content: string; kind: string } | null = null;

    if (speaker === 'candidate') {
      const llmConfig = await loadAgentLlmConfig(adminClient);
      const { data: allTurns, error: allTurnsError } = await client
        .from('interview_turns')
        .select('id,turn_no,speaker,content,metadata')
        .eq('session_id', sessionId)
        .order('turn_no', { ascending: true });

      if (allTurnsError) {
        throw new HttpError(500, `Read turns failed: ${allTurnsError.message}`);
      }

      const askedQuestionCount = (allTurns ?? []).filter(
        (turn: any) => turn.speaker === 'ai' && getMetaKind(turn.metadata) === 'question'
      ).length;

      const agentResponse = await invokeAgentAnswer({
        session_id: sessionId,
        user_answer: content,
        llm_config: llmConfig
      });

      const currentAskedCount = Number(agentResponse.state_snapshot?.asked_question_count ?? askedQuestionCount);
      const agentStatus = String(agentResponse.status ?? '').trim().toLowerCase();

      let aiPrompt = String(agentResponse.message ?? '').trim();
      let aiKind = currentAskedCount > askedQuestionCount ? 'question' : 'followup';

      if (agentStatus === 'wait_for_review' || agentStatus === 'finish') {
        aiPrompt = aiPrompt || 'The structured interview is complete. Scoring will start next.';
        aiKind = 'closing';
      }

      if (aiPrompt) {
        const aiTurnNo = await nextTurnNo(client, sessionId);
        const { data: insertedAiTurn, error: insertAiTurnError } = await client
          .from('interview_turns')
          .insert([
            {
              session_id: sessionId,
              turn_no: aiTurnNo,
              speaker: 'ai',
              content: aiPrompt,
              input_mode: 'text',
              metadata: {
                kind: aiKind,
                source: 'agent',
                asked_question_count: currentAskedCount,
                answer_count: Number(agentResponse.state_snapshot?.answer_count ?? 0),
                next_nodes: agentResponse.state_snapshot?.next_nodes ?? []
              }
            }
          ])
          .select('turn_no,content,metadata')
          .single();

        if (insertAiTurnError || !insertedAiTurn) {
          throw new HttpError(500, `Insert AI reply failed: ${insertAiTurnError?.message ?? 'unknown error'}`);
        }

        aiReply = {
          turn_no: Number(insertedAiTurn.turn_no),
          content: String(insertedAiTurn.content),
          kind: aiKind
        };
      }
    }

    const { data: candidateTurnCountRows } = await client
      .from('interview_turns')
      .select('id', { count: 'exact' })
      .eq('session_id', sessionId)
      .eq('speaker', 'candidate');

    const candidateTurnCount = candidateTurnCountRows?.length ?? 0;

    return jsonResponse(200, {
      ok: true,
      session_id: sessionId,
      inserted_turn: insertedTurn,
      ai_reply: aiReply,
      candidate_turn_count: candidateTurnCount
    });
  } catch (error) {
    return errorResponse(error);
  }
});
