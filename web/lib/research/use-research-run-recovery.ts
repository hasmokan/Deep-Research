'use client';

import { useEffect, type RefObject } from 'react';
import { apiClient } from '@/lib/api';
import type {
  AgentMessage,
  Document,
  ResearchResult,
  ResearchStreamStatus,
  ResearchStreamThinking,
  ResearchStreamTrace,
  TokenUsage,
} from '@/lib/api/types';
import {
  applyResearchRunToActivityMessage,
  completeResearchActivityMessage,
  updateResearchActivityMessageStatus,
} from './conversation';
import {
  createResearchStreamHandlers,
  type ResearchActivityMessageUpdater,
} from './research-stream-handlers';
import type { ResearchSession } from './sessions';
import type { TokenUsageDirection } from './token-usage';

interface UseResearchRunRecoveryOptions {
  activeSessionIdRef: RefObject<string | null>;
  addEstimatedTokenUsage: (
    sessionId: string,
    messageId: string,
    text: string,
    direction: TokenUsageDirection,
  ) => void;
  addStreamAgentMessage: (message: AgentMessage) => void;
  addStreamStatus: (status: ResearchStreamStatus) => void;
  addStreamThinking: (thinking: ResearchStreamThinking) => void;
  addStreamTrace: (trace: ResearchStreamTrace) => void;
  hasLoadedSessions: boolean;
  recoveryAbortControllersRef: RefObject<Map<string, AbortController>>;
  sessionsRef: RefObject<ResearchSession[]>;
  setDeepResearchMode: (enabled: boolean) => void;
  setDismissedSidebarQuery: (query: string | null) => void;
  setLoading: (loading: boolean) => void;
  setResult: (result: ResearchResult | null) => void;
  setStreamDocuments: (documents: Document[]) => void;
  setStreamTokenUsage: (tokenUsage: TokenUsage) => void;
  updateResearchActivityMessage: ResearchActivityMessageUpdater;
}

export function useResearchRunRecovery({
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
}: UseResearchRunRecoveryOptions) {
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
        const streamHandlers = createResearchStreamHandlers({
          sessionId: activity.sessionId,
          messageId: activity.messageId,
          addEstimatedTokenUsage,
          addStreamAgentMessage,
          addStreamStatus,
          addStreamThinking,
          addStreamTrace,
          setStreamDocuments,
          setStreamTokenUsage,
          updateResearchActivityMessage,
        });
        const researchResult = await apiClient.streamResearchRun(
          activity.runId,
          {
            afterSeq,
            ...streamHandlers,
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
  ]);
}
