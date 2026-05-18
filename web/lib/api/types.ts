/**
 * Type definitions for API requests and responses
 */

export interface ResearchRequest {
  query: string;
  thread_id?: string;
  messages?: ResearchRequestMessage[];
  latest_result?: ResearchResult | null;
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
  answer?: string | null;
  result_type?: 'report' | 'answer';
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
  user_id?: string;
  run_id: string;
  query: string;
  status: string;
  created_at: string;
  updated_at: string;
  events: ResearchRunEvent[];
}

export interface ResearchThread {
  user_id?: string;
  thread_id: string;
  title: string;
  messages: unknown[];
  created_at: string;
  updated_at: string;
}

export interface ResearchThreadUpdate {
  title: string;
  messages: unknown[];
}

export interface ResearchStreamMetadata {
  run_id: string;
}

export interface ResearchPlanStreamStatus {
  stage: 'plan';
  label: string;
  message: string;
}

export interface ResearchPlanStreamHandlers {
  onStatus?: (status: ResearchPlanStreamStatus) => void;
  onPlan?: (plan: ResearchPlanResponse) => void;
  signal?: AbortSignal;
}

export interface ResearchStreamStatus {
  stage: 'route' | 'answer' | 'coding' | 'search' | 'analyze' | 'report';
  label: string;
  message: string;
}

export interface ResearchStreamThinking {
  id?: string;
  stage: 'answer' | 'coding' | 'analyze' | 'report';
  label: string;
  text: string;
}

export interface ResearchStreamTraceDocument {
  id?: string | number | null;
  title?: string | null;
  url?: string | null;
  source?: string | null;
  provider?: string | null;
  type?: string | null;
}

export interface ResearchStreamTrace {
  id: string;
  stage: 'route' | 'answer' | 'coding' | 'search' | 'analyze' | 'report';
  kind: 'tool_call' | 'tool_result' | 'reasoning';
  title: string;
  detail: string;
  tool?: string;
  query?: string;
  documents?: ResearchStreamTraceDocument[];
}

export interface ResearchStreamHandlers {
  onMetadata?: (metadata: ResearchStreamMetadata) => void;
  onStatus?: (status: ResearchStreamStatus) => void;
  onTrace?: (trace: ResearchStreamTrace) => void;
  onDocuments?: (documents: Document[]) => void;
  onThinking?: (thinking: ResearchStreamThinking) => void;
  onAnalysis?: (analysis: string | null) => void;
  onReport?: (report: string | null) => void;
  onAnswerDelta?: (delta: string) => void;
  onAnswer?: (answer: string | null) => void;
  signal?: AbortSignal;
}

export interface ResearchRunStreamHandlers extends ResearchStreamHandlers {
  afterSeq?: number;
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
