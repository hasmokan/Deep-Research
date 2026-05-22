'use client';

import { LoginScreen } from '@/components/auth/login-screen';
import { ResearchWorkspaceView } from '@/components/research/research-workspace-view';
import { useResearchWorkspaceController } from '@/lib/research/use-research-workspace-controller';

export default function Home() {
  const {
    authError,
    handleSignIn,
    isAuthConfigured,
    isSigningIn,
    shouldShowLogin,
    workspaceProps,
  } = useResearchWorkspaceController();

  if (!isAuthConfigured) {
    return (
      <LoginScreen
        error={authError || 'Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in Vercel.'}
        isLoading={isSigningIn}
        onSignIn={handleSignIn}
      />
    );
  }

  if (shouldShowLogin) {
    return (
      <LoginScreen
        error={authError}
        isLoading={isSigningIn}
        onSignIn={handleSignIn}
      />
    );
  }

  return <ResearchWorkspaceView {...workspaceProps} />;
}
