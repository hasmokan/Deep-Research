/**
 * Research state management with Zustand
 */

import { create } from 'zustand';
import type {
  Document,
  ResearchResult,
  ResearchStreamStatus,
  ResearchStreamThinking,
  ResearchStreamTrace,
} from '@/lib/api/types';

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

  // Actions
  setQuery: (query) => set({ query }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
  setResult: (result) => set({ result }),
  resetStream: () => set({ streamStatuses: [], streamThinking: [], streamDocuments: [], streamTrace: [] }),
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
  reset: () => set({
    query: '',
    isLoading: false,
    error: null,
    result: null,
    streamStatuses: [],
    streamThinking: [],
    streamDocuments: [],
    streamTrace: [],
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
