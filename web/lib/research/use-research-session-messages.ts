'use client';

import { useCallback, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { apiClient } from '@/lib/api';
import type { ConversationMessage } from './conversation';
import { getRequestIdFromError, type ErrorDiagnostic } from './error-diagnostics';
import {
  createResearchSession,
  researchThreadUpdateFromSession,
  updateResearchSessionMessages,
  upsertResearchSession,
  type ResearchSession,
} from './sessions';

interface UseResearchSessionMessagesOptions {
  activeSessionIdRef: RefObject<string | null>;
  messagesRef: RefObject<ConversationMessage[]>;
  saveAuthenticatedSessionSnapshot: (
    nextSessions: ResearchSession[],
    nextActiveSessionId?: string | null,
  ) => void;
  sessionsRef: RefObject<ResearchSession[]>;
  setActiveSessionId: Dispatch<SetStateAction<string | null>>;
  setError: (error: string | null) => void;
  setErrorDiagnostic: Dispatch<SetStateAction<ErrorDiagnostic | null>>;
  setMessages: Dispatch<SetStateAction<ConversationMessage[]>>;
  setSessions: Dispatch<SetStateAction<ResearchSession[]>>;
}

export function useResearchSessionMessages({
  activeSessionIdRef,
  messagesRef,
  saveAuthenticatedSessionSnapshot,
  sessionsRef,
  setActiveSessionId,
  setError,
  setErrorDiagnostic,
  setMessages,
  setSessions,
}: UseResearchSessionMessagesOptions) {
  const handleSaveError = useCallback((saveError: unknown) => {
    const requestId = getRequestIdFromError(saveError);
    setErrorDiagnostic(requestId ? { requestId } : null);
    setError(saveError instanceof Error ? saveError.message : 'Unable to save this research session');
  }, [setError, setErrorDiagnostic]);

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
      .catch(handleSaveError);
  }, [
    activeSessionIdRef,
    handleSaveError,
    saveAuthenticatedSessionSnapshot,
    sessionsRef,
    setSessions,
  ]);

  const saveActiveSessionMessages = useCallback((nextMessages: ConversationMessage[]) => {
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
      .catch(handleSaveError);

    return updatedSession.id;
  }, [
    activeSessionIdRef,
    handleSaveError,
    saveAuthenticatedSessionSnapshot,
    sessionsRef,
    setActiveSessionId,
    setSessions,
  ]);

  const commitVisibleMessages = useCallback((
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
  }, [
    activeSessionIdRef,
    messagesRef,
    persistMessagesToSession,
    saveActiveSessionMessages,
    setMessages,
  ]);

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
  }, [
    activeSessionIdRef,
    messagesRef,
    persistMessagesToSession,
    sessionsRef,
    setMessages,
  ]);

  return {
    commitVisibleMessages,
    persistMessagesToSession,
    saveActiveSessionMessages,
    updateResearchActivityMessage,
  };
}
