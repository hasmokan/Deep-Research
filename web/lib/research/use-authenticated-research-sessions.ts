'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { apiClient } from '@/lib/api';
import type { ResearchResult } from '@/lib/api/types';
import { getAuthSession, getSupabaseClient, isSupabaseAuthConfigured } from '@/lib/auth/supabase';
import type { ConversationMessage } from './conversation';
import {
  getResearchSessionsStorageKey,
  readResearchSessionSnapshot,
  researchSessionFromThread,
  restoreResearchSessionSnapshot,
  saveResearchSessionSnapshot,
  type ResearchSession,
} from './sessions';

interface UseAuthenticatedResearchSessionsOptions {
  onClearResearchState: () => void;
  resetStream: () => void;
  setDeepResearchMode: (enabled: boolean) => void;
  setError: (error: string | null) => void;
  setLoading: (loading: boolean) => void;
  setQuery: (query: string) => void;
  setResult: (result: ResearchResult | null) => void;
}

export function useAuthenticatedResearchSessions({
  onClearResearchState,
  resetStream,
  setDeepResearchMode,
  setError,
  setLoading,
  setQuery,
  setResult,
}: UseAuthenticatedResearchSessionsOptions) {
  const [sessions, setSessions] = useState<ResearchSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [hasLoadedSessions, setHasLoadedSessions] = useState(false);
  const [authSession, setAuthSession] = useState<Session | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const authSessionRef = useRef<Session | null>(null);
  const loadedSessionsUserIdRef = useRef<string | null>(null);
  const loadingSessionsUserIdRef = useRef<string | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const messagesRef = useRef<ConversationMessage[]>([]);
  const sessionsRef = useRef<ResearchSession[]>([]);

  const saveAuthenticatedSessionSnapshot = useCallback((
    nextSessions: ResearchSession[],
    nextActiveSessionId: string | null = activeSessionIdRef.current,
  ) => {
    const userId = authSessionRef.current?.user.id;

    if (!userId) {
      return;
    }

    try {
      saveResearchSessionSnapshot(window.localStorage, {
        activeSessionId: nextActiveSessionId,
        sessions: nextSessions,
      }, getResearchSessionsStorageKey(userId));
    } catch {
      // Local cache is only a fast restore path; backend persistence remains authoritative.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const applyRestoredSessions = (
      restoredSessions: ResearchSession[],
      nextActiveSessionId: string | null = restoredSessions[0]?.id ?? null,
    ) => {
      const activeSession = restoredSessions.find((session) => session.id === nextActiveSessionId)
        ?? restoredSessions[0]
        ?? null;
      const resolvedActiveSessionId = activeSession?.id ?? null;

      sessionsRef.current = restoredSessions;
      activeSessionIdRef.current = resolvedActiveSessionId;
      messagesRef.current = activeSession?.messages ?? [];
      setSessions(restoredSessions);
      setActiveSessionId(resolvedActiveSessionId);
      setMessages(activeSession?.messages ?? []);
      setQuery(activeSession?.title === 'New chat' ? '' : activeSession?.title ?? '');
      setResult(activeSession?.latestResult ?? null);
      setDeepResearchMode(!activeSession?.latestResult);
      setAuthError(null);
    };

    const clearResearchState = () => {
      loadedSessionsUserIdRef.current = null;
      loadingSessionsUserIdRef.current = null;
      activeSessionIdRef.current = null;
      messagesRef.current = [];
      sessionsRef.current = [];
      setSessions([]);
      setActiveSessionId(null);
      setMessages([]);
      onClearResearchState();
      resetStream();
      setDeepResearchMode(true);
      setLoading(false);
      setError(null);
    };

    const applyAuthSession = async (nextSession: Session | null) => {
      authSessionRef.current = nextSession;
      apiClient.setAccessTokenProvider(() => authSessionRef.current?.access_token ?? null);

      if (cancelled) {
        return;
      }

      setAuthSession(nextSession);

      if (!nextSession) {
        clearResearchState();
        setHasLoadedSessions(true);
        return;
      }

      const userId = nextSession.user.id;
      const storageKey = getResearchSessionsStorageKey(userId);

      if (loadedSessionsUserIdRef.current === userId) {
        setHasLoadedSessions(true);
        setAuthError(null);
        return;
      }

      if (loadingSessionsUserIdRef.current === userId) {
        setAuthError(null);
        return;
      }

      const localSnapshot = readResearchSessionSnapshot(window.localStorage, storageKey);
      if (localSnapshot) {
        const localState = restoreResearchSessionSnapshot(localSnapshot);
        applyRestoredSessions(localState.sessions, localState.activeSessionId);
        loadedSessionsUserIdRef.current = userId;
        setHasLoadedSessions(true);
        return;
      }

      loadingSessionsUserIdRef.current = userId;
      setHasLoadedSessions(false);

      try {
        const restoredSessions = (await apiClient.listResearchThreads()).map(researchSessionFromThread);
        const nextActiveSessionId = restoredSessions[0]?.id ?? null;

        if (cancelled) {
          return;
        }

        applyRestoredSessions(restoredSessions, nextActiveSessionId);
        saveAuthenticatedSessionSnapshot(restoredSessions, nextActiveSessionId);
        loadedSessionsUserIdRef.current = userId;
      } catch (sessionError) {
        clearResearchState();
        setAuthError(sessionError instanceof Error ? sessionError.message : 'Unable to load your research sessions');
      } finally {
        if (loadingSessionsUserIdRef.current === userId) {
          loadingSessionsUserIdRef.current = null;
        }
        if (!cancelled) {
          setHasLoadedSessions(true);
        }
      }
    };

    if (!isSupabaseAuthConfigured()) {
      setAuthError('Supabase Google login is not configured');
      setHasLoadedSessions(true);
      return;
    }

    void getAuthSession()
      .then(applyAuthSession)
      .catch((sessionError) => {
        setAuthError(sessionError instanceof Error ? sessionError.message : 'Unable to read your login session');
        setHasLoadedSessions(true);
      });

    const { data } = getSupabaseClient().auth.onAuthStateChange((_event, nextSession) => {
      void applyAuthSession(nextSession);
    });

    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, [
    onClearResearchState,
    resetStream,
    saveAuthenticatedSessionSnapshot,
    setDeepResearchMode,
    setError,
    setLoading,
    setQuery,
    setResult,
  ]);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  return {
    activeSessionId,
    activeSessionIdRef,
    authError,
    authSession,
    authSessionRef,
    hasLoadedSessions,
    messages,
    messagesRef,
    saveAuthenticatedSessionSnapshot,
    sessions,
    sessionsRef,
    setActiveSessionId,
    setAuthError,
    setMessages,
    setSessions,
  };
}
