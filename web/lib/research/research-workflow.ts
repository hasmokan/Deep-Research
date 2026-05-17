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

export function getResearchQueryOverride(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
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
      detail: event.detail,
      documents: event.documents,
    }));

    thinking.forEach((message, index) => {
      const thinkingEvent: ResearchActivityEvent = {
        id: `thinking-${index}-${message.stage}`,
        stage: message.stage,
        kind: 'thinking',
        title: message.label,
        detail: message.text,
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
      id: `thinking-${index}-${message.stage}`,
      stage: message.stage,
      kind: 'thinking' as const,
      title: message.label,
      detail: message.text,
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
