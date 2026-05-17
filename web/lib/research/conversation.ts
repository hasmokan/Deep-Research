import type {
  ResearchRequestMessage,
  ResearchResult,
  ResearchRun,
  ResearchRunEvent,
  ResearchStreamStatus,
  ResearchStreamThinking,
} from '@/lib/api/types';

export type ConversationRole = 'user' | 'assistant';
export type ResearchActivityStatus = 'running' | 'completed' | 'failed' | 'stopped';

export interface ConversationResearchActivity {
  runId?: string;
  query: string;
  status: ResearchActivityStatus;
  streamStatuses: ResearchStreamStatus[];
  streamThinking: ResearchStreamThinking[];
  startedAt: string;
  updatedAt: string;
}

export interface ConversationMessage {
  id: string;
  role: ConversationRole;
  content: string;
  createdAt: string;
  result?: ResearchResult;
  researchActivity?: ConversationResearchActivity;
}

interface BuildHistoryOptions {
  maxMessages?: number;
  maxContentLength?: number;
}

interface CreateAssistantResearchActivityMessageOptions {
  id?: string;
  now?: string;
}

const DEFAULT_MAX_MESSAGES = 8;
const DEFAULT_MAX_CONTENT_LENGTH = 3000;

function createMessageId(prefix: ConversationRole) {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getNow() {
  return new Date().toISOString();
}

function truncateContent(content: string, maxLength: number) {
  const normalizedContent = content.trim();

  if (normalizedContent.length <= maxLength) {
    return normalizedContent;
  }

  return `${normalizedContent.slice(0, maxLength).trim()}...`;
}

function getAssistantResultContent(result: ResearchResult) {
  const report = result.report || result.analysis || 'No report text was returned.';

  return [
    `Research report for "${result.query}"`,
    '',
    report,
  ].join('\n');
}

function isResearchStreamStatus(value: unknown): value is ResearchStreamStatus {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const status = value as ResearchStreamStatus;
  return (
    (status.stage === 'search' || status.stage === 'analyze' || status.stage === 'report') &&
    typeof status.label === 'string' &&
    typeof status.message === 'string'
  );
}

function isResearchStreamThinking(value: unknown): value is ResearchStreamThinking {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const thinking = value as ResearchStreamThinking;
  return (
    (thinking.stage === 'analyze' || thinking.stage === 'report') &&
    typeof thinking.label === 'string' &&
    typeof thinking.text === 'string'
  );
}

function isResearchResult(value: unknown): value is ResearchResult {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const result = value as ResearchResult;
  return (
    typeof result.query === 'string' &&
    Array.isArray(result.documents) &&
    typeof result.status === 'string'
  );
}

function getMessageRequestContent(message: ConversationMessage) {
  if (message.result) {
    return getAssistantResultContent(message.result);
  }

  if (message.researchActivity) {
    return '';
  }

  return message.content;
}

export function createUserMessage(content: string): ConversationMessage {
  return {
    id: createMessageId('user'),
    role: 'user',
    content: content.trim(),
    createdAt: new Date().toISOString(),
  };
}

export function createAssistantResultMessage(result: ResearchResult): ConversationMessage {
  return {
    id: createMessageId('assistant'),
    role: 'assistant',
    content: `Research report generated for "${result.query}".`,
    createdAt: new Date().toISOString(),
    result,
  };
}

export function createAssistantResearchActivityMessage(
  query: string,
  options: CreateAssistantResearchActivityMessageOptions = {},
): ConversationMessage {
  const timestamp = options.now ?? getNow();
  const normalizedQuery = query.trim();

  return {
    id: options.id ?? createMessageId('assistant'),
    role: 'assistant',
    content: `Researching "${normalizedQuery}".`,
    createdAt: timestamp,
    researchActivity: {
      query: normalizedQuery,
      status: 'running',
      streamStatuses: [],
      streamThinking: [],
      startedAt: timestamp,
      updatedAt: timestamp,
    },
  };
}

export function appendResearchActivityStatus(
  message: ConversationMessage,
  status: ResearchStreamStatus,
  now: string = getNow(),
): ConversationMessage {
  if (!message.researchActivity) {
    return message;
  }

  return {
    ...message,
    researchActivity: {
      ...message.researchActivity,
      status: 'running',
      streamStatuses: [...message.researchActivity.streamStatuses, status],
      updatedAt: now,
    },
  };
}

export function setResearchActivityRunId(
  message: ConversationMessage,
  runId: string,
  now: string = getNow(),
): ConversationMessage {
  if (!message.researchActivity) {
    return message;
  }

  return {
    ...message,
    researchActivity: {
      ...message.researchActivity,
      runId,
      updatedAt: now,
    },
  };
}

export function appendResearchActivityThinking(
  message: ConversationMessage,
  thinking: ResearchStreamThinking,
  now: string = getNow(),
): ConversationMessage {
  if (!message.researchActivity) {
    return message;
  }

  return {
    ...message,
    researchActivity: {
      ...message.researchActivity,
      status: 'running',
      streamThinking: [...message.researchActivity.streamThinking, thinking],
      updatedAt: now,
    },
  };
}

export function completeResearchActivityMessage(
  message: ConversationMessage,
  result: ResearchResult,
  now: string = getNow(),
): ConversationMessage {
  if (!message.researchActivity) {
    return {
      ...createAssistantResultMessage(result),
      id: message.id,
      createdAt: message.createdAt,
    };
  }

  return {
    ...message,
    content: `Research report generated for "${result.query}".`,
    result,
    researchActivity: {
      ...message.researchActivity,
      status: 'completed',
      updatedAt: now,
    },
  };
}

export function updateResearchActivityMessageStatus(
  message: ConversationMessage,
  status: Exclude<ResearchActivityStatus, 'running' | 'completed'>,
  now: string = getNow(),
): ConversationMessage {
  if (!message.researchActivity) {
    return message;
  }

  return {
    ...message,
    researchActivity: {
      ...message.researchActivity,
      status,
      updatedAt: now,
    },
  };
}

export function stopRunningResearchActivityMessage(
  message: ConversationMessage,
  now: string = getNow(),
): ConversationMessage {
  if (message.researchActivity?.status !== 'running') {
    return message;
  }

  return updateResearchActivityMessageStatus(message, 'stopped', now);
}

export function applyResearchRunToActivityMessage(
  message: ConversationMessage,
  run: ResearchRun,
): ConversationMessage {
  if (!message.researchActivity) {
    return message;
  }

  const runUpdatedAt = run.updated_at || getNow();
  let nextMessage: ConversationMessage = {
    ...message,
    researchActivity: {
      ...message.researchActivity,
      runId: run.run_id,
      streamStatuses: [],
      streamThinking: [],
      updatedAt: runUpdatedAt,
    },
  };

  for (const event of run.events) {
    nextMessage = applyResearchRunEvent(nextMessage, event, runUpdatedAt);
  }

  if (nextMessage.researchActivity?.status === 'running' && run.status !== 'running') {
    const terminalStatus = run.status === 'completed' ? 'failed' : run.status;
    if (terminalStatus === 'failed' || terminalStatus === 'stopped') {
      return updateResearchActivityMessageStatus(nextMessage, terminalStatus, runUpdatedAt);
    }
  }

  return nextMessage;
}

function applyResearchRunEvent(
  message: ConversationMessage,
  event: ResearchRunEvent,
  updatedAt: string,
): ConversationMessage {
  if (event.event === 'status' && isResearchStreamStatus(event.data)) {
    return appendResearchActivityStatus(message, event.data, updatedAt);
  }

  if (event.event === 'thinking' && isResearchStreamThinking(event.data)) {
    return appendResearchActivityThinking(message, event.data, updatedAt);
  }

  if (event.event === 'complete' && isResearchResult(event.data)) {
    return completeResearchActivityMessage(message, event.data, updatedAt);
  }

  if (event.event === 'stream_error') {
    return updateResearchActivityMessageStatus(message, 'failed', updatedAt);
  }

  if (event.event === 'stopped') {
    return updateResearchActivityMessageStatus(message, 'stopped', updatedAt);
  }

  return message;
}

export function buildResearchRequestMessages(
  messages: ConversationMessage[],
  options: BuildHistoryOptions = {},
): ResearchRequestMessage[] {
  const maxMessages = options.maxMessages ?? DEFAULT_MAX_MESSAGES;
  const maxContentLength = options.maxContentLength ?? DEFAULT_MAX_CONTENT_LENGTH;

  return messages
    .slice(-maxMessages)
    .map((message) => ({
      role: message.role,
      content: truncateContent(getMessageRequestContent(message), maxContentLength),
    }))
    .filter((message) => message.content.length > 0);
}
