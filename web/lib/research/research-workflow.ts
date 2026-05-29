import type {
  AgentMessage,
  AgentToolCall,
  Document,
  ResearchPlanResponse,
  ResearchStreamStatus,
  ResearchStreamThinking,
  ResearchStreamTrace,
  ResearchStreamTraceDocument,
} from '@/lib/api/types';

export interface ResearchPlanStep {
  id: string;
  title: string;
  detail: string;
}

export interface ResearchPlan {
  query: string;
  sourceLabel: string;
  summary: string;
  steps: ResearchPlanStep[];
  shouldPlan: boolean;
}

export type ResearchSubmitAction = 'none' | 'create-plan' | 'start-research';

export interface ResearchSubmitDecisionInput {
  query: string;
  hasPlan: boolean;
  isDeepResearchMode: boolean;
}

export interface ResearchPlanShellInput {
  isPlanning: boolean;
  hasPlan: boolean;
}

export interface ResearchActivityEvent {
  id: string;
  stage: ResearchStreamStatus['stage'] | ResearchStreamThinking['stage'] | ResearchStreamTrace['stage'];
  kind: 'status' | 'thinking' | 'sources' | ResearchStreamTrace['kind'];
  title: string;
  detail: string;
  agentRunId?: string;
  parentRunId?: string | null;
  agentPath?: string[];
  agentLabel?: string;
  agentDepth?: number;
  tool?: string;
  documents?: Array<Document | ResearchStreamTraceDocument>;
}

export interface ResearchActivityStream {
  visibleEvents: ResearchActivityEvent[];
  hiddenEvents: ResearchActivityEvent[];
  hiddenCount: number;
  toggleLabel: 'More steps' | 'Less steps';
}

export interface ResearchActivityTimelineInput {
  statuses: ResearchStreamStatus[];
  thinking: ResearchStreamThinking[];
  documents?: Document[];
  trace?: ResearchStreamTrace[];
  agentMessages?: AgentMessage[];
}

const DEFAULT_VISIBLE_AGENT_EVENTS = 2;
export const PLAN_FIRST_STEP_REVEAL_DELAY_MS = 120;
export const PLAN_STEP_REVEAL_INTERVAL_MS = 520;
const REPORT_ARTIFACT_DETAIL = 'Full report opens in the artifact panel when ready.';
const DRAFT_CONTENT_DETAIL = 'Drafting analysis from the collected evidence.';

export function getResearchQueryOverride(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function getRevealedPlanStepCount(
  totalSteps: number,
  elapsedMs: number,
  firstStepDelayMs: number = PLAN_FIRST_STEP_REVEAL_DELAY_MS,
  stepRevealIntervalMs: number = PLAN_STEP_REVEAL_INTERVAL_MS,
): number {
  if (totalSteps <= 0 || elapsedMs < firstStepDelayMs) {
    return 0;
  }

  const revealedSteps = Math.floor((elapsedMs - firstStepDelayMs) / stepRevealIntervalMs) + 1;
  return Math.min(totalSteps, revealedSteps);
}

export function shouldRenderResearchPlanShell({
  isPlanning,
  hasPlan,
}: ResearchPlanShellInput): boolean {
  return isPlanning || hasPlan;
}

export function createResearchPlan(query: string): ResearchPlan {
  const normalizedQuery = query.trim();

  return {
    query: normalizedQuery,
    sourceLabel: 'Public web',
    summary: `Research "${normalizedQuery}" across public web sources, compare evidence, and produce a cited report.`,
    shouldPlan: true,
    steps: [
      {
        id: 'clarify',
        title: 'Clarify the research objective',
        detail: 'Turn the prompt into a focused research route with scope, constraints, and expected output.',
      },
      {
        id: 'discover',
        title: 'Find relevant sources',
        detail: 'Search the public web for useful source material and collect candidates for review.',
      },
      {
        id: 'compare',
        title: 'Compare evidence',
        detail: 'Read across sources, identify agreement, tension, uncertainty, and useful details.',
      },
      {
        id: 'report',
        title: 'Write the final report',
        detail: 'Synthesize findings into a structured report with source references and a clear narrative.',
      },
    ],
  };
}

export function normalizeResearchPlan(response: ResearchPlanResponse): ResearchPlan {
  return {
    query: response.query,
    sourceLabel: response.source_label,
    summary: response.summary,
    shouldPlan: response.should_plan,
    steps: response.steps.map((step) => ({
      id: step.id,
      title: step.title,
      detail: step.detail,
    })),
  };
}

export function getResearchSubmitAction({
  query,
  hasPlan,
  isDeepResearchMode,
}: ResearchSubmitDecisionInput): ResearchSubmitAction {
  const hasQuery = query.trim().length > 0;

  if (!hasQuery && !hasPlan) {
    return 'none';
  }

  if (hasQuery && !isDeepResearchMode) {
    return 'start-research';
  }

  if (hasQuery) {
    return 'create-plan';
  }

  if (hasPlan) {
    return 'start-research';
  }

  return 'none';
}

function isLargeMarkdownDraft(title: string, detail: string) {
  const label = title.toLowerCase();
  const text = detail.trim();

  return (
    (label.includes('draft') || label.includes('report') || label.includes('analysis')) &&
    (
      text.startsWith('#') ||
      text.includes('\n## ') ||
      text.includes('\n|') ||
      text.length > 1200
    )
  );
}

function markdownDraftNotes(detail: string, fallback: string) {
  const text = detail.trim();
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const notes: string[] = [];

  for (const line of lines) {
    const heading = line.match(/^#{2,4}\s+(.+)/);
    if (heading?.[1]) {
      notes.push(`Structuring section: ${heading[1].replace(/\*\*/g, '').trim()}`);
      continue;
    }

    const bullet = line.match(/^[-*]\s+(.+)/);
    if (bullet?.[1]) {
      notes.push(bullet[1].replace(/\*\*/g, '').trim());
      continue;
    }

    if (notes.length >= 4) {
      break;
    }
  }

  const uniqueNotes = [...new Set(notes)]
    .map((note) => note.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 4);

  if (!uniqueNotes.length) {
    return fallback;
  }

  return uniqueNotes.map((note) => `• ${note}`).join('\n');
}

function getThinkingDetail(message: ResearchStreamThinking) {
  if (message.stage === 'report' && isLargeMarkdownDraft(message.label, message.text)) {
    return `${markdownDraftNotes(message.text, 'Synthesizing the final report.')}\n${REPORT_ARTIFACT_DETAIL}`;
  }

  if (message.stage === 'analyze' && isLargeMarkdownDraft(message.label, message.text)) {
    return markdownDraftNotes(message.text, DRAFT_CONTENT_DETAIL);
  }

  return message.text;
}

function getTraceDetail(event: ResearchStreamTrace) {
  if (event.stage === 'report' && isLargeMarkdownDraft(event.title, event.detail)) {
    return `${markdownDraftNotes(event.detail, 'Synthesizing the final report.')}\n${REPORT_ARTIFACT_DETAIL}`;
  }

  if (event.stage === 'analyze' && isLargeMarkdownDraft(event.title, event.detail)) {
    return markdownDraftNotes(event.detail, DRAFT_CONTENT_DETAIL);
  }

  return event.detail;
}

export function buildResearchActivityFromAgentMessages(messages: AgentMessage[]): ResearchActivityEvent[] {
  const events: ResearchActivityEvent[] = [];

  for (const message of messages) {
    if (message.type !== 'ai') {
      continue;
    }

    const reasoning = message.reasoning_content?.trim();
    if (reasoning) {
      events.push({
        id: message.id ? `${message.id}-reasoning` : `agent-reasoning-${events.length}`,
        stage: 'analyze',
        kind: 'thinking',
        title: 'Thinking',
        detail: reasoning,
      });
    }

    for (const toolCall of message.tool_calls ?? []) {
      const toolResult = findAgentToolResult(messages, toolCall.id);
      events.push({
        id: toolCall.id ? `${toolCall.id}-call` : `agent-tool-call-${events.length}`,
        stage: stageForAgentTool(toolCall.name),
        kind: 'tool_call',
        title: titleForAgentToolCall(toolCall.name),
        detail: detailForAgentToolCall(toolCall),
        tool: toolCall.name,
      });

      if (toolResult) {
        events.push({
          id: toolResult.id ? `${toolResult.id}-result` : `${toolCall.id ?? events.length}-result`,
          stage: stageForAgentTool(toolCall.name),
          kind: 'tool_result',
          title: titleForAgentToolResult(toolCall.name),
          detail: detailForAgentToolResult(toolCall.name, toolResult.content),
          tool: toolCall.name,
          documents: documentsForAgentToolResult(toolCall.name, toolResult.content),
        });
      }
    }
  }

  return events;
}

export function buildResearchActivityTimeline({
  statuses,
  thinking,
  documents = [],
  trace = [],
}: ResearchActivityTimelineInput): ResearchActivityEvent[] {
  return buildResearchActivity(statuses, thinking, documents, trace);
}

export function buildResearchActivity(
  statuses: ResearchStreamStatus[],
  thinking: ResearchStreamThinking[],
  documents: Document[] = [],
  trace: ResearchStreamTrace[] = [],
): ResearchActivityEvent[] {
  if (trace.length > 0) {
    const events: ResearchActivityEvent[] = trace.map((event) => ({
      id: event.id,
      stage: event.stage,
      kind: event.kind,
      title: event.title,
      detail: getTraceDetail(event),
      agentRunId: event.agent_run_id,
      parentRunId: event.parent_run_id,
      agentPath: event.agent_path,
      agentLabel: event.agent_label,
      agentDepth: event.agent_depth,
      tool: event.tool,
      documents: event.documents,
    }));

    thinking.forEach((message, index) => {
      const thinkingEvent: ResearchActivityEvent = {
        id: message.id ?? `thinking-${index}-${message.stage}`,
        stage: message.stage,
        kind: 'thinking',
        title: message.label,
        detail: getThinkingDetail(message),
      };
      const stageIndex = events.findLastIndex((event) => event.stage === message.stage);

      if (stageIndex >= 0) {
        events.splice(stageIndex + 1, 0, thinkingEvent);
      } else {
        const nextStageIndex = events.findIndex((event) => (
          executionStageRank(event.stage) > executionStageRank(message.stage)
        ));

        if (nextStageIndex >= 0) {
          events.splice(nextStageIndex, 0, thinkingEvent);
        } else {
          events.push(thinkingEvent);
        }
      }
    });

    return events;
  }

  const events: ResearchActivityEvent[] = [];
  let insertedDocuments = false;

  statuses.forEach((status, index) => {
    events.push({
      id: `status-${index}-${status.stage}`,
      stage: status.stage,
      kind: 'status' as const,
      title: status.label,
      detail: status.message,
    });

    if (!insertedDocuments && status.stage === 'search' && documents.length > 0) {
      insertedDocuments = true;
      events.push({
        id: 'documents-found',
        stage: 'search',
        kind: 'sources',
        title: 'Sources found',
        detail: `Found ${documents.length} source candidates from the web search.`,
        documents,
      });
    }
  });

  if (!insertedDocuments && documents.length > 0) {
    events.push({
      id: 'documents-found',
      stage: 'search',
      kind: 'sources',
      title: 'Sources found',
      detail: `Found ${documents.length} source candidates from the web search.`,
      documents,
    });
  }

  thinking.forEach((message, index) => {
    events.push({
      id: message.id ?? `thinking-${index}-${message.stage}`,
      stage: message.stage,
      kind: 'thinking' as const,
      title: message.label,
      detail: getThinkingDetail(message),
    });
  });

  return events;
}

function findAgentToolResult(messages: AgentMessage[], toolCallId?: string | null) {
  if (!toolCallId) {
    return undefined;
  }

  return messages.find((message): message is Extract<AgentMessage, { type: 'tool' }> => (
    message.type === 'tool' && message.tool_call_id === toolCallId
  ));
}

function stageForAgentTool(toolName: string): ResearchActivityEvent['stage'] {
  if (toolName === 'web_search') {
    return 'search';
  }
  if (toolName === 'ask_clarification') {
    return 'answer';
  }
  if (toolName.includes('file') || toolName.includes('dir') || toolName.includes('bash') || toolName.includes('python')) {
    return 'coding';
  }
  return 'analyze';
}

function titleForAgentToolCall(toolName: string) {
  const labels: Record<string, string> = {
    web_search: 'Search web',
    ask_clarification: 'Need your help',
    read_file: 'Read file',
    list_dir: 'List directory',
    bash: 'Execute command',
    run_python: 'Run Python',
    write_todos: 'Write to-dos',
  };

  return labels[toolName] ?? `Use ${toolName}`;
}

function titleForAgentToolResult(toolName: string) {
  if (toolName === 'web_search') {
    return 'Sources found';
  }
  if (toolName === 'ask_clarification') {
    return 'Clarification requested';
  }
  return 'Tool result';
}

function detailForAgentToolCall(toolCall: AgentToolCall) {
  if (toolCall.name === 'web_search' && typeof toolCall.args.query === 'string') {
    return toolCall.args.query;
  }
  if (toolCall.name === 'ask_clarification' && typeof toolCall.args.question === 'string') {
    return toolCall.args.question;
  }
  return JSON.stringify(toolCall.args);
}

function detailForAgentToolResult(toolName: string, content: string) {
  if (toolName === 'web_search') {
    const documents = documentsForAgentToolResult(toolName, content);
    return `Found ${documents.length} source candidate${documents.length === 1 ? '' : 's'}.`;
  }
  return content;
}

function documentsForAgentToolResult(toolName: string, content: string): ResearchStreamTraceDocument[] {
  if (toolName !== 'web_search') {
    return [];
  }

  try {
    const payload = JSON.parse(content);
    if (!Array.isArray(payload)) {
      return [];
    }

    return payload
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
      .map((item, index) => ({
        id: typeof item.id === 'string' || typeof item.id === 'number' ? item.id : `agent-web-${index}`,
        title: typeof item.title === 'string' ? item.title : `Source ${index + 1}`,
        url: typeof item.url === 'string' ? item.url : null,
        source: typeof item.source === 'string' ? item.source : null,
        provider: 'react',
        type: 'web_search',
      }));
  } catch {
    return [];
  }
}

export function buildResearchActivityStream(
  events: ResearchActivityEvent[],
  showOlderSteps: boolean,
  visibleCount: number = DEFAULT_VISIBLE_AGENT_EVENTS,
): ResearchActivityStream {
  const safeVisibleCount = Math.max(1, visibleCount);

  if (events.length <= safeVisibleCount) {
    return {
      visibleEvents: events,
      hiddenEvents: [],
      hiddenCount: 0,
      toggleLabel: showOlderSteps ? 'Less steps' : 'More steps',
    };
  }

  const hiddenEvents = events.slice(0, -safeVisibleCount);

  return {
    visibleEvents: showOlderSteps ? events : events.slice(-safeVisibleCount),
    hiddenEvents,
    hiddenCount: hiddenEvents.length,
    toggleLabel: showOlderSteps ? 'Less steps' : 'More steps',
  };
}

function executionStageRank(stage: ResearchActivityEvent['stage']) {
  const ranks: Record<string, number> = {
    route: 0,
    react: 1,
    answer: 2,
    coding: 2,
    search: 3,
    analyze: 4,
    report: 5,
  };

  return ranks[stage] ?? 99;
}
