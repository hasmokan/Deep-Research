'use client';

import { Chrome, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface LoginScreenProps {
  error?: string | null;
  isLoading?: boolean;
  onSignIn: () => void;
}

export function LoginScreen({ error, isLoading = false, onSignIn }: LoginScreenProps) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 text-foreground">
      <section className="w-full max-w-[360px]">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-foreground text-background">
            <Sparkles className="h-5 w-5" />
          </div>
          <span className="text-xl font-semibold">deepresearch</span>
        </div>

        <h1 className="text-3xl font-semibold">Sign in</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Use your Google account to keep research chats and memo private to your account.
        </p>

        <Button
          className="mt-8 h-11 w-full rounded-[10px]"
          disabled={isLoading}
          onClick={onSignIn}
        >
          <Chrome className="h-4 w-4" />
          Continue with Google
        </Button>

        {error && (
          <p className="mt-4 rounded-[8px] border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
      </section>
    </main>
  );
}
