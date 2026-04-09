import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2';
import { HttpError } from './http.ts';

export interface AuthContext {
  client: SupabaseClient;
  user: User;
}

function getEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new HttpError(500, `Missing required env: ${name}`);
  }
  return value;
}

export function createUserClient(req: Request): SupabaseClient {
  const supabaseUrl = getEnv('SUPABASE_URL');
  const supabaseAnonKey = getEnv('SUPABASE_ANON_KEY');
  const authorization = req.headers.get('Authorization') ?? '';

  if (!authorization.toLowerCase().startsWith('bearer ')) {
    throw new HttpError(401, 'Missing bearer token');
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: authorization
      }
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

export function createAdminClient(): SupabaseClient {
  const supabaseUrl = getEnv('SUPABASE_URL');
  const serviceRoleKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

export async function requireAuth(req: Request): Promise<AuthContext> {
  const client = createUserClient(req);
  const {
    data: { user },
    error
  } = await client.auth.getUser();

  if (error || !user) {
    throw new HttpError(401, 'Unauthorized');
  }

  return { client, user };
}
