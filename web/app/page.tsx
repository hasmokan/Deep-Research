'use client';

/**
 * Chatbot-first deep research interface.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { CheckCircle2, LogOut, MoreHorizontal, Share, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { LoginScreen } from '@/components/auth/login-screen';
import { ChatSidebar } from '@/components/layouts/chat-sidebar';
import { ErrorState, LoadingState, ReportSidebar, ResultsDisplay, SearchForm } from '@/components/research';
import { MarkdownContent } from '@/components/research/markdown-content';
import { ResearchPlanPanel } from '@/components/research/research-plan-panel';
import { apiClient } from '@/lib/api';
import type { ResearchResult, ResearchThread } from '@/lib/api/types';
import {
  getAuthSession,
  getSupabaseClient,
  isSupabaseAuthConfigured,
  signInWithGoogle,
} from '@/lib/auth/supabase';
import {
  appendResearchActivityStatus,
  appendResearchActivityDocuments,
  appendResearchActivityTrace,
  appendResearchActivityThinking,
  applyResearchRunToActivityMessage,
  buildResearchRequestMessages,
  completeResearchActivityMessage,
  createAssistantResearchActivityMessage,
  createUserMessage,
  setResearchActivityRunId,
  type ConversationMessage,
  updateResearchActivityMessageStatus,
} from '@/lib/research/conversation';
import {
  createResearchPlan,
  getResearchQueryOverride,
  normalizeResearchPlan,
  shouldRenderResearchPlanShell,
  type ResearchPlan,
} from '@/lib/research/research-workflow';
import {
  createResearchSession,
  getResearchSessionsStorageKey,
  readResearchSessionSnapshot,
  restoreResearchSessionSnapshot,
  saveResearchSessionSnapshot,
  updateResearchSessionMessages,
  upsertResearchSession,
  type ResearchSession,
} from '@/lib/research/sessions';
import { useResearchStore } from '@/lib/store/research';

function UserBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[680px] rounded-[26px] bg-foreground px-5 py-4 text-base leading-7 text-background">
        {content}
      </div>
    </div>
  );
}

function isReportResult(result: ResearchResult | null | undefined): result is ResearchResult {
  return Boolean(result && result.result_type !== 'answer');
}

function getLatestArtifactResult(messages: ConversationMessage[]) {
  return [...messages]
    .reverse()
    .find((message) => isReportResult(message.result))
    ?.result ?? null;
}

function sessionFromThread(thread: ResearchThread): ResearchSession {
  const messages = Array.isArray(thread.messages)
    ? thread.messages as ConversationMessage[]
    : [];

  return {
    id: thread.thread_id,
    title: thread.title || 'New chat',
    messages,
    latestResult: getLatestArtifactResult(messages),
    createdAt: thread.created_at,
    updatedAt: thread.updated_at,
  };
}

function threadUpdateFromSession(session: ResearchSession) {
  return {
    title: session.title,
    messages: session.messages,
  };
}

function AssistantResultMessage({ message }: { message: ConversationMessage }) {
  if (!message.result && !message.researchActivity && !message.researchPlan) {
    return null;
  }

  if (message.researchPlan) {
    return (
      <div className="mx-auto max-w-[820px]">
        <ResearchPlanPanel
          plan={message.researchPlan}
          activity={message.researchActivity}
        />
      </div>
    );
  }

  if (message.result?.result_type === 'answer') {
    return (
      <div className="mx-auto w-full max-w-[760px]">
        <div className="flex gap-4">
          <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
            <CheckCircle2 className="h-4 w-4" />
          </div>
          <article className="min-w-0 flex-1">
            <MarkdownContent
              content={message.result.answer || message.result.report || message.content}
              className="text-base leading-7"
            />
          </article>
        </div>
      </div>
    );
  }

  return (
    <>
      {message.researchActivity && (
        <div className="mx-auto w-full max-w-[900px]">
          <LoadingState activity={message.researchActivity} />
        </div>
      )}

      {message.result && (
        <>
          <div className="mx-auto w-full max-w-4xl xl:hidden">
            <ResultsDisplay result={message.result} />
          </div>

          <div className="mx-auto hidden w-full max-w-[720px] xl:block">
            <div className="rounded-[18px] border border-border bg-card p-5 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
                  <CheckCircle2 className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">Research report generated</p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    I opened the full report in the artifact panel on the right. Continue asking follow-up questions here.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}

export default function Home() {
  const [localQuery, setLocalQuery] = useState('');
  const [researchPlan, setResearchPlan] = useState<ResearchPlan | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [sessions, setSessions] = useState<ResearchSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [hasLoadedSessions, setHasLoadedSessions] = useState(false);
  const [authSession, setAuthSession] = useState<Session | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isSigningIn, setSigningIn] = useState(false);
  const [isPlanning, setPlanning] = useState(false);
  const [isDeepResearchMode, setDeepResearchMode] = useState(true);
  const abortControllerRef = useRef<AbortController | null>(null);
  const recoveryAbortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const conversationEndRef = useRef<HTMLDivElement | null>(null);
  const authSessionRef = useRef<Session | null>(null);
  const loadedSessionsUserIdRef = useRef<string | null>(null);
  const loadingSessionsUserIdRef = useRef<string | null>(null);
  const activeResearchRef = useRef<{ sessionId: string; messageId: string } | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const messagesRef = useRef<ConversationMessage[]>([]);
  const sessionsRef = useRef<ResearchSession[]>([]);
  const {
    query,
    isLoading,
    error,
    result,
    setQuery,
    setLoading,
    setError,
    setResult,
    resetStream,
    addStreamStatus,
    addStreamThinking,
    setStreamDocuments,
    addStreamTrace,
  } = useResearchStore();

  const currentQuery = localQuery.trim();
  const activePlan = researchPlan;
  const latestArtifactResult = getLatestArtifactResult(messages);
  const latestContextResult = (isReportResult(result) ? result : null) || latestArtifactResult;
  const sidebarResult = latestContextResult;
  const hasConversation = Boolean(messages.length || activePlan || isPlanning || isLoading || error);
  const canSendFollowUp = Boolean(latestContextResult);
  const activePlanActivityMessage = activePlan
    ? [...messages].reverse().find((message) => (
        message.researchActivity?.query === activePlan.query
      ))
    : undefined;
  const visibleMessages = activePlanActivityMessage
    ? messages.filter((message) => message.id !== activePlanActivityMessage.id)
    : messages;
  const hasInlineRunningActivity = messages.some((message) => (
    message.researchActivity?.status === 'running' && !message.result
  ));
  const shouldShowPlanShell = shouldRenderResearchPlanShell({
    isPlanning,
    hasPlan: Boolean(activePlan),
  });

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
      // Local cache is a fast restore path only; backend persistence remains authoritative.
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
      abortControllerRef.current?.abort();
      recoveryAbortControllersRef.current.forEach((controller) => controller.abort());
      recoveryAbortControllersRef.current.clear();
      loadedSessionsUserIdRef.current = null;
      loadingSessionsUserIdRef.current = null;
      activeResearchRef.current = null;
      activeSessionIdRef.current = null;
      messagesRef.current = [];
      sessionsRef.current = [];
      setSessions([]);
      setActiveSessionId(null);
      setMessages([]);
      setResearchPlan(null);
      setLocalQuery('');
      setQuery('');
      setResult(null);
      setDeepResearchMode(true);
      setPlanning(false);
      setLoading(false);
      setError(null);
      resetStream();
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
        const restoredSessions = (await apiClient.listResearchThreads()).map(sessionFromThread);
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
  }, [resetStream, saveAuthenticatedSessionSnapshot, setError, setLoading, setQuery, setResult]);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    if (hasConversation) {
      conversationEndRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'end',
      });
    }
  }, [hasConversation, messages, researchPlan, isPlanning, isLoading, error, result]);

  const persistMessagesToSession = useCallback((sessionId: string, nextMessages: ConversationMessage[]) => {
    const existingSession = sessionsRef.current.find((session) => session.id === sessionId);
    const session = existingSession ?? createResearchSession({ id: sessionId });
    const updatedSession = updateResearchSessionMessages(session, nextMessages);
    const nextSessions = upsertResearchSession(
      {
        activeSessionId: activeSessionIdRef.current,
        sessions: sessionsRef.current,
      },
      updatedSession,
    ).sessions;

    sessionsRef.current = nextSessions;
    setSessions(nextSessions);
    saveAuthenticatedSessionSnapshot(nextSessions, activeSessionIdRef.current);
    void apiClient.saveResearchThread(updatedSession.id, threadUpdateFromSession(updatedSession))
      .catch((saveError) => {
        setError(saveError instanceof Error ? saveError.message : 'Unable to save this research session');
      });
  }, [saveAuthenticatedSessionSnapshot, setError]);

  const saveActiveSessionMessages = (nextMessages: ConversationMessage[]) => {
    if (!activeSessionIdRef.current && nextMessages.length === 0) {
      return null;
    }

    const existingSession = sessionsRef.current.find((session) => session.id === activeSessionIdRef.current);
    const session = existingSession ?? createResearchSession();
    const updatedSession = updateResearchSessionMessages(session, nextMessages);
    const nextSessions = upsertResearchSession(
      {
        activeSessionId: updatedSession.id,
        sessions: sessionsRef.current,
      },
      updatedSession,
    ).sessions;

    activeSessionIdRef.current = updatedSession.id;
    sessionsRef.current = nextSessions;
    setActiveSessionId(updatedSession.id);
    setSessions(nextSessions);
    saveAuthenticatedSessionSnapshot(nextSessions, updatedSession.id);
    void apiClient.saveResearchThread(updatedSession.id, threadUpdateFromSession(updatedSession))
      .catch((saveError) => {
        setError(saveError instanceof Error ? saveError.message : 'Unable to save this research session');
      });

    return updatedSession.id;
  };

  const commitVisibleMessages = (nextMessages: ConversationMessage[], sessionId: string | null = activeSessionIdRef.current) => {
    messagesRef.current = nextMessages;
    setMessages(nextMessages);

    if (sessionId) {
      persistMessagesToSession(sessionId, nextMessages);
    } else {
      saveActiveSessionMessages(nextMessages);
    }
  };

  const updateResearchActivityMessage = useCallback((
    sessionId: string,
    messageId: string,
    updateMessage: (message: ConversationMessage) => ConversationMessage,
  ) => {
    const sourceMessages = activeSessionIdRef.current === sessionId
      ? messagesRef.current
      : sessionsRef.current.find((session) => session.id === sessionId)?.messages ?? [];
    const nextMessages = sourceMessages.map((message) => (
      message.id === messageId ? updateMessage(message) : message
    ));

    if (activeSessionIdRef.current === sessionId) {
      messagesRef.current = nextMessages;
      setMessages(nextMessages);
    }

    persistMessagesToSession(sessionId, nextMessages);
  }, [persistMessagesToSession]);

  useEffect(() => {
    if (!hasLoadedSessions) {
      return;
    }

    const pendingActivities = sessionsRef.current.flatMap((session) => (
      session.messages
        .filter((message) => (
          message.researchActivity?.status === 'running' && message.researchActivity.runId
        ))
        .map((message) => ({
          sessionId: session.id,
          messageId: message.id,
          runId: message.researchActivity?.runId ?? '',
        }))
    ));

    if (!pendingActivities.length) {
      return;
    }

    void Promise.all(pendingActivities.map(async (activity) => {
      if (recoveryAbortControllersRef.current.has(activity.runId)) {
        return;
      }

      const abortController = new AbortController();
      recoveryAbortControllersRef.current.set(activity.runId, abortController);
      const isActiveActivity = activeSessionIdRef.current === activity.sessionId;

      try {
        const run = await apiClient.getResearchRun(activity.runId);
        updateResearchActivityMessage(
          activity.sessionId,
          activity.messageId,
          (message) => applyResearchRunToActivityMessage(message, run),
        );

        if (run.status !== 'running') {
          return;
        }

        if (isActiveActivity) {
          setLoading(true);
        }

        const afterSeq = run.events.at(-1)?.seq ?? 0;
        const researchResult = await apiClient.streamResearchRun(
          activity.runId,
          {
            afterSeq,
            onStatus: (status) => {
              addStreamStatus(status);
              updateResearchActivityMessage(
                activity.sessionId,
                activity.messageId,
                (message) => appendResearchActivityStatus(message, status),
              );
            },
            onTrace: (trace) => {
              addStreamTrace(trace);
              updateResearchActivityMessage(
                activity.sessionId,
                activity.messageId,
                (message) => appendResearchActivityTrace(message, trace),
              );
            },
            onDocuments: (documents) => {
              setStreamDocuments(documents);
              updateResearchActivityMessage(
                activity.sessionId,
                activity.messageId,
                (message) => appendResearchActivityDocuments(message, documents),
              );
            },
            onThinking: (thinking) => {
              addStreamThinking(thinking);
              updateResearchActivityMessage(
                activity.sessionId,
                activity.messageId,
                (message) => appendResearchActivityThinking(message, thinking),
              );
            },
            signal: abortController.signal,
          },
        );

        updateResearchActivityMessage(
          activity.sessionId,
          activity.messageId,
          (message) => completeResearchActivityMessage(message, researchResult),
        );
        if (isActiveActivity) {
          setResult(researchResult);
          setDeepResearchMode(false);
        }
      } catch {
        if (abortController.signal.aborted) {
          return;
        }
        updateResearchActivityMessage(
          activity.sessionId,
          activity.messageId,
          (message) => updateResearchActivityMessageStatus(message, 'stopped'),
        );
      } finally {
        recoveryAbortControllersRef.current.delete(activity.runId);
        if (isActiveActivity) {
          setLoading(false);
        }
      }
    }));
  }, [
    addStreamStatus,
    addStreamThinking,
    addStreamTrace,
    hasLoadedSessions,
    setLoading,
    setResult,
    setStreamDocuments,
    updateResearchActivityMessage,
  ]);

  const activateSession = (session: ResearchSession) => {
    abortControllerRef.current?.abort();
    activeSessionIdRef.current = session.id;
    messagesRef.current = session.messages;
    setActiveSessionId(session.id);
    setMessages(session.messages);
    setResearchPlan(null);
    setLocalQuery('');
    setQuery(session.title === 'New chat' ? '' : session.title);
    setError(null);
    setResult(session.latestResult);
    setDeepResearchMode(!session.latestResult);
    resetStream();
    setLoading(false);
    setPlanning(false);
  };

  const handleNewChat = () => {
    const session = createResearchSession();
    const nextSessions = upsertResearchSession(
      {
        activeSessionId: session.id,
        sessions: sessionsRef.current,
      },
      session,
    ).sessions;

    sessionsRef.current = nextSessions;
    setSessions(nextSessions);
    saveAuthenticatedSessionSnapshot(nextSessions, session.id);
    void apiClient.saveResearchThread(session.id, threadUpdateFromSession(session))
      .catch((saveError) => {
        setError(saveError instanceof Error ? saveError.message : 'Unable to save this research session');
      });
    activateSession(session);
  };

  const handleSelectSession = (sessionId: string) => {
    const session = sessionsRef.current.find((storedSession) => storedSession.id === sessionId);

    if (!session) {
      return;
    }

    activateSession(session);
  };

  const removeLastUserMessageForQuery = (messageQuery: string) => {
    const lastMessage = messagesRef.current.at(-1);

    if (lastMessage?.role !== 'user' || lastMessage.content !== messageQuery) {
      return;
    }

    const nextMessages = messagesRef.current.slice(0, -1);
    commitVisibleMessages(nextMessages);
  };

  const handleQueryChange = (nextQuery: string) => {
    setLocalQuery(nextQuery);

    if (researchPlan && nextQuery.trim() && nextQuery.trim() !== researchPlan.query) {
      removeLastUserMessageForQuery(researchPlan.query);
      setResearchPlan(null);
      setPlanning(false);
    }
  };

  const handleCreatePlan = async () => {
    if (!currentQuery) {
      setError('Please enter a research query');
      return;
    }

    const requestedQuery = currentQuery;
    const history = buildResearchRequestMessages(messagesRef.current);
    const latestResultForFollowUp = getLatestArtifactResult(messagesRef.current) ?? (isReportResult(result) ? result : null);
    const userMessage = createUserMessage(requestedQuery);
    const nextMessages = [...messagesRef.current, userMessage];

    commitVisibleMessages(nextMessages);
    setQuery(requestedQuery);
    setLocalQuery('');
    setError(null);
    setResult(null);
    resetStream();
    setResearchPlan(null);
    setPlanning(true);

    let shouldRevealPlan = false;

    try {
      const generatedPlan = await apiClient.streamResearchPlan(
        {
          query: requestedQuery,
          thread_id: activeSessionIdRef.current ?? undefined,
          messages: history,
          latest_result: latestResultForFollowUp,
        },
      );
      const normalizedPlan = normalizeResearchPlan(generatedPlan);

      if (!normalizedPlan.shouldPlan) {
        setResearchPlan(null);
        setPlanning(false);
        await handleStartResearch(requestedQuery, {
          skipPlan: true,
          appendUserMessage: false,
        });
        return;
      }

      shouldRevealPlan = true;
      setResearchPlan(normalizedPlan);
    } catch {
      shouldRevealPlan = true;
      setResearchPlan(createResearchPlan(requestedQuery));
    } finally {
      if (!shouldRevealPlan) {
        setPlanning(false);
      }
    }
  };

  const handleStartResearch = async (
    queryOverride?: unknown,
    options: { skipPlan?: boolean; appendUserMessage?: boolean } = {},
  ) => {
    const normalizedQueryOverride = getResearchQueryOverride(queryOverride);
    const researchQuery = normalizedQueryOverride || activePlan?.query || query || currentQuery;

    if (!researchQuery) {
      setError('Please enter a research query');
      return;
    }

    if (!activePlan && !options.skipPlan) {
      void handleCreatePlan();
      return;
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    const history = buildResearchRequestMessages(messagesRef.current);
    const latestResultForFollowUp = getLatestArtifactResult(messagesRef.current) ?? (isReportResult(result) ? result : null);
    const shouldAppendUserMessage = options.appendUserMessage ?? Boolean(normalizedQueryOverride);
    const userMessage = shouldAppendUserMessage && normalizedQueryOverride
      ? createUserMessage(normalizedQueryOverride)
      : null;
    const activityMessage = createAssistantResearchActivityMessage(researchQuery, {
      plan: options.skipPlan ? undefined : activePlan ?? undefined,
    });
    const startingMessages = userMessage
      ? [...messagesRef.current, userMessage, activityMessage]
      : [...messagesRef.current, activityMessage];
    const runSessionId = saveActiveSessionMessages(startingMessages);

    messagesRef.current = startingMessages;
    setMessages(startingMessages);

    if (!runSessionId) {
      setError('Unable to save this research session');
      return;
    }

    activeResearchRef.current = {
      sessionId: runSessionId,
      messageId: activityMessage.id,
    };

    try {
      setQuery(researchQuery);
      if (normalizedQueryOverride) {
        setLocalQuery('');
      }
      if (options.skipPlan) {
        setResearchPlan(null);
      }
      setLoading(true);
      setError(null);
      setResult(null);
      resetStream();

      const researchResult = await apiClient.streamResearch(
        {
            query: researchQuery,
            thread_id: runSessionId,
            messages: history,
            latest_result: latestResultForFollowUp,
        },
        {
          onMetadata: (metadata) => {
            updateResearchActivityMessage(
              runSessionId,
              activityMessage.id,
              (message) => setResearchActivityRunId(message, metadata.run_id),
            );
          },
          onStatus: (status) => {
            addStreamStatus(status);
            updateResearchActivityMessage(
              runSessionId,
              activityMessage.id,
              (message) => appendResearchActivityStatus(message, status),
            );
          },
          onTrace: (trace) => {
            addStreamTrace(trace);
            updateResearchActivityMessage(
              runSessionId,
              activityMessage.id,
              (message) => appendResearchActivityTrace(message, trace),
            );
          },
          onDocuments: (documents) => {
            setStreamDocuments(documents);
            updateResearchActivityMessage(
              runSessionId,
              activityMessage.id,
              (message) => appendResearchActivityDocuments(message, documents),
            );
          },
          onThinking: (thinking) => {
            addStreamThinking(thinking);
            updateResearchActivityMessage(
              runSessionId,
              activityMessage.id,
              (message) => appendResearchActivityThinking(message, thinking),
            );
          },
          signal: abortController.signal,
        },
      ).catch((streamError) => {
        if (abortController.signal.aborted) {
          throw streamError;
        }
        return apiClient.executeResearch({
          query: researchQuery,
          thread_id: runSessionId,
          messages: history,
          latest_result: latestResultForFollowUp,
        });
      });

      updateResearchActivityMessage(
        runSessionId,
        activityMessage.id,
        (message) => completeResearchActivityMessage(message, researchResult),
      );
      setResult(researchResult);
      setDeepResearchMode(false);
    } catch (researchError) {
      updateResearchActivityMessage(
        runSessionId,
        activityMessage.id,
        (message) => updateResearchActivityMessageStatus(
          message,
          abortController.signal.aborted ? 'stopped' : 'failed',
        ),
      );

      if (!abortController.signal.aborted) {
        setError(researchError instanceof Error ? researchError.message : 'An error occurred');
      }
    } finally {
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null;
      }
      if (activeResearchRef.current?.messageId === activityMessage.id) {
        activeResearchRef.current = null;
      }
      setLoading(false);
    }
  };

  const handleStop = () => {
    abortControllerRef.current?.abort();
    const activeResearch = activeResearchRef.current;

    if (activeResearch) {
      updateResearchActivityMessage(
        activeResearch.sessionId,
        activeResearch.messageId,
        (message) => updateResearchActivityMessageStatus(message, 'stopped'),
      );
    }
  };

  const handleCancelPlan = () => {
    abortControllerRef.current?.abort();
    if (researchPlan) {
      removeLastUserMessageForQuery(researchPlan.query);
    }
    setResearchPlan(null);
    setLocalQuery('');
    setQuery('');
    setError(null);
    setResult(null);
    resetStream();
    setPlanning(false);
  };

  const handleEditPlan = () => {
    const planQuery = researchPlan?.query;

    if (researchPlan) {
      setLocalQuery(researchPlan.query);
    }
    if (planQuery) {
      removeLastUserMessageForQuery(planQuery);
    }
    setResearchPlan(null);
    setPlanning(false);
  };

  const handlePlanRevealComplete = useCallback(() => {
    setPlanning(false);
  }, []);

  const handleToggleDeepResearchMode = () => {
    setDeepResearchMode((enabled) => !enabled);
  };

  const handleSignIn = async () => {
    setSigningIn(true);
    setAuthError(null);

    try {
      await signInWithGoogle();
    } catch (signInError) {
      setAuthError(signInError instanceof Error ? signInError.message : 'Google sign-in failed');
      setSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    abortControllerRef.current?.abort();
    await getSupabaseClient().auth.signOut();
  };

  if (!isSupabaseAuthConfigured()) {
    return (
      <LoginScreen
        error={authError || 'Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in Vercel.'}
        isLoading={isSigningIn}
        onSignIn={handleSignIn}
      />
    );
  }

  if (!hasLoadedSessions) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-background text-sm text-muted-foreground">
        Loading your workspace...
      </main>
    );
  }

  if (!authSession) {
    return (
      <LoginScreen
        error={authError}
        isLoading={isSigningIn}
        onSignIn={handleSignIn}
      />
    );
  }

  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      <ChatSidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        onNewChat={handleNewChat}
        onSelectSession={handleSelectSession}
      />

      <main className="relative flex h-dvh min-w-0 flex-1 flex-col overflow-hidden">
        <header className="z-40 flex h-16 shrink-0 items-center justify-between bg-background/85 px-4 backdrop-blur-xl lg:px-6">
          <div className="flex items-center gap-2 lg:hidden">
            <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-foreground text-background">
              <Sparkles className="h-5 w-5" />
            </div>
            <span className="text-lg font-semibold">deepresearch</span>
          </div>
          <div className="hidden lg:block" />
          <div className="flex items-center gap-1">
            <span className="hidden max-w-[220px] truncate px-2 text-sm text-muted-foreground md:inline">
              {authSession.user.email}
            </span>
            <Button variant="ghost" className="h-9 rounded-full px-3">
              <Share className="h-4 w-4" />
              Share
            </Button>
            <ThemeToggle />
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-full"
              aria-label="Sign out"
              onClick={() => {
                void handleSignOut();
              }}
            >
              <LogOut className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full" aria-label="More actions">
              <MoreHorizontal className="h-5 w-5" />
            </Button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col px-4 pb-40 pt-8 md:px-8">
            {!hasConversation && (
              <div className="flex flex-1 items-center justify-center">
                <div className="max-w-2xl text-center">
                  <div className="mx-auto mb-6 flex h-12 w-12 items-center justify-center rounded-2xl bg-foreground text-background">
                    <Sparkles className="h-6 w-6" />
                  </div>
                  <h1 className="text-4xl font-semibold md:text-5xl">
                    What should we research?
                  </h1>
                  <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-muted-foreground">
                    Ask for a detailed report, review the plan, then start a live deep research run.
                  </p>
                </div>
              </div>
            )}

            {hasConversation && (
              <div className="space-y-8">
                {visibleMessages.map((message) => (
                  message.role === 'user' ? (
                    <UserBubble key={message.id} content={message.content} />
                  ) : (
                    <AssistantResultMessage key={message.id} message={message} />
                  )
                ))}

                {shouldShowPlanShell && (
                  <div className="mx-auto max-w-[820px]">
                    <ResearchPlanPanel
                      key={activePlan
                        ? `${activePlan.query}-${activePlan.steps.map((step) => step.id).join('-')}`
                        : `planning-shell-${query || currentQuery}`}
                      plan={activePlan}
                      activity={!isPlanning ? activePlanActivityMessage?.researchActivity : undefined}
                      isLoading={isLoading || isPlanning}
                      isStreaming={isPlanning && Boolean(activePlan)}
                      revealSteps={isPlanning && Boolean(activePlan)}
                      onRevealComplete={activePlan ? handlePlanRevealComplete : undefined}
                      onEdit={!isPlanning ? handleEditPlan : undefined}
                      onCancel={!isPlanning ? handleCancelPlan : undefined}
                      onStart={!isPlanning
                        ? () => {
                            void handleStartResearch();
                          }
                        : undefined}
                    />
                  </div>
                )}

                {isLoading && !hasInlineRunningActivity && (
                  <div className="mx-auto max-w-[900px]">
                    <LoadingState />
                  </div>
                )}

                {error && !isLoading && (
                  <div className="mx-auto max-w-[720px]">
                    <ErrorState error={error} />
                  </div>
                )}

                <div ref={conversationEndRef} className="h-1" />
              </div>
            )}
          </div>
        </div>

        <div className="pointer-events-none absolute bottom-0 left-0 right-0 z-40 px-4 pb-4 pt-10">
          <SearchForm
            query={localQuery}
            isLoading={isLoading}
            isPlanning={isPlanning}
            hasPlan={Boolean(activePlan)}
            canSendFollowUp={canSendFollowUp}
            isDeepResearchMode={isDeepResearchMode}
            onQueryChange={handleQueryChange}
            onCreatePlan={handleCreatePlan}
            onStartResearch={handleStartResearch}
            onToggleDeepResearchMode={handleToggleDeepResearchMode}
            onStop={handleStop}
          />
          <p className="mx-auto mt-2 max-w-3xl text-center text-xs text-muted-foreground">
            deepresearch can make mistakes. Check important info.
          </p>
        </div>
      </main>

      {sidebarResult && <ReportSidebar result={sidebarResult} />}
    </div>
  );
}
