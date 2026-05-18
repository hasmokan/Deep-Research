import { createClient, type Session } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const authCallbackPath = process.env.NEXT_PUBLIC_AUTH_CALLBACK_PATH || '/auth/callback';

let client: ReturnType<typeof createClient> | null = null;

export function isSupabaseAuthConfigured() {
  return Boolean(supabaseUrl && supabasePublishableKey);
}

export function getSupabaseClient() {
  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error('Supabase auth is not configured');
  }

  if (!client) {
    client = createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
      },
    });
  }

  return client;
}

export async function signInWithGoogle() {
  const redirectTo = `${window.location.origin}${normalizeCallbackPath(authCallbackPath)}`;
  const { error } = await getSupabaseClient().auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      queryParams: {
        access_type: 'offline',
        prompt: 'consent',
      },
    },
  });

  if (error) {
    throw error;
  }
}

function normalizeCallbackPath(path: string) {
  if (!path.startsWith('/')) {
    return `/${path}`;
  }

  return path;
}

export async function getAuthSession(): Promise<Session | null> {
  const { data, error } = await getSupabaseClient().auth.getSession();

  if (error) {
    throw error;
  }

  return data.session;
}
