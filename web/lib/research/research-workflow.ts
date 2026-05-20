import type {
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
  canSendFollowUp: boolean;
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
  documents?: Array<Document | ResearchStreamTraceDocument>;
}

export interface ResearchActivityStream {
  visibleEvents: ResearchActivityEvent[];
  hiddenEvents: ResearchActivityEvent[];
  hiddenCount: number;
  toggleLabel: 'More steps' | 'Less steps';
}

const DEFAULT_VISIBLE_AGENT_EVENTS = 2;
export const PLAN_FIRST_STEP_REVEAL_DELAY_MS = 120;
export const PLAN_STEP_REVEAL_INTERVAL_MS = 520;
const REPORT_ARTIFACT_DETAIL = 'Full report opened in the artifact panel. The chat timeline keeps the research steps, sources, status, and model thinking process.';
const DRAFT_CONTENT_DETAIL = 'Draft content is kept out of the chat timeline. The timeline keeps the research steps, sources, status, and model thinking process.';

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
  canSendFollowUp,
  isDeepResearchMode,
}: ResearchSubmitDecisionInput): ResearchSubmitAction {
  const hasQuery = query.trim().length > 0;

  if (!hasQuery && !hasPlan) {
    return 'none';
  }

  if (hasQuery && canSendFollowUp && !isDeepResearchMode) {
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

function getThinkingDetail(message: ResearchStreamThinking) {
  if (message.stage === 'report' && isLargeMarkdownDraft(message.label, message.text)) {
    return REPORT_ARTIFACT_DETAIL;
  }

  if (message.stage === 'analyze' && isLargeMarkdownDraft(message.label, message.text)) {
    return DRAFT_CONTENT_DETAIL;
  }

  return message.text;
}

function getTraceDetail(event: ResearchStreamTrace) {
  if (event.stage === 'report' && isLargeMarkdownDraft(event.title, event.detail)) {
    return REPORT_ARTIFACT_DETAIL;
  }

  if (event.stage === 'analyze' && isLargeMarkdownDraft(event.title, event.detail)) {
    return DRAFT_CONTENT_DETAIL;
  }

  return event.detail;
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
        events.push(thinkingEvent);
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
