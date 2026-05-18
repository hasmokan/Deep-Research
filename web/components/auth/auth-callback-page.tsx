'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getAuthCallbackRedirectPath } from '@/lib/auth/callback-redirect';
import { getSupabaseClient } from '@/lib/auth/supabase';

export function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    const completeSignIn = async () => {
      const code = new URLSearchParams(window.location.search).get('code');

      if (code) {
        await getSupabaseClient().auth.exchangeCodeForSession(code);
      }

      router.replace(getAuthCallbackRedirectPath(window.location.origin));
    };

    void completeSignIn();
  }, [router]);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background text-sm text-muted-foreground">
      Signing you in...
    </main>
  );
}
