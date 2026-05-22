/**
 * Type definitions for API requests and responses
 */

export interface ResearchRequest {
  query: string;
  execution_mode?: 'auto' | 'react' | 'report';
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

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
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
  token_usage?: TokenUsage | null;
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
  trace_id?: string | null;
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

export interface AgentSkill {
  name: string;
  description: string;
  content: string;
  allowed_tools: string[];
  enabled: boolean;
}

export interface AgentSkillUpsertRequest {
  description: string;
  content: string;
  allowed_tools: string[];
  enabled?: boolean | null;
}

export interface ResearchStreamMetadata {
  run_id: string;
  trace_id?: string | null;
}

export interface ClientErrorLogRequest {
  message: string;
  source?: string;
  level?: 'info' | 'warning' | 'error';
  url?: string | null;
  user_agent?: string | null;
  request_id?: string | null;
  run_id?: string | null;
  context?: Record<string, unknown>;
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
  stage: 'route' | 'react' | 'answer' | 'coding' | 'search' | 'analyze' | 'report';
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
  stage: 'route' | 'react' | 'answer' | 'coding' | 'search' | 'analyze' | 'report';
  kind: 'tool_call' | 'tool_result' | 'reasoning';
  title: string;
  detail: string;
  tool?: string;
  query?: string;
  documents?: ResearchStreamTraceDocument[];
}

export interface AgentToolCall {
  id?: string | null;
  name: string;
  args: Record<string, unknown>;
}

export type AgentMessage =
  | {
      type: 'ai';
      id?: string | null;
      content: string;
      reasoning_content?: string | null;
      tool_calls?: AgentToolCall[];
      usage_metadata?: TokenUsage | null;
    }
  | {
      type: 'tool';
      id?: string | null;
      tool_call_id: string;
      name: string;
      content: string;
    };

export interface ResearchStreamHandlers {
  onMetadata?: (metadata: ResearchStreamMetadata) => void;
  onStatus?: (status: ResearchStreamStatus) => void;
  onTrace?: (trace: ResearchStreamTrace) => void;
  onAgentMessage?: (message: AgentMessage) => void;
  onDocuments?: (documents: Document[]) => void;
  onThinking?: (thinking: ResearchStreamThinking) => void;
  onAnalysis?: (analysis: string | null) => void;
  onReport?: (report: string | null) => void;
  onAnswerDelta?: (delta: string) => void;
  onAnswer?: (answer: string | null) => void;
  onTokenUsage?: (usage: TokenUsage) => void;
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
