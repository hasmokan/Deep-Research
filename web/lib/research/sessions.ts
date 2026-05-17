import type { ResearchResult } from '@/lib/api/types';
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

function sortSessionsByActivity(sessions: ResearchSession[]) {
  return [...sessions].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
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

function isConversationMessage(value: unknown): value is ConversationMessage {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === 'string' &&
    (value.role === 'user' || value.role === 'assistant') &&
    typeof value.content === 'string' &&
    typeof value.createdAt === 'string'
  );
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

export function createResearchSessionFromServerThread(thread: {
  thread_id: string;
  title: string;
  messages: unknown[];
  created_at: string;
  updated_at: string;
}): ResearchSession {
  const messages = thread.messages.filter(isConversationMessage);

  return {
    id: thread.thread_id,
    title: thread.title || getSessionTitle(messages),
    messages,
    latestResult: getLatestResult(messages),
    createdAt: thread.created_at,
    updatedAt: thread.updated_at,
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

export function loadResearchSessionSnapshot(storage: SessionStorageLike): ResearchSessionSnapshot {
  try {
    const rawValue = storage.getItem(RESEARCH_SESSIONS_STORAGE_KEY);
    if (!rawValue) {
      return EMPTY_SNAPSHOT;
    }

    const parsedValue = JSON.parse(rawValue);
    if (!isRecord(parsedValue) || !Array.isArray(parsedValue.sessions)) {
      return EMPTY_SNAPSHOT;
    }

    return {
      activeSessionId: typeof parsedValue.activeSessionId === 'string' ? parsedValue.activeSessionId : null,
      sessions: sortSessionsByActivity(parsedValue.sessions.filter(isResearchSession)),
    };
  } catch {
    return EMPTY_SNAPSHOT;
  }
}

export function saveResearchSessionSnapshot(
  storage: SessionStorageLike,
  snapshot: ResearchSessionSnapshot,
) {
  storage.setItem(RESEARCH_SESSIONS_STORAGE_KEY, JSON.stringify(snapshot));
}
