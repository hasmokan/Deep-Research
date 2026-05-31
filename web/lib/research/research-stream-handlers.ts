import type {
  AgentMessage,
  Document,
  ResearchStreamHandlers,
  ResearchStreamStatus,
  ResearchStreamThinking,
  ResearchStreamTrace,
  TokenUsage,
} from '@/lib/api/types';
import {
  appendAssistantAnswerDelta,
  appendResearchActivityAgentMessage,
  appendResearchActivityDocuments,
  appendResearchActivityStatus,
  appendResearchActivityThinking,
  appendResearchActivityTokenUsage,
  appendResearchActivityTrace,
  type ConversationMessage,
} from './conversation';
import {
  getAgentMessageTokenEstimate,
  getDocumentsTokenEstimate,
} from './token-estimates';
import type { TokenUsageDirection } from './token-usage';

export type ResearchActivityMessageUpdater = (
  sessionId: string,
  messageId: string,
  updateMessage: (message: ConversationMessage) => ConversationMessage,
) => void;

interface CreateResearchStreamHandlersOptions {
  sessionId: string;
  messageId: string;
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
  onMetadata?: ResearchStreamHandlers['onMetadata'];
  setStreamDocuments: (documents: Document[]) => void;
  setStreamTokenUsage: (tokenUsage: TokenUsage) => void;
  updateResearchActivityMessage: ResearchActivityMessageUpdater;
}

function getTraceTokenDirection(trace: ResearchStreamTrace): TokenUsageDirection {
  return trace.kind === 'tool_result' ? 'input' : 'output';
}

export function createResearchStreamHandlers({
  sessionId,
  messageId,
  addEstimatedTokenUsage,
  addStreamAgentMessage,
  addStreamStatus,
  addStreamThinking,
  addStreamTrace,
  onMetadata,
  setStreamDocuments,
  setStreamTokenUsage,
  updateResearchActivityMessage,
}: CreateResearchStreamHandlersOptions): ResearchStreamHandlers {
  return {
    onMetadata,
    onStatus: (status) => {
      addStreamStatus(status);
      updateResearchActivityMessage(
        sessionId,
        messageId,
        (message) => appendResearchActivityStatus(message, status),
      );
    },
    onTrace: (trace) => {
      addStreamTrace(trace);
      addEstimatedTokenUsage(
        sessionId,
        messageId,
        `${trace.title}\n${trace.detail}`,
        getTraceTokenDirection(trace),
      );
      updateResearchActivityMessage(
        sessionId,
        messageId,
        (message) => appendResearchActivityTrace(message, trace),
      );
    },
    onAgentMessage: (agentMessage) => {
      addStreamAgentMessage(agentMessage);
      const estimate = getAgentMessageTokenEstimate(agentMessage);
      if (estimate) {
        addEstimatedTokenUsage(sessionId, messageId, estimate.text, estimate.direction);
      }
      updateResearchActivityMessage(
        sessionId,
        messageId,
        (message) => appendResearchActivityAgentMessage(message, agentMessage),
      );
    },
    onDocuments: (documents) => {
      setStreamDocuments(documents);
      addEstimatedTokenUsage(
        sessionId,
        messageId,
        getDocumentsTokenEstimate(documents),
        'input',
      );
      updateResearchActivityMessage(
        sessionId,
        messageId,
        (message) => appendResearchActivityDocuments(message, documents),
      );
    },
    onThinking: (thinking) => {
      addStreamThinking(thinking);
      addEstimatedTokenUsage(sessionId, messageId, thinking.text, 'output');
      updateResearchActivityMessage(
        sessionId,
        messageId,
        (message) => appendResearchActivityThinking(message, thinking),
      );
    },
    onAnswerDelta: (delta) => {
      addEstimatedTokenUsage(sessionId, messageId, delta, 'output');
      updateResearchActivityMessage(
        sessionId,
        messageId,
        (message) => appendAssistantAnswerDelta(message, delta),
      );
    },
    onReportDelta: (delta) => {
      addEstimatedTokenUsage(sessionId, messageId, delta, 'output');
    },
    onTokenUsage: (tokenUsage) => {
      setStreamTokenUsage(tokenUsage);
      updateResearchActivityMessage(
        sessionId,
        messageId,
        (message) => appendResearchActivityTokenUsage(message, tokenUsage),
      );
    },
  };
}
