'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ResearchWorkspaceViewProps } from '@/components/research/research-workspace-view';
import { apiClient } from '@/lib/api';
import { getSupabaseClient, isSupabaseAuthConfigured, signInWithGoogle } from '@/lib/auth/supabase';
import {
  appendAssistantAnswerDelta,
  appendResearchActivityAgentMessage,
  appendResearchActivityDocuments,
  appendResearchActivityEstimatedTokenUsage,
  appendResearchActivityStatus,
  appendResearchActivityThinking,
  appendResearchActivityTokenUsage,
  appendResearchActivityTrace,
  applyResearchRunToActivityMessage,
  buildResearchRequestMessages,
  completeResearchActivityMessage,
  createAssistantResearchActivityMessage,
  createUserMessage,
  setResearchActivityRunMetadata,
  type ConversationMessage,
  updateResearchActivityMessageStatus,
} from '@/lib/research/conversation';
import {
  getRequestIdFromError,
  hasErrorDiagnostic,
  type ErrorDiagnostic,
} from '@/lib/research/error-diagnostics';
import {
  getLatestArtifactResult,
  isReportResult,
} from '@/lib/research/result-selectors';
import {
  getResearchQueryOverride,
  normalizeResearchPlan,
  shouldRenderResearchPlanShell,
  type ResearchPlan,
} from '@/lib/research/research-workflow';
import {
  createResearchSession,
  researchThreadUpdateFromSession,
  updateResearchSessionMessages,
  upsertResearchSession,
  type ResearchSession,
} from '@/lib/research/sessions';
import {
  getAgentMessageTokenEstimate,
  getDocumentsTokenEstimate,
} from '@/lib/research/token-estimates';
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

  useEffect(() => {
    if (!hasConversation) {
      return;
    }

    window.requestAnimationFrame(() => {
      const scrollContainer = conversationScrollRef.current;
      if (!scrollContainer) {
        conversationEndRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'end',
        });
        return;
      }

      scrollContainer.scrollTo({
        top: scrollContainer.scrollHeight,
        behavior: 'smooth',
      });
    });
  }, [
    hasConversation,
    messages.length,
    streamingActivitySignature,
    researchPlan,
    isPlanning,
    isLoading,
    error,
    result,
  ]);

  useEffect(() => {
    const reportClientError = (
      message: string,
      source: string,
      context: Record<string, unknown> = {},
    ) => {
      void apiClient.reportClientError({
        message,
        source,
        level: 'error',
        context: {
          active_session_id: activeSessionIdRef.current,
          ...context,
        },
      });
    };

    const handleWindowError = (event: ErrorEvent) => {
      reportClientError(
        event.error instanceof Error ? event.error.message : event.message || 'Unhandled browser error',
        'window.onerror',
        {
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
        },
      );
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      reportClientError(
        reason instanceof Error ? reason.message : String(reason || 'Unhandled promise rejection'),
        'unhandledrejection',
      );
    };

    window.addEventListener('error', handleWindowError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      window.removeEventListener('error', handleWindowError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, [activeSessionIdRef]);

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
    void apiClient.saveResearchThread(updatedSession.id, researchThreadUpdateFromSession(updatedSession))
      .catch((saveError) => {
        const requestId = getRequestIdFromError(saveError);
        setErrorDiagnostic(requestId ? { requestId } : null);
        setError(saveError instanceof Error ? saveError.message : 'Unable to save this research session');
      });
  }, [activeSessionIdRef, saveAuthenticatedSessionSnapshot, sessionsRef, setError, setSessions]);

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
    void apiClient.saveResearchThread(updatedSession.id, researchThreadUpdateFromSession(updatedSession))
      .catch((saveError) => {
        const requestId = getRequestIdFromError(saveError);
        setErrorDiagnostic(requestId ? { requestId } : null);
        setError(saveError instanceof Error ? saveError.message : 'Unable to save this research session');
      });

    return updatedSession.id;
  };

  const commitVisibleMessages = (
    nextMessages: ConversationMessage[],
    sessionId: string | null = activeSessionIdRef.current,
  ) => {
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
  }, [activeSessionIdRef, messagesRef, persistMessagesToSession, sessionsRef, setMessages]);

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
        addEstimatedTokenUsage(activity.sessionId, activity.messageId, run.query, 'input');

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
              addEstimatedTokenUsage(
                activity.sessionId,
                activity.messageId,
                `${trace.title}\n${trace.detail}`,
                trace.kind === 'tool_result' ? 'input' : 'output',
              );
              updateResearchActivityMessage(
                activity.sessionId,
                activity.messageId,
                (message) => appendResearchActivityTrace(message, trace),
              );
            },
            onAgentMessage: (agentMessage) => {
              addStreamAgentMessage(agentMessage);
              const estimate = getAgentMessageTokenEstimate(agentMessage);
              if (estimate) {
                addEstimatedTokenUsage(activity.sessionId, activity.messageId, estimate.text, estimate.direction);
              }
              updateResearchActivityMessage(
                activity.sessionId,
                activity.messageId,
                (message) => appendResearchActivityAgentMessage(message, agentMessage),
              );
            },
            onDocuments: (documents) => {
              setStreamDocuments(documents);
              addEstimatedTokenUsage(
                activity.sessionId,
                activity.messageId,
                getDocumentsTokenEstimate(documents),
                'input',
              );
              updateResearchActivityMessage(
                activity.sessionId,
                activity.messageId,
                (message) => appendResearchActivityDocuments(message, documents),
              );
            },
            onThinking: (thinking) => {
              addStreamThinking(thinking);
              addEstimatedTokenUsage(activity.sessionId, activity.messageId, thinking.text, 'output');
              updateResearchActivityMessage(
                activity.sessionId,
                activity.messageId,
                (message) => appendResearchActivityThinking(message, thinking),
              );
            },
            onAnswerDelta: (delta) => {
              addEstimatedTokenUsage(activity.sessionId, activity.messageId, delta, 'output');
              updateResearchActivityMessage(
                activity.sessionId,
                activity.messageId,
                (message) => appendAssistantAnswerDelta(message, delta),
              );
            },
            onTokenUsage: (tokenUsage) => {
              setStreamTokenUsage(tokenUsage);
              updateResearchActivityMessage(
                activity.sessionId,
                activity.messageId,
                (message) => appendResearchActivityTokenUsage(message, tokenUsage),
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
          setDismissedSidebarQuery(null);
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
    addStreamAgentMessage,
    addStreamStatus,
    addStreamThinking,
    addStreamTrace,
    addEstimatedTokenUsage,
    activeSessionIdRef,
    hasLoadedSessions,
    setLoading,
    setResult,
    setStreamDocuments,
    setStreamTokenUsage,
    sessionsRef,
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

      const researchResult = await apiClient.streamResearch(
        {
          query: researchQuery,
          execution_mode: options.skipPlan ? 'react' : activePlan ? 'report' : 'auto',
          thread_id: runSessionId,
          messages: history,
          latest_result: latestResultForFollowUp,
        },
        {
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
            addEstimatedTokenUsage(
              runSessionId,
              activityMessage.id,
              `${trace.title}\n${trace.detail}`,
              trace.kind === 'tool_result' ? 'input' : 'output',
            );
            updateResearchActivityMessage(
              runSessionId,
              activityMessage.id,
              (message) => appendResearchActivityTrace(message, trace),
            );
          },
          onAgentMessage: (agentMessage) => {
            addStreamAgentMessage(agentMessage);
            const estimate = getAgentMessageTokenEstimate(agentMessage);
            if (estimate) {
              addEstimatedTokenUsage(runSessionId, activityMessage.id, estimate.text, estimate.direction);
            }
            updateResearchActivityMessage(
              runSessionId,
              activityMessage.id,
              (message) => appendResearchActivityAgentMessage(message, agentMessage),
            );
          },
          onDocuments: (documents) => {
            setStreamDocuments(documents);
            addEstimatedTokenUsage(
              runSessionId,
              activityMessage.id,
              getDocumentsTokenEstimate(documents),
              'input',
            );
            updateResearchActivityMessage(
              runSessionId,
              activityMessage.id,
              (message) => appendResearchActivityDocuments(message, documents),
            );
          },
          onThinking: (thinking) => {
            addStreamThinking(thinking);
            addEstimatedTokenUsage(runSessionId, activityMessage.id, thinking.text, 'output');
            updateResearchActivityMessage(
              runSessionId,
              activityMessage.id,
              (message) => appendResearchActivityThinking(message, thinking),
            );
          },
          onAnswerDelta: (delta) => {
            addEstimatedTokenUsage(runSessionId, activityMessage.id, delta, 'output');
            updateResearchActivityMessage(
              runSessionId,
              activityMessage.id,
              (message) => appendAssistantAnswerDelta(message, delta),
            );
          },
          onTokenUsage: (tokenUsage) => {
            setStreamTokenUsage(tokenUsage);
            updateResearchActivityMessage(
              runSessionId,
              activityMessage.id,
              (message) => appendResearchActivityTokenUsage(message, tokenUsage),
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
