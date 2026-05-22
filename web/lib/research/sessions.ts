import type { ResearchResult, ResearchThread } from '@/lib/api/types';
import type { ConversationMessage } from './conversation';

export const RESEARCH_SESSIONS_STORAGE_KEY = 'deepresearch.sessions.v1';

export interface ResearchSession {
  id: string;
  title: string;
  messages: ConversationMessage[];
  latestResult: ResearchResult | null;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchSessionSnapshot {
  activeSessionId: string | null;
  sessions: ResearchSession[];
}

export interface LocalResearchSessionState {
  activeSessionId: string | null;
  activeSession: ResearchSession | null;
  sessions: ResearchSession[];
}

interface CreateResearchSessionOptions {
  id?: string;
  now?: string;
}

interface SessionStorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

const EMPTY_SNAPSHOT: ResearchSessionSnapshot = {
  activeSessionId: null,
  sessions: [],
};

function createSessionId() {
  if (globalThis.crypto?.randomUUID) {
    return `session-${globalThis.crypto.randomUUID()}`;
  }

  return `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getNow() {
  return new Date().toISOString();
}

function getSessionTitle(messages: ConversationMessage[]) {
  const firstUserMessage = messages.find((message) => message.role === 'user');

  if (!firstUserMessage) {
    return 'New chat';
  }

  const normalizedPrompt = firstUserMessage.content.trim().replace(/\s+/g, ' ');
  const maxLength = 43;

  if (normalizedPrompt.length <= maxLength) {
    return normalizedPrompt;
  }

  return `${normalizedPrompt.slice(0, maxLength - 3).replace(/[,\s]+$/, '')}...`;
}

function getLatestResult(messages: ConversationMessage[]) {
  return [...messages]
    .reverse()
    .find((message) => message.result && message.result.result_type !== 'answer')
    ?.result ?? null;
}

function getLatestArtifactResult(messages: ConversationMessage[]) {
  return [...messages]
    .reverse()
    .find((message) => message.result && message.result.result_type !== 'answer')
    ?.result ?? null;
}

function sortSessionsByActivity(sessions: ResearchSession[]) {
  return [...sessions].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function stopRestoredRunningResearchActivityMessage(
  message: ConversationMessage,
  stoppedAt: string,
): ConversationMessage {
  if (message.researchActivity?.status !== 'running') {
    return message;
  }

  return {
    ...message,
    researchActivity: {
      ...message.researchActivity,
      status: 'stopped',
      updatedAt: stoppedAt,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isResearchSession(value: unknown): value is ResearchSession {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    Array.isArray(value.messages) &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string'
  );
}

function normalizeResearchActivity(activity: ConversationMessage['researchActivity']) {
  if (!activity) {
    return activity;
  }

  return {
    ...activity,
    streamStatuses: Array.isArray(activity.streamStatuses) ? activity.streamStatuses : [],
    streamThinking: Array.isArray(activity.streamThinking) ? activity.streamThinking : [],
    streamDocuments: Array.isArray(activity.streamDocuments) ? activity.streamDocuments : [],
    streamTrace: Array.isArray(activity.streamTrace) ? activity.streamTrace : [],
    streamAgentMessages: Array.isArray(activity.streamAgentMessages) ? activity.streamAgentMessages : [],
    tokenUsage: activity.tokenUsage ?? null,
    liveTokenUsage: activity.liveTokenUsage ?? activity.tokenUsage ?? null,
    isTokenUsageEstimated: Boolean(activity.isTokenUsageEstimated),
  };
}

function normalizeConversationMessage(message: ConversationMessage): ConversationMessage {
  if (!message.researchActivity) {
    return message;
  }

  return {
    ...message,
    researchActivity: normalizeResearchActivity(message.researchActivity),
  };
}

function normalizeConversationMessages(messages: ConversationMessage[]) {
  return messages.map(normalizeConversationMessage);
}

export function createResearchSession(options: CreateResearchSessionOptions = {}): ResearchSession {
  const timestamp = options.now ?? getNow();

  return {
    id: options.id ?? createSessionId(),
    title: 'New chat',
    messages: [],
    latestResult: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function updateResearchSessionMessages(
  session: ResearchSession,
  messages: ConversationMessage[],
  now: string = getNow(),
): ResearchSession {
  return {
    ...session,
    title: getSessionTitle(messages),
    messages,
    latestResult: getLatestResult(messages),
    updatedAt: now,
  };
}

export function upsertResearchSession(
  snapshot: ResearchSessionSnapshot,
  session: ResearchSession,
): ResearchSessionSnapshot {
  const remainingSessions = snapshot.sessions.filter((storedSession) => storedSession.id !== session.id);

  return {
    activeSessionId: snapshot.activeSessionId,
    sessions: sortSessionsByActivity([session, ...remainingSessions]),
  };
}

export function researchSessionFromThread(thread: ResearchThread): ResearchSession {
  const messages = Array.isArray(thread.messages)
    ? normalizeConversationMessages(thread.messages as ConversationMessage[])
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

export function researchThreadUpdateFromSession(session: ResearchSession) {
  return {
    title: session.title,
    messages: session.messages,
  };
}

export function getResearchSessionsStorageKey(userId: string | null | undefined) {
  const normalizedUserId = userId?.trim();

  return normalizedUserId
    ? `${RESEARCH_SESSIONS_STORAGE_KEY}.${normalizedUserId}`
    : RESEARCH_SESSIONS_STORAGE_KEY;
}

export function readResearchSessionSnapshot(
  storage: SessionStorageLike,
  storageKey: string = RESEARCH_SESSIONS_STORAGE_KEY,
): ResearchSessionSnapshot | null {
  try {
    const rawValue = storage.getItem(storageKey);
    if (!rawValue) {
      return null;
    }

    const parsedValue = JSON.parse(rawValue);
    if (!isRecord(parsedValue) || !Array.isArray(parsedValue.sessions)) {
      return null;
    }

    return {
      activeSessionId: typeof parsedValue.activeSessionId === 'string' ? parsedValue.activeSessionId : null,
      sessions: sortSessionsByActivity(parsedValue.sessions.filter(isResearchSession)),
    };
  } catch {
    return null;
  }
}

export function loadResearchSessionSnapshot(
  storage: SessionStorageLike,
  storageKey: string = RESEARCH_SESSIONS_STORAGE_KEY,
): ResearchSessionSnapshot {
  return readResearchSessionSnapshot(storage, storageKey) ?? EMPTY_SNAPSHOT;
}

export function restoreResearchSessionSnapshot(snapshot: ResearchSessionSnapshot): LocalResearchSessionState {
  if (!snapshot.sessions.length) {
    return {
      activeSessionId: null,
      activeSession: null,
      sessions: [],
    };
  }

  const restoredSessions = snapshot.sessions.map((session) => ({
    ...session,
    messages: normalizeConversationMessages(session.messages).map((message) => (
      message.researchActivity?.status === 'running' && message.researchActivity.runId
        ? message
        : stopRestoredRunningResearchActivityMessage(message, session.updatedAt)
    )),
  }));
  const activeSessionId = snapshot.activeSessionId
    && restoredSessions.some((session) => session.id === snapshot.activeSessionId)
    ? snapshot.activeSessionId
    : restoredSessions[0]?.id ?? null;
  const activeSession = restoredSessions.find((session) => session.id === activeSessionId) ?? null;

  return {
    activeSessionId,
    activeSession,
    sessions: restoredSessions,
  };
}

export function restoreLocalResearchSessionState(
  storage: SessionStorageLike,
  storageKey: string = RESEARCH_SESSIONS_STORAGE_KEY,
): LocalResearchSessionState {
  return restoreResearchSessionSnapshot(loadResearchSessionSnapshot(storage, storageKey));
}

export function saveResearchSessionSnapshot(
  storage: SessionStorageLike,
  snapshot: ResearchSessionSnapshot,
  storageKey: string = RESEARCH_SESSIONS_STORAGE_KEY,
) {
  storage.setItem(storageKey, JSON.stringify(snapshot));
}
