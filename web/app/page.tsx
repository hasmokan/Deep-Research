'use client';

/**
 * Chatbot-first deep research interface.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BookOpenCheck,
  CheckCircle2,
  Compass,
  FlaskConical,
  LogOut,
  SearchCheck,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LoginScreen } from '@/components/auth/login-screen';
import { ChatSidebar } from '@/components/layouts/chat-sidebar';
import { ErrorState, LoadingState, ReportSidebar, ResultsDisplay, SearchForm } from '@/components/research';
import { MarkdownContent } from '@/components/research/markdown-content';
import { ResearchPlanPanel } from '@/components/research/research-plan-panel';
import { apiClient } from '@/lib/api';
import type { ResearchResult } from '@/lib/api/types';
import { getSupabaseClient, isSupabaseAuthConfigured, signInWithGoogle } from '@/lib/auth/supabase';
import {
  appendAssistantAnswerDelta,
  appendResearchActivityStatus,
  appendResearchActivityDocuments,
  appendResearchActivityTrace,
  appendResearchActivityAgentMessage,
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
import { useAuthenticatedResearchSessions } from '@/lib/research/use-authenticated-research-sessions';
import { useResearchStore } from '@/lib/store/research';

const STARTER_PROMPTS: Array<{ label: string; prompt: string; Icon: LucideIcon }> = [
  {
    label: 'AI agent product map',
    prompt: 'Map the current AI agent product landscape and compare the strongest positioning signals.',
    Icon: Compass,
  },
  {
    label: 'Company strategy brief',
    prompt: 'Compare OpenAI and Anthropic strategy across product, distribution, and enterprise adoption.',
    Icon: BookOpenCheck,
  },
  {
    label: 'Evidence timeline',
    prompt: 'Build a source-backed timeline for recent AI policy and model release milestones.',
    Icon: FlaskConical,
  },
];

function UserBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[560px] rounded-[20px] bg-foreground px-4 py-3 text-sm leading-6 text-background">
        {content}
      </div>
    </div>
  );
}

function ThinkingDots() {
  return (
    <div className="mx-auto flex w-full max-w-[640px] items-center gap-2 px-2 py-2 text-sm text-muted-foreground">
      <span className="relative flex h-5 w-5 items-center justify-center rounded-full border border-foreground/20 text-foreground">
        <Sparkles className="h-3.5 w-3.5" />
      </span>
      <span>Thinking</span>
      <span className="inline-flex items-center gap-1" aria-hidden="true">
        <span className="h-1 w-1 animate-agent-dot rounded-full bg-muted-foreground [animation-delay:0ms]" />
        <span className="h-1 w-1 animate-agent-dot rounded-full bg-muted-foreground [animation-delay:160ms]" />
        <span className="h-1 w-1 animate-agent-dot rounded-full bg-muted-foreground [animation-delay:320ms]" />
      </span>
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

function AssistantResultMessage({ message }: { message: ConversationMessage }) {
  if (!message.result && !message.researchActivity && !message.researchPlan) {
    return null;
  }

  if (message.researchPlan) {
    return (
      <div className="mx-auto max-w-[680px]">
        <ResearchPlanPanel
          plan={message.researchPlan}
          activity={message.researchActivity}
        />
      </div>
    );
  }

  if (message.result?.result_type === 'answer') {
    return (
      <>
        {message.researchActivity && (
          <div className="mx-auto w-full max-w-[680px]">
            <LoadingState activity={message.researchActivity} />
          </div>
        )}

        <div className="mx-auto w-full max-w-[640px]">
          <div className="flex gap-3">
            <div className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
              <CheckCircle2 className="h-3.5 w-3.5" />
            </div>
            <article className="min-w-0 flex-1">
              <MarkdownContent
                content={message.result.answer || message.result.report || message.content}
                className="text-sm leading-6"
              />
            </article>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      {message.researchActivity && (
        <div className="mx-auto w-full max-w-[720px]">
          <LoadingState activity={message.researchActivity} />
        </div>
      )}

      {message.result && (
        <>
          <div className="mx-auto w-full max-w-3xl xl:hidden">
            <ResultsDisplay result={message.result} />
          </div>

          <div className="mx-auto hidden w-full max-w-[620px] xl:block">
            <div className="rounded-[14px] border border-border bg-card p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
                  <CheckCircle2 className="h-3.5 w-3.5" />
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
  const [isSigningIn, setSigningIn] = useState(false);
  const [isPlanning, setPlanning] = useState(false);
  const [isDeepResearchMode, setDeepResearchMode] = useState(true);
  const abortControllerRef = useRef<AbortController | null>(null);
  const recoveryAbortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const conversationEndRef = useRef<HTMLDivElement | null>(null);
  const conversationScrollRef = useRef<HTMLDivElement | null>(null);
  const activeResearchRef = useRef<{ sessionId: string; messageId: string } | null>(null);
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
    addStreamAgentMessage,
  } = useResearchStore();

  const clearResearchUiState = useCallback(() => {
    abortControllerRef.current?.abort();
    recoveryAbortControllersRef.current.forEach((controller) => controller.abort());
    recoveryAbortControllersRef.current.clear();
    activeResearchRef.current = null;
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
  const sidebarResult = latestContextResult;
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
  }, [activeSessionIdRef, messagesRef, persistMessagesToSession, sessionsRef, setMessages]);

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
            onAgentMessage: (agentMessage) => {
              addStreamAgentMessage(agentMessage);
              updateResearchActivityMessage(
                activity.sessionId,
                activity.messageId,
                (message) => appendResearchActivityAgentMessage(message, agentMessage),
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
            onAnswerDelta: (delta) => {
              updateResearchActivityMessage(
                activity.sessionId,
                activity.messageId,
                (message) => appendAssistantAnswerDelta(message, delta),
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
    addStreamAgentMessage,
    addStreamStatus,
    addStreamThinking,
    addStreamTrace,
    activeSessionIdRef,
    hasLoadedSessions,
    setLoading,
    setResult,
    setStreamDocuments,
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
    void apiClient.saveResearchThread(session.id, researchThreadUpdateFromSession(session))
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

  const handleStarterPrompt = (prompt: string) => {
    if (!canUseWorkspace) {
      return;
    }

    handleQueryChange(prompt);
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
    } catch (planError) {
      setResearchPlan(null);
      setLocalQuery(requestedQuery);
      setError(planError instanceof Error ? planError.message : 'Research plan generation failed. Please try again.');
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
            execution_mode: options.skipPlan ? 'react' : activePlan ? 'report' : 'auto',
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
          onAgentMessage: (agentMessage) => {
            addStreamAgentMessage(agentMessage);
            updateResearchActivityMessage(
              runSessionId,
              activityMessage.id,
              (message) => appendResearchActivityAgentMessage(message, agentMessage),
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
          onAnswerDelta: (delta) => {
            updateResearchActivityMessage(
              runSessionId,
              activityMessage.id,
              (message) => appendAssistantAnswerDelta(message, delta),
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

  if (hasLoadedSessions && !authSession) {
    return (
      <LoginScreen
        error={authError}
        isLoading={isSigningIn}
        onSignIn={handleSignIn}
      />
    );
  }

  return (
    <div
      className="flex h-dvh overflow-hidden bg-background text-foreground"
      aria-busy={isWorkspacePending}
    >
      <ChatSidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        isDisabled={!canUseWorkspace}
        isPending={isWorkspacePending}
        onNewChat={handleNewChat}
        onSelectSession={handleSelectSession}
      />

      <main className="relative flex h-dvh min-w-0 flex-1 flex-col overflow-hidden">
        <header className="z-40 flex h-12 shrink-0 items-center justify-between border-b border-border/60 bg-background/90 px-4 backdrop-blur-xl lg:px-5">
          <div className="flex items-center gap-2 lg:hidden">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-foreground text-background">
              <SearchCheck className="h-4 w-4" />
            </div>
            <span className="text-base font-semibold">DeepResearch</span>
          </div>
          <div className="hidden lg:block" />
          <div className="flex min-w-0 items-center gap-2">
            {authSession && (
              <>
                <span className="hidden max-w-[240px] truncate text-sm text-muted-foreground md:inline">
                  {authSession.user.email}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 rounded-lg"
                  aria-label="Sign out"
                  onClick={() => {
                    void handleSignOut();
                  }}
                >
                  <LogOut className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
        </header>

        <div ref={conversationScrollRef} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 pb-48 pt-5 md:px-5">
            {!hasConversation && (
              <div className="flex flex-1 items-start justify-center pt-[18vh] md:pt-[21vh]">
                <div className="w-full max-w-[640px]">
                  <div className="mx-auto mb-4 max-w-[480px] text-center">
                    <h1 className="text-2xl font-semibold leading-tight text-foreground md:text-[28px]">
                      Hello again.
                    </h1>
                    <p className="mx-auto mt-3 text-sm leading-6 text-muted-foreground">
                      Ask a question, compare sources, or turn a thread into a focused research brief.
                    </p>
                  </div>

                  <SearchForm
                    query={localQuery}
                    isLoading={isLoading}
                    isPlanning={isPlanning}
                    isDisabled={!canUseWorkspace}
                    placeholder="How can I assist you today?"
                    hasPlan={Boolean(activePlan)}
                    isDeepResearchMode={isDeepResearchMode}
                    onQueryChange={handleQueryChange}
                    onCreatePlan={handleCreatePlan}
                    onStartResearch={handleStartResearch}
                    onToggleDeepResearchMode={handleToggleDeepResearchMode}
                    onStop={handleStop}
                  />

                  <div className="mx-auto mt-7 flex max-w-[600px] flex-wrap items-center justify-center gap-2">
                    {STARTER_PROMPTS.map(({ label, prompt, Icon }) => (
                      <button
                        key={label}
                        type="button"
                        disabled={!canUseWorkspace}
                        onClick={() => handleStarterPrompt(prompt)}
                        className="group inline-flex h-9 items-center gap-2 rounded-full border border-border bg-card/70 px-3 text-sm font-medium text-muted-foreground transition-colors hover:border-foreground/25 hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                      >
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors group-hover:text-foreground">
                          <Icon className="h-4 w-4" />
                        </span>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {hasConversation && (
              <div className="space-y-6">
                {visibleMessages.map((message) => (
                  message.role === 'user' ? (
                    <UserBubble key={message.id} content={message.content} />
                  ) : (
                    <AssistantResultMessage key={message.id} message={message} />
                  )
                ))}

                {isPlanning && !activePlan && <ThinkingDots />}

                {shouldShowPlanPanel && (
                  <div className="mx-auto max-w-[700px]">
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
                  <div className="mx-auto max-w-[720px]">
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

        {hasConversation && (
          <div className="pointer-events-none absolute bottom-0 left-0 right-0 z-40 bg-gradient-to-t from-background via-background/95 to-transparent px-4 pb-3 pt-12">
            <SearchForm
              query={localQuery}
              isLoading={isLoading}
              isPlanning={isPlanning}
              isDisabled={!canUseWorkspace}
              hasPlan={Boolean(activePlan)}
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
        )}
      </main>

      {sidebarResult && <ReportSidebar result={sidebarResult} />}
    </div>
  );
}
