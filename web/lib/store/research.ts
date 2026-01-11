/**
 * Research state management with Zustand
 */

import { create } from 'zustand';
import type { ResearchResult } from '@/lib/api/types';

interface ResearchState {
  // State
  query: string;
  isLoading: boolean;
  error: string | null;
  result: ResearchResult | null;

  // Actions
  setQuery: (query: string) => void;
  setLoading: (isLoading: boolean) => void;
  setError: (error: string | null) => void;
  setResult: (result: ResearchResult | null) => void;
  reset: () => void;
}

export const useResearchStore = create<ResearchState>((set) => ({
  // Initial state
  query: '',
  isLoading: false,
  error: null,
  result: null,

  // Actions
  setQuery: (query) => set({ query }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
  setResult: (result) => set({ result }),
  reset: () => set({ query: '', isLoading: false, error: null, result: null }),
}));
