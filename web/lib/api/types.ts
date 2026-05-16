/**
 * Type definitions for API requests and responses
 */

export interface ResearchRequest {
  query: string;
}

export interface ResearchResponse {
  id: string;
  query: string;
  status: string;
  documents_count: number;
  created_at: string;
}

export interface ResearchPlanStepResponse {
  id: string;
  title: string;
  detail: string;
}

export interface ResearchPlanResponse {
  query: string;
  source_label: string;
  summary: string;
  steps: ResearchPlanStepResponse[];
}

export interface ResearchResult {
  query: string;
  documents: Document[];
  analysis: string | null;
  analysis_thinking?: string | null;
  report: string | null;
  report_thinking?: string | null;
  status: string;
}

export interface ResearchStreamStatus {
  stage: 'search' | 'analyze' | 'report';
  label: string;
  message: string;
}

export interface ResearchStreamThinking {
  stage: 'analyze' | 'report';
  label: string;
  text: string;
}

export interface ResearchStreamHandlers {
  onStatus?: (status: ResearchStreamStatus) => void;
  onDocuments?: (documents: Document[]) => void;
  onThinking?: (thinking: ResearchStreamThinking) => void;
  onAnalysis?: (analysis: string | null) => void;
  onReport?: (report: string | null) => void;
  signal?: AbortSignal;
}

export interface Document {
  id: number;
  content: string;
  metadata: Record<string, unknown>;
  similarity?: number;
}

export interface ApiError {
  detail: string;
}
