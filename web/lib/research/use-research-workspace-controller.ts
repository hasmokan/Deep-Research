'use client';

import { useCallback, useRef, useState } from 'react';
import type { ResearchWorkspaceViewProps } from '@/components/research/research-workspace-view';
import { apiClient } from '@/lib/api';
import { getSupabaseClient, isSupabaseAuthConfigured, signInWithGoogle } from '@/lib/auth/supabase';
import {
  appendResearchActivityEstimatedTokenUsage,
  buildResearchRequestMessages,
  completeResearchActivityMessage,
  createAssistantResearchActivityMessage,
  createUserMessage,
  setResearchActivityRunMetadata,
  updateResearchActivityMessageStatus,
} from '@/lib/research/conversation';
import {
  getRequestIdFromError,
  hasErrorDiagnostic,
  type ErrorDiagnostic,
} from '@/lib/research/error-diagnostics';
import { useClientErrorReporting } from '@/lib/research/use-client-error-reporting';
import { useConversationAutoscroll } from '@/lib/research/use-conversation-autoscroll';
import { useResearchRunRecovery } from '@/lib/research/use-research-run-recovery';
import { useResearchSessionMessages } from '@/lib/research/use-research-session-messages';
import {
  getLatestArtifactResult,
  isReportResult,
} from '@/lib/research/result-selectors';
import { createResearchStreamHandlers } from '@/lib/research/research-stream-handlers';
import {
  getResearchQueryOverride,
  normalizeResearchPlan,
  shouldRenderResearchPlanShell,
  type ResearchPlan,
} from '@/lib/research/research-workflow';
import {
  createResearchSession,
  researchThreadUpdateFromSession,
  upsertResearchSession,
  type ResearchSession,
} from '@/lib/research/sessions';
import type { TokenUsageDirection } from '@/lib/research/token-usage';
import { useAuthenticatedResearchSessions } from '@/lib/research/use-authenticated-research-sessions';
import { useResearchStore } from '@/lib/store/research';

export function useResearchWorkspaceController() {
  const [localQuery, setLocalQuery] = useState('');
  const [researchPlan, setResearchPlan] = useState<ResearchPlan | null>(null);
  const [isSigningIn, setSigningIn] = useState(false);
  const [isPlanning, setPlanning] = useState(false);
  const [isDeepResearchMode, setDeepResearchMode] = useState(true);
  const [isMobileChatOpen, setMobileChatOpen] = useState(false);
  const [isMobileReportOpen, setMobileReportOpen] = useState(false);
  const [dismissedSidebarQuery, setDismissedSidebarQuery] = useState<string | null>(null);
  const [errorDiagnostic, setErrorDiagnostic] = useState<ErrorDiagnostic | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const recoveryAbortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const conversationEndRef = useRef<HTMLDivElement | null>(null);
  const conversationScrollRef = useRef<HTMLDivElement | null>(null);
  const activeResearchRef = useRef<{
    sessionId: string;
    messageId: string;
    runId?: string | null;
    traceId?: string | null;
  } | null>(null);
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
    setStreamTokenUsage,
    addEstimatedStreamTokenUsage,
    addStreamTrace,
    addStreamAgentMessage,
  } = useResearchStore();

  const clearResearchUiState = useCallback(() => {
    abortControllerRef.current?.abort();
    recoveryAbortControllersRef.current.forEach((controller) => controller.abort());
    recoveryAbortControllersRef.current.clear();
    activeResearchRef.current = null;
    setErrorDiagnostic(null);
    setResearchPlan(null);
    setLocalQuery('');
    setQuery('');
    setResult(null);
    setPlanning(false);
  }, [setQuery, setResult]);

  const {
    activeSessionId,
    activeSessionIdRef,
    authError,
    authSession,
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
  } = useAuthenticatedResearchSessions({
    onClearResearchState: clearResearchUiState,
    resetStream,
    setDeepResearchMode,
    setError,
    setLoading,
    setQuery,
    setResult,
  });

  const currentQuery = localQuery.trim();
  const activePlan = researchPlan;
  const latestArtifactResult = getLatestArtifactResult(messages);
  const latestContextResult = (isReportResult(result) ? result : null) || latestArtifactResult;
  const sidebarResult = latestContextResult?.query === dismissedSidebarQuery ? null : latestContextResult;
  const hasConversation = Boolean(messages.length || activePlan || isPlanning || isLoading || error);
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
  const isWorkspacePending = !hasLoadedSessions;
  const canUseWorkspace = hasLoadedSessions && Boolean(authSession);
  const shouldShowPlanPanel = shouldRenderResearchPlanShell({
    isPlanning: false,
    hasPlan: Boolean(activePlan),
  });
  const streamingActivitySignature = messages
    .map((message) => {
      const activity = message.researchActivity;
      if (!activity) {
        return '';
      }

      return [
        activity.status,
        activity.streamStatuses?.length ?? 0,
        (activity.streamThinking ?? []).map((thinking) => `${thinking.id ?? ''}:${thinking.text.length}`).join(','),
        activity.streamDocuments?.length ?? 0,
        activity.streamTrace?.length ?? 0,
        activity.streamAgentMessages?.length ?? 0,
        activity.tokenUsage?.total_tokens ?? 0,
      ].join(':');
    })
    .join('|');
  const conversationScrollSignature = [
    messages.length,
    streamingActivitySignature,
    researchPlan?.query ?? '',
    isPlanning,
    isLoading,
    error ?? '',
    result?.query ?? '',
    result?.status ?? '',
  ].join('|');

  useConversationAutoscroll({
    conversationEndRef,
    conversationScrollRef,
    isEnabled: hasConversation,
    scrollSignature: conversationScrollSignature,
  });
  useClientErrorReporting({ activeSessionIdRef });

  const {
    commitVisibleMessages,
    saveActiveSessionMessages,
    updateResearchActivityMessage,
  } = useResearchSessionMessages({
    activeSessionIdRef,
    messagesRef,
    saveAuthenticatedSessionSnapshot,
    sessionsRef,
    setActiveSessionId,
    setError,
    setErrorDiagnostic,
    setMessages,
    setSessions,
  });

  const addEstimatedTokenUsage = useCallback((
    sessionId: string,
    messageId: string,
    text: string,
    direction: TokenUsageDirection,
  ) => {
    if (!text.trim()) {
      return;
    }

    addEstimatedStreamTokenUsage(text, direction);
    updateResearchActivityMessage(
      sessionId,
      messageId,
      (message) => appendResearchActivityEstimatedTokenUsage(message, text, direction),
    );
  }, [addEstimatedStreamTokenUsage, updateResearchActivityMessage]);

  const clearWorkspaceError = useCallback(() => {
    setError(null);
    setErrorDiagnostic(null);
  }, [setError]);

  const setWorkspaceError = useCallback((
    message: string,
    diagnostic: ErrorDiagnostic = {},
  ) => {
    setError(message);
    setErrorDiagnostic(hasErrorDiagnostic(diagnostic) ? diagnostic : null);
  }, [setError]);

  useResearchRunRecovery({
    activeSessionIdRef,
    addEstimatedTokenUsage,
    addStreamAgentMessage,
    addStreamStatus,
    addStreamThinking,
    addStreamTrace,
    hasLoadedSessions,
    recoveryAbortControllersRef,
    sessionsRef,
    setDeepResearchMode,
    setDismissedSidebarQuery,
    setLoading,
    setResult,
    setStreamDocuments,
    setStreamTokenUsage,
    updateResearchActivityMessage,
  });

  const activateSession = (session: ResearchSession) => {
    abortControllerRef.current?.abort();
    activeSessionIdRef.current = session.id;
    messagesRef.current = session.messages;
    setActiveSessionId(session.id);
    setMessages(session.messages);
    setResearchPlan(null);
    setLocalQuery('');
    setQuery(session.title === 'New chat' ? '' : session.title);
    setResult(session.latestResult);
    setDeepResearchMode(!session.latestResult);
    resetStream();
    setLoading(false);
    setPlanning(false);
    clearWorkspaceError();
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
    void apiClient.saveResearchThread(session.id, researchThreadUpdateFromSession(session))
      .catch((saveError) => {
        const requestId = getRequestIdFromError(saveError);
        setErrorDiagnostic(requestId ? { requestId } : null);
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

  const handleStarterPrompt = (prompt: string) => {
    if (!canUseWorkspace) {
      return;
    }

    handleQueryChange(prompt);
  };

  const handleCloseReportSidebar = () => {
    if (sidebarResult) {
      setDismissedSidebarQuery(sidebarResult.query);
    }
    setMobileReportOpen(false);
  };

  const handleExpandReport = () => {
    if (!sidebarResult?.report) {
      return;
    }

    const blob = new Blob([sidebarResult.report], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener,noreferrer');
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const handleCreatePlan = async (
    queryOverride?: string,
    options: { appendUserMessage?: boolean } = {},
  ) => {
    const requestedQuery = (queryOverride ?? currentQuery).trim();

    if (!requestedQuery) {
      setWorkspaceError('Please enter a research query');
      return;
    }

    const history = buildResearchRequestMessages(messagesRef.current);
    const latestResultForFollowUp = getLatestArtifactResult(messagesRef.current) ?? (isReportResult(result) ? result : null);
    const shouldAppendUserMessage = options.appendUserMessage ?? true;
    const userMessage = shouldAppendUserMessage ? createUserMessage(requestedQuery) : null;
    const nextMessages = userMessage ? [...messagesRef.current, userMessage] : [...messagesRef.current];

    commitVisibleMessages(nextMessages);
    setQuery(requestedQuery);
    setLocalQuery('');
    clearWorkspaceError();
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
    } catch (planError) {
      setResearchPlan(null);
      setLocalQuery(requestedQuery);
      setWorkspaceError(
        planError instanceof Error ? planError.message : 'Research plan generation failed. Please try again.',
        { requestId: getRequestIdFromError(planError) },
      );
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
      setWorkspaceError('Please enter a research query');
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
      setWorkspaceError('Unable to save this research session');
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
      clearWorkspaceError();
      setResult(null);
      resetStream();
      addEstimatedTokenUsage(runSessionId, activityMessage.id, researchQuery, 'input');

      const streamHandlers = createResearchStreamHandlers({
        sessionId: runSessionId,
        messageId: activityMessage.id,
        addEstimatedTokenUsage,
        addStreamAgentMessage,
        addStreamStatus,
        addStreamThinking,
        addStreamTrace,
        onMetadata: (metadata) => {
          activeResearchRef.current = {
            sessionId: runSessionId,
            messageId: activityMessage.id,
            runId: metadata.run_id,
            traceId: metadata.trace_id ?? null,
          };
          updateResearchActivityMessage(
            runSessionId,
            activityMessage.id,
            (message) => setResearchActivityRunMetadata(message, metadata),
          );
        },
        setStreamDocuments,
        setStreamTokenUsage,
        updateResearchActivityMessage,
      });
      const researchResult = await apiClient.streamResearch(
        {
          query: researchQuery,
          execution_mode: options.skipPlan ? 'react' : activePlan ? 'report' : 'auto',
          thread_id: runSessionId,
          messages: history,
          latest_result: latestResultForFollowUp,
        },
        {
          ...streamHandlers,
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
      setDismissedSidebarQuery(null);
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
        const diagnostic = {
          requestId: getRequestIdFromError(researchError),
          runId: activeResearchRef.current?.runId ?? null,
          traceId: activeResearchRef.current?.traceId ?? null,
        };
        void apiClient.reportClientError({
          message: researchError instanceof Error ? researchError.message : String(researchError || 'Research failed'),
          source: 'research-submit',
          level: 'error',
          request_id: diagnostic.requestId,
          run_id: diagnostic.runId,
          context: {
            session_id: runSessionId,
            message_id: activityMessage.id,
            query: researchQuery,
            trace_id: diagnostic.traceId,
          },
        });
        setWorkspaceError(
          researchError instanceof Error ? researchError.message : 'An error occurred',
          diagnostic,
        );
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
    clearWorkspaceError();
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

  const hasExistingUserMessageForQuery = (requestedQuery: string) => (
    messagesRef.current.some((message) => (
      message.role === 'user' && message.content.trim() === requestedQuery.trim()
    ))
  );

  const getErrorRecoveryQuery = () => localQuery.trim() || query.trim();

  const handleRetryFromError = () => {
    const recoveryQuery = getErrorRecoveryQuery();
    clearWorkspaceError();

    if (!recoveryQuery) {
      return;
    }

    setLocalQuery(recoveryQuery);
    void handleCreatePlan(recoveryQuery, {
      appendUserMessage: !hasExistingUserMessageForQuery(recoveryQuery),
    });
  };

  const handleDirectAnswerFromError = () => {
    const recoveryQuery = getErrorRecoveryQuery();
    clearWorkspaceError();

    if (!recoveryQuery) {
      return;
    }

    void handleStartResearch(recoveryQuery, {
      skipPlan: true,
      appendUserMessage: !hasExistingUserMessageForQuery(recoveryQuery),
    });
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

  const workspaceProps: ResearchWorkspaceViewProps = {
    activePlan,
    activePlanActivityMessage,
    activeSessionId,
    authEmail: authSession?.user.email ?? null,
    canUseWorkspace,
    currentQuery,
    error,
    errorDiagnostic,
    hasConversation,
    hasInlineRunningActivity,
    isDeepResearchMode,
    isLoading,
    isMobileChatOpen,
    isMobileReportOpen,
    isPlanning,
    isWorkspacePending,
    localQuery,
    query,
    sessions,
    shouldShowPlanPanel,
    sidebarResult,
    visibleMessages,
    conversationEndRef,
    conversationScrollRef,
    onCancelPlan: handleCancelPlan,
    onCloseReportSidebar: handleCloseReportSidebar,
    onCreatePlan: handleCreatePlan,
    onDirectAnswerFromError: handleDirectAnswerFromError,
    onEditPlan: handleEditPlan,
    onExpandReport: handleExpandReport,
    onNewChat: handleNewChat,
    onPlanRevealComplete: handlePlanRevealComplete,
    onQueryChange: handleQueryChange,
    onRetryFromError: handleRetryFromError,
    onSelectSession: handleSelectSession,
    onSignOut: handleSignOut,
    onStartResearch: handleStartResearch,
    onStarterPrompt: handleStarterPrompt,
    onStop: handleStop,
    onToggleDeepResearchMode: handleToggleDeepResearchMode,
    setMobileChatOpen,
    setMobileReportOpen,
  };

  return {
    authError,
    handleSignIn,
    hasLoadedSessions,
    isAuthConfigured: isSupabaseAuthConfigured(),
    isSigningIn,
    shouldShowLogin: hasLoadedSessions && !authSession,
    workspaceProps,
  };
}
