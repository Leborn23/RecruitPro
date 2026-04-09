import { createClient } from 'npm:@supabase/supabase-js@2';
import { requireAuth } from '../_shared/auth.ts';
import { HttpError, errorResponse, handleCors, jsonResponse, nowIso, readJsonBody } from '../_shared/http.ts';

interface RoomPasswordPayload {
  action?: 'issue' | 'verify';
  interviewId?: string;
  password?: string;
}

function getEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new HttpError(500, `Missing required env: ${name}`);
  return value;
}

function createServiceClient() {
  const supabaseUrl = getEnv('SUPABASE_URL');
  const serviceRoleKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

function randomPassword(length = 8): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const values = new Uint8Array(length);
  crypto.getRandomValues(values);
  return Array.from(values, (v) => alphabet[v % alphabet.length]).join('');
}

function randomHex(bytes = 16): string {
  const values = new Uint8Array(bytes);
  crypto.getRandomValues(values);
  return Array.from(values, (v) => v.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(a: string, b: string): boolean {
  const max = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < max; i += 1) {
    const av = i < a.length ? a.charCodeAt(i) : 0;
    const bv = i < b.length ? b.charCodeAt(i) : 0;
    diff |= av ^ bv;
  }
  return diff === 0;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  try {
    const body = await readJsonBody<RoomPasswordPayload>(req);
    const action = String(body.action ?? '').trim();
    const interviewId = String(body.interviewId ?? '').trim();

    if (!action || !interviewId) {
      throw new HttpError(400, 'action and interviewId are required');
    }

    if (action === 'issue') {
      const { client, user } = await requireAuth(req);
      const password = randomPassword(8);
      const salt = randomHex(16);
      const hash = await sha256Hex(`${password}:${salt}`);

      const { error: updateError } = await client
        .from('upcoming_interviews')
        .update({
          room_password: null,
          room_password_hash: hash,
          room_password_salt: salt,
          room_password_set_at: nowIso(),
          updated_by: user.id
        })
        .eq('id', interviewId);

      if (updateError) {
        throw new HttpError(500, `Issue room password failed: ${updateError.message}`);
      }

      return jsonResponse(200, {
        ok: true,
        interview_id: interviewId,
        password
      });
    }

    if (action === 'verify') {
      const serviceClient = createServiceClient();
      const inputPassword = String(body.password ?? '').trim();

      const { data: interview, error: queryError } = await serviceClient
        .from('upcoming_interviews')
        .select('id,room_password_hash,room_password_salt,room_password_set_at')
        .eq('id', interviewId)
        .single();

      if (queryError || !interview) {
        throw new HttpError(404, 'Interview not found');
      }

      const hash = String(interview.room_password_hash ?? '').trim();
      const salt = String(interview.room_password_salt ?? '').trim();
      const requiresPassword = !!String(interview.room_password_set_at ?? '').trim() || !!hash;

      if (!requiresPassword) {
        return jsonResponse(200, {
          ok: true,
          interview_id: interviewId,
          requires_password: false,
          verified: true
        });
      }

      if (!inputPassword) {
        return jsonResponse(200, {
          ok: true,
          interview_id: interviewId,
          requires_password: true,
          verified: false
        });
      }

      const inputHash = await sha256Hex(`${inputPassword}:${salt}`);
      const verified = constantTimeEqual(inputHash, hash);

      return jsonResponse(200, {
        ok: true,
        interview_id: interviewId,
        requires_password: true,
        verified
      });
    }

    throw new HttpError(400, 'Unsupported action');
  } catch (error) {
    return errorResponse(error);
  }
});
