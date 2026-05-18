import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createResearchSession,
  getResearchSessionsStorageKey,
  loadResearchSessionSnapshot,
  readResearchSessionSnapshot,
  researchSessionFromThread,
  researchThreadUpdateFromSession,
  restoreLocalResearchSessionState,
  saveResearchSessionSnapshot,
  updateResearchSessionMessages,
  upsertResearchSession,
} from './sessions.ts';
import { createAssistantResultMessage, createUserMessage } from './conversation.ts';

const completedResult = {
  query: '做研究',
  documents: [],
  analysis: 'analysis',
  report: '# 做研究报告',
  status: 'completed',
};

const answerResult = {
  query: '来源是？',
  documents: [],
  analysis: null,
  report: null,
  answer: '上一份报告使用了这些来源。',
  result_type: 'answer' as const,
  status: 'completed',
};

const reportResult = {
  query: 'AI research tools',
  documents: [],
  analysis: 'analysis',
  report: '# AI research tools',
  result_type: 'report' as const,
  status: 'completed',
};

function createMemoryStorage(initialValue?: string) {
  let value = initialValue ?? null;

  return {
    getItem() {
      return value;
    },
    setItem(_key: string, nextValue: string) {
      value = nextValue;
    },
  };
}

test('updateResearchSessionMessages derives title and latest result from messages', () => {
  const session = createResearchSession({
    id: 'session-1',
    now: '2026-05-16T10:00:00.000Z',
  });
  const messages = [
    createUserMessage('Deep research source quality roadmap'),
    createAssistantResultMessage(completedResult),
  ];

  const updatedSession = updateResearchSessionMessages(session, messages, '2026-05-16T10:01:00.000Z');

  assert.equal(updatedSession.title, 'Deep research source quality roadmap');
  assert.equal(updatedSession.latestResult?.report, '# 做研究报告');
  assert.equal(updatedSession.updatedAt, '2026-05-16T10:01:00.000Z');
});

test('updateResearchSessionMessages keeps latest report artifact when a follow-up answer is appended', () => {
  const session = createResearchSession({
    id: 'session-1',
    now: '2026-05-16T10:00:00.000Z',
  });
  const messages = [
    createUserMessage('Deep research source quality roadmap'),
    createAssistantResultMessage(completedResult),
    createUserMessage('来源是？'),
    createAssistantResultMessage(answerResult),
  ];

  const updatedSession = updateResearchSessionMessages(session, messages, '2026-05-16T10:02:00.000Z');

  assert.equal(updatedSession.latestResult?.report, '# 做研究报告');
});

test('upsertResearchSession keeps sessions sorted by recent activity', () => {
  const older = createResearchSession({
    id: 'older',
    now: '2026-05-16T10:00:00.000Z',
  });
  const newer = createResearchSession({
    id: 'newer',
    now: '2026-05-16T10:05:00.000Z',
  });

  const snapshot = upsertResearchSession(
    { activeSessionId: 'older', sessions: [older] },
    newer,
  );

  assert.deepEqual(
    snapshot.sessions.map((session) => session.id),
    ['newer', 'older'],
  );
});

test('loadResearchSessionSnapshot returns saved sessions and ignores invalid storage', () => {
  const session = createResearchSession({
    id: 'session-1',
    now: '2026-05-16T10:00:00.000Z',
  });
  const storage = createMemoryStorage();

  saveResearchSessionSnapshot(storage, {
    activeSessionId: 'session-1',
    sessions: [session],
  });

  assert.equal(loadResearchSessionSnapshot(storage).activeSessionId, 'session-1');
  assert.equal(loadResearchSessionSnapshot(createMemoryStorage('{')).sessions.length, 0);
});

test('research session storage keys are scoped by authenticated user id', () => {
  assert.equal(
    getResearchSessionsStorageKey('user-1'),
    'deepresearch.sessions.v1.user-1',
  );
  assert.equal(getResearchSessionsStorageKey(null), 'deepresearch.sessions.v1');
});

test('research session snapshots can be stored separately per user', () => {
  const userOneSession = createResearchSession({
    id: 'user-1-session',
    now: '2026-05-16T10:00:00.000Z',
  });
  const userTwoSession = createResearchSession({
    id: 'user-2-session',
    now: '2026-05-16T10:05:00.000Z',
  });
  const values = new Map<string, string>();
  const storage = {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };

  saveResearchSessionSnapshot(
    storage,
    { activeSessionId: userOneSession.id, sessions: [userOneSession] },
    getResearchSessionsStorageKey('user-1'),
  );
  saveResearchSessionSnapshot(
    storage,
    { activeSessionId: userTwoSession.id, sessions: [userTwoSession] },
    getResearchSessionsStorageKey('user-2'),
  );

  assert.equal(
    loadResearchSessionSnapshot(storage, getResearchSessionsStorageKey('user-1')).activeSessionId,
    'user-1-session',
  );
  assert.equal(
    loadResearchSessionSnapshot(storage, getResearchSessionsStorageKey('user-2')).activeSessionId,
    'user-2-session',
  );
});

test('readResearchSessionSnapshot distinguishes a saved empty snapshot from missing or invalid storage', () => {
  const storage = createMemoryStorage();

  saveResearchSessionSnapshot(storage, {
    activeSessionId: null,
    sessions: [],
  });

  assert.deepEqual(readResearchSessionSnapshot(storage), {
    activeSessionId: null,
    sessions: [],
  });
  assert.equal(readResearchSessionSnapshot(createMemoryStorage()), null);
  assert.equal(readResearchSessionSnapshot(createMemoryStorage('{')), null);
});

test('researchSessionFromThread maps API threads into UI sessions with the latest report artifact', () => {
  const userMessage = createUserMessage('AI research tools');
  const reportMessage = createAssistantResultMessage(reportResult);
  const answerMessage = createAssistantResultMessage(answerResult);

  const session = researchSessionFromThread({
    thread_id: 'thread-1',
    title: 'AI research tools',
    messages: [userMessage, reportMessage, answerMessage],
    created_at: '2026-05-16T10:00:00.000Z',
    updated_at: '2026-05-16T10:05:00.000Z',
  });

  assert.equal(session.id, 'thread-1');
  assert.equal(session.latestResult?.result_type, 'report');
  assert.equal(session.latestResult?.report, '# AI research tools');
});

test('researchThreadUpdateFromSession serializes the fields persisted by the API', () => {
  const session = updateResearchSessionMessages(
    createResearchSession({
      id: 'thread-1',
      now: '2026-05-16T10:00:00.000Z',
    }),
    [createUserMessage('AI research tools')],
    '2026-05-16T10:05:00.000Z',
  );

  assert.deepEqual(researchThreadUpdateFromSession(session), {
    title: 'AI research tools',
    messages: session.messages,
  });
});

test('restoreLocalResearchSessionState uses only local storage when no sessions are saved', () => {
  const restored = restoreLocalResearchSessionState(createMemoryStorage());

  assert.equal(restored.activeSessionId, null);
  assert.equal(restored.activeSession, null);
  assert.deepEqual(restored.sessions, []);
});

test('restoreLocalResearchSessionState restores the local active session', () => {
  const older = createResearchSession({
    id: 'older',
    now: '2026-05-16T10:00:00.000Z',
  });
  const newer = createResearchSession({
    id: 'newer',
    now: '2026-05-16T10:05:00.000Z',
  });
  const storage = createMemoryStorage();

  saveResearchSessionSnapshot(storage, {
    activeSessionId: 'older',
    sessions: [newer, older],
  });

  const restored = restoreLocalResearchSessionState(storage);

  assert.equal(restored.activeSessionId, 'older');
  assert.equal(restored.activeSession?.id, 'older');
  assert.deepEqual(
    restored.sessions.map((session) => session.id),
    ['newer', 'older'],
  );
});
