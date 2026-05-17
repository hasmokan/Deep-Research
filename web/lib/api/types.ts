/**
 * Type definitions for API requests and responses
 */

export interface ResearchRequest {
  query: string;
  thread_id?: string;
  messages?: ResearchRequestMessage[];
}

export interface ResearchRequestMessage {
  role: 'user' | 'assistant';
  content: string;
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
  should_plan: boolean;
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

export interface ResearchRunEvent {
  run_id: string;
  event: string;
  data: Record<string, unknown>;
  seq: number;
  created_at: string;
}

export interface ResearchRun {
  run_id: string;
  query: string;
  status: string;
  created_at: string;
  updated_at: string;
  events: ResearchRunEvent[];
}

export interface ResearchThread {
  thread_id: string;
  title: string;
  messages: unknown[];
  created_at: string;
  updated_at: string;
}

export interface ResearchThreadUpdate {
  title: string;
  messages: Record<string, unknown>[];
}

export interface ResearchStreamMetadata {
  run_id: string;
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
  onMetadata?: (metadata: ResearchStreamMetadata) => void;
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
