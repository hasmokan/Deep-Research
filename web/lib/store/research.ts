/**
 * Research state management with Zustand
 */

import { create } from 'zustand';
import type {
  AgentMessage,
  Document,
  ResearchResult,
  ResearchStreamStatus,
  ResearchStreamThinking,
  ResearchStreamTrace,
  TokenUsage,
} from '@/lib/api/types';
import { addEstimatedTokenUsageFromText, type TokenUsageDirection } from '@/lib/research/token-usage';

interface ResearchState {
  // State
  query: string;
  isLoading: boolean;
  error: string | null;
  result: ResearchResult | null;
  streamStatuses: ResearchStreamStatus[];
  streamThinking: ResearchStreamThinking[];
  streamDocuments: Document[];
  streamTrace: ResearchStreamTrace[];
  streamAgentMessages: AgentMessage[];
  streamTokenUsage: TokenUsage | null;
  streamLiveTokenUsage: TokenUsage | null;
  isStreamTokenUsageEstimated: boolean;

  // Actions
  setQuery: (query: string) => void;
  setLoading: (isLoading: boolean) => void;
  setError: (error: string | null) => void;
  setResult: (result: ResearchResult | null) => void;
  resetStream: () => void;
  addStreamStatus: (status: ResearchStreamStatus) => void;
  addStreamThinking: (thinking: ResearchStreamThinking) => void;
  setStreamDocuments: (documents: Document[]) => void;
  addStreamTrace: (trace: ResearchStreamTrace) => void;
  addStreamAgentMessage: (message: AgentMessage) => void;
  setStreamTokenUsage: (usage: TokenUsage | null) => void;
  addEstimatedStreamTokenUsage: (text: string, direction: TokenUsageDirection) => void;
  reset: () => void;
}

export const useResearchStore = create<ResearchState>((set) => ({
  // Initial state
  query: '',
  isLoading: false,
  error: null,
  result: null,
  streamStatuses: [],
  streamThinking: [],
  streamDocuments: [],
  streamTrace: [],
  streamAgentMessages: [],
  streamTokenUsage: null,
  streamLiveTokenUsage: null,
  isStreamTokenUsageEstimated: false,

  // Actions
  setQuery: (query) => set({ query }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
  setResult: (result) => set({ result }),
  resetStream: () => set({
    streamStatuses: [],
    streamThinking: [],
    streamDocuments: [],
    streamTrace: [],
    streamAgentMessages: [],
    streamTokenUsage: null,
    streamLiveTokenUsage: null,
    isStreamTokenUsageEstimated: false,
  }),
  addStreamStatus: (status) => set((state) => ({
    streamStatuses: [...state.streamStatuses, status],
  })),
  addStreamThinking: (thinking) => set((state) => ({
    streamThinking: upsertThinking(state.streamThinking, thinking),
  })),
  setStreamDocuments: (documents) => set({ streamDocuments: documents }),
  addStreamTrace: (trace) => set((state) => ({
    streamTrace: [...state.streamTrace, trace],
  })),
  addStreamAgentMessage: (message) => set((state) => ({
    streamAgentMessages: [...state.streamAgentMessages, message],
  })),
  setStreamTokenUsage: (usage) => set({
    streamTokenUsage: usage,
    streamLiveTokenUsage: usage,
    isStreamTokenUsageEstimated: false,
  }),
  addEstimatedStreamTokenUsage: (text, direction) => set((state) => ({
    streamLiveTokenUsage: addEstimatedTokenUsageFromText(
      state.streamLiveTokenUsage ?? state.streamTokenUsage,
      text,
      direction,
    ),
    isStreamTokenUsageEstimated: true,
  })),
  reset: () => set({
    query: '',
    isLoading: false,
    error: null,
    result: null,
    streamStatuses: [],
    streamThinking: [],
    streamDocuments: [],
    streamTrace: [],
    streamAgentMessages: [],
    streamTokenUsage: null,
    streamLiveTokenUsage: null,
    isStreamTokenUsageEstimated: false,
  }),
}));

function getThinkingKey(thinking: ResearchStreamThinking) {
  return thinking.id ?? `${thinking.stage}:${thinking.label}`;
}

function upsertThinking(
  thinkingMessages: ResearchStreamThinking[],
  thinking: ResearchStreamThinking,
) {
  const key = getThinkingKey(thinking);
  const existingIndex = thinkingMessages.findIndex((message) => getThinkingKey(message) === key);

  if (existingIndex === -1) {
    return [...thinkingMessages, thinking];
  }

  return thinkingMessages.map((message, index) => (
    index === existingIndex ? thinking : message
  ));
}
