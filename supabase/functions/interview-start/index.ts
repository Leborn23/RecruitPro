import { createAdminClient, requireAuth } from '../_shared/auth.ts';
import { HttpError, errorResponse, handleCors, jsonResponse, nowIso, readJsonBody } from '../_shared/http.ts';
import {
  buildJobDescriptionText,
  buildResumeText,
  invokeAgentStart,
  loadAgentLlmConfig,
  mapAgentPlanToQuestionPlan,
  mapJobContextToJobProfile,
  mapResumeContextToCandidateProfile
} from '../_shared/agentGateway.ts';

interface StartPayload {
  interviewId?: string;
  sessionId?: string;
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

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  try {
    const { client, user } = await requireAuth(req);
    const adminClient = createAdminClient();
    const body = await readJsonBody<StartPayload>(req);

    const interviewId = String(body.interviewId ?? '').trim();
    const sessionId = String(body.sessionId ?? '').trim();

    if (!interviewId || !sessionId) {
      throw new HttpError(400, 'interviewId and sessionId are required');
    }

    const { data: session, error: sessionError } = await client
      .from('interview_sessions')
      .select('id,interview_id,status,question_plan,started_at,candidate_id,position_id')
      .eq('id', sessionId)
      .single();

    if (sessionError || !session) {
      throw new HttpError(404, 'Session not found');
    }

    if (String(session.interview_id) !== interviewId) {
      throw new HttpError(400, 'Session and interview mismatch');
    }

    const candidateId = String(session.candidate_id ?? '').trim();
    const positionId = String(session.position_id ?? '').trim();
    if (!candidateId || !positionId) {
      throw new HttpError(400, 'Session missing candidate_id or position_id');
    }

    const { data: candidate, error: candidateError } = await client
      .from('candidates')
      .select('id,name,title,prev_company,highlight')
      .eq('id', candidateId)
      .single();

    if (candidateError || !candidate) {
      throw new HttpError(404, 'Candidate not found');
    }

    const { data: position, error: positionError } = await client
      .from('active_positions')
      .select('id,title,department,technical_requirements,min_exp,min_edu')
      .eq('id', positionId)
      .single();

    if (positionError || !position) {
      throw new HttpError(404, 'Position not found');
    }

    const { data: profile } = await client
      .from('parsed_resume_profiles')
      .select('id,explicit_skills,inferred_skills,work_experience,basic_profile,parser_raw_json')
      .eq('candidate_id', candidateId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const profileId = String(profile?.id ?? '').trim();
    const { data: projects } = profileId
      ? await client
          .from('parsed_resume_projects')
          .select('project_name,project_summary,candidate_role,tech_stack')
          .eq('profile_id', profileId)
          .order('project_index', { ascending: true })
          .limit(5)
      : { data: [] };

    const { data: parsedRequirement } = await client
      .from('parsed_job_requirements')
      .select('source_text,must_have_skills,nice_to_have_skills,core_responsibilities')
      .eq('position_id', positionId)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const resumeText = buildResumeText({
      candidate,
      profile,
      projects: projects ?? []
    });
    const candidateProfile = mapResumeContextToCandidateProfile({
      candidate,
      profile,
      projects: projects ?? []
    });
    const jdText = buildJobDescriptionText({
      position,
      parsedRequirement
    });
    const jobProfile = mapJobContextToJobProfile({
      position,
      parsedRequirement
    });
    const llmConfig = await loadAgentLlmConfig(adminClient);

    const agentResponse = await invokeAgentStart({
      session_id: sessionId,
      resume_text: resumeText,
      jd_text: jdText,
      candidate_profile: candidateProfile,
      job_profile: jobProfile,
      llm_config: llmConfig
    });

    const now = nowIso();
    const mappedPlan = mapAgentPlanToQuestionPlan(agentResponse.interview_plan);

    const { error: updateSessionError } = await client
      .from('interview_sessions')
      .update({
        status: 'running',
        started_at: session.started_at ?? now,
        question_plan: mappedPlan
      })
      .eq('id', sessionId);

    if (updateSessionError) {
      throw new HttpError(500, `Start session failed: ${updateSessionError.message}`);
    }

    const { data: interview, error: interviewError } = await client
      .from('upcoming_interviews')
      .select('id,started_at')
      .eq('id', interviewId)
      .single();

    if (interviewError || !interview) {
      throw new HttpError(404, 'Interview not found');
    }

    const { error: updateInterviewError } = await client
      .from('upcoming_interviews')
      .update({
        status: 'in_progress',
        session_id: sessionId,
        started_at: interview.started_at ?? now,
        updated_by: user.id
      })
      .eq('id', interviewId);

    if (updateInterviewError) {
      throw new HttpError(500, `Update interview failed: ${updateInterviewError.message}`);
    }

    const { data: existingAiRows } = await client
      .from('interview_turns')
      .select('id')
      .eq('session_id', sessionId)
      .eq('speaker', 'ai')
      .limit(1);

    const openingMessage = String(agentResponse.message ?? '').trim();
    let firstQuestion: string | null = null;

    if ((existingAiRows?.length ?? 0) === 0 && openingMessage) {
      const turnNo = await nextTurnNo(client, sessionId);
      const firstPlannedQuestion = agentResponse.interview_plan?.questions?.[0];
      const firstTopic = String(firstPlannedQuestion?.topic ?? '').trim();
      const firstGuidance = String(firstPlannedQuestion?.answer_guidance ?? '').trim();

      const { error: insertTurnError } = await client.from('interview_turns').insert([
        {
          session_id: sessionId,
          turn_no: turnNo,
          speaker: 'ai',
          content: openingMessage,
          input_mode: 'text',
          metadata: {
            kind: 'question',
            question_id: 'agent-1',
            topic: firstTopic,
            answer_guidance: firstGuidance,
            source: 'agent',
            step: 1
          }
        }
      ]);

      if (insertTurnError) {
        throw new HttpError(500, `Insert opening question failed: ${insertTurnError.message}`);
      }

      firstQuestion = openingMessage;
    }

    return jsonResponse(200, {
      ok: true,
      interview_id: interviewId,
      session_id: sessionId,
      status: 'running',
      first_question: firstQuestion,
      question_count: mappedPlan.length,
      agent_status: agentResponse.status ?? null
    });
  } catch (error) {
    return errorResponse(error);
  }
});
