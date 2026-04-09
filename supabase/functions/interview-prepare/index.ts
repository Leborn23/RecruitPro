import { requireAuth } from '../_shared/auth.ts';
import { HttpError, errorResponse, handleCors, jsonResponse, nowIso, readJsonBody } from '../_shared/http.ts';
import { buildQuestionPlan, extractSkillsFromRequirement, type CandidateLight, type PositionLight } from '../_shared/interview.ts';

interface PreparePayload {
  interviewId?: string;
  candidateId?: string;
  positionId?: string;
  mode?: 'async_qa' | 'ai_live' | 'ai_copilot';
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const output: string[] = [];
  for (const item of value) {
    if (typeof item === 'string') {
      const text = normalizeText(item);
      if (text) output.push(text);
      continue;
    }

    if (item && typeof item === 'object') {
      const record = item as Record<string, unknown>;
      const candidate =
        normalizeText(record.name) ||
        normalizeText(record.skill) ||
        normalizeText(record.value) ||
        normalizeText(record.label) ||
        normalizeText(record.summary) ||
        normalizeText(record.title);
      if (candidate) output.push(candidate);
    }
  }

  return output;
}

function toWorkHints(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const hints: string[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;

    const company = normalizeText(record.company);
    const role = normalizeText(record.title) || normalizeText(record.role) || normalizeText(record.position);
    const summary = normalizeText(record.summary) || normalizeText(record.description);

    const merged = [company, role, summary].filter(Boolean).join(' / ');
    if (merged) {
      hints.push(merged);
      continue;
    }

    const responsibilities = toStringArray(record.responsibilities).slice(0, 2).join('；');
    if (responsibilities) hints.push(responsibilities);
  }

  return hints;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  try {
    const { client, user } = await requireAuth(req);
    const body = await readJsonBody<PreparePayload>(req);

    const interviewId = String(body.interviewId ?? '').trim();
    const candidateId = String(body.candidateId ?? '').trim();
    const positionId = String(body.positionId ?? '').trim();
    const mode = body.mode ?? 'async_qa';

    if (!interviewId || !candidateId || !positionId) {
      throw new HttpError(400, 'interviewId, candidateId, positionId are required');
    }

    const { data: interview, error: interviewError } = await client
      .from('upcoming_interviews')
      .select('id,status,candidate_id')
      .eq('id', interviewId)
      .single();

    if (interviewError || !interview) {
      throw new HttpError(404, 'Interview not found');
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

    let resumeSkills: string[] = [];
    let resumeWorkItems: string[] = [];
    let resumeProjects: string[] = [];

    const { data: parsedProfile } = await client
      .from('parsed_resume_profiles')
      .select('id,explicit_skills,inferred_skills,work_experience')
      .eq('candidate_id', candidateId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (parsedProfile) {
      resumeSkills = [...toStringArray(parsedProfile.explicit_skills), ...toStringArray(parsedProfile.inferred_skills)].slice(0, 12);
      resumeWorkItems = toWorkHints(parsedProfile.work_experience).slice(0, 5);

      const profileId = String(parsedProfile.id ?? '').trim();
      if (profileId) {
        const { data: parsedProjects } = await client
          .from('parsed_resume_projects')
          .select('project_name,project_summary,candidate_role,tech_stack')
          .eq('profile_id', profileId)
          .order('project_index', { ascending: true })
          .limit(4);

        if (Array.isArray(parsedProjects)) {
          resumeProjects = parsedProjects
            .map((project: any) => {
              const name = normalizeText(project.project_name);
              const role = normalizeText(project.candidate_role);
              const summary = normalizeText(project.project_summary);
              const stack = toStringArray(project.tech_stack).slice(0, 3).join('、');
              return [name, role, summary, stack ? `技术栈: ${stack}` : ''].filter(Boolean).join(' / ');
            })
            .filter(Boolean)
            .slice(0, 4);
        }
      }
    }

    const candidateLight: CandidateLight = {
      ...(candidate as CandidateLight),
      resume_skills: resumeSkills,
      resume_projects: resumeProjects,
      resume_work_items: resumeWorkItems
    };

    const positionLight = position as PositionLight;

    const questionPlan = buildQuestionPlan(candidateLight, positionLight);
    const skills = extractSkillsFromRequirement(positionLight.technical_requirements);
    const contextPayload = {
      candidate: {
        id: candidateLight.id,
        name: candidateLight.name,
        title: candidateLight.title,
        prev_company: candidateLight.prev_company,
        resume_skills: resumeSkills,
        resume_projects: resumeProjects,
        resume_work_items: resumeWorkItems
      },
      position: {
        id: positionLight.id,
        title: positionLight.title,
        department: positionLight.department,
        min_exp: positionLight.min_exp,
        min_edu: positionLight.min_edu
      },
      skills,
      rubric_version: 'v2-core-and-personalized',
      prepared_by: user.id,
      prepared_at: nowIso()
    };

    const { data: existingSessionRows } = await client
      .from('interview_sessions')
      .select('id,status')
      .eq('interview_id', interviewId)
      .in('status', ['preparing', 'ready', 'running', 'scoring'])
      .order('created_at', { ascending: false })
      .limit(1);

    const existingSession = existingSessionRows?.[0] ?? null;
    let sessionId = '';

    if (existingSession?.id) {
      const { data: updatedSession, error: updateSessionError } = await client
        .from('interview_sessions')
        .update({
          candidate_id: candidateId,
          position_id: positionId,
          mode,
          status: 'ready',
          question_plan: questionPlan,
          context_payload: contextPayload
        })
        .eq('id', existingSession.id)
        .select('id,status,mode,question_plan')
        .single();

      if (updateSessionError || !updatedSession) {
        throw new HttpError(500, `Prepare session failed: ${updateSessionError?.message ?? 'unknown error'}`);
      }

      sessionId = String(updatedSession.id);
    } else {
      const { data: insertedSession, error: insertSessionError } = await client
        .from('interview_sessions')
        .insert([
          {
            interview_id: interviewId,
            candidate_id: candidateId,
            position_id: positionId,
            mode,
            status: 'ready',
            question_plan: questionPlan,
            context_payload: contextPayload
          }
        ])
        .select('id,status,mode,question_plan')
        .single();

      if (insertSessionError || !insertedSession) {
        throw new HttpError(500, `Create session failed: ${insertSessionError?.message ?? 'unknown error'}`);
      }

      sessionId = String(insertedSession.id);
    }

    const { error: updateInterviewError } = await client
      .from('upcoming_interviews')
      .update({
        candidate_id: candidateId,
        status: 'ready',
        session_id: sessionId,
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
      question_count: questionPlan.length,
      mode,
      question_plan: questionPlan
    });
  } catch (error) {
    return errorResponse(error);
  }
});
