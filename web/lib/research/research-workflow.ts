import type {
  ResearchPlanResponse,
  ResearchStreamStatus,
  ResearchStreamThinking,
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
}

export interface ResearchActivityEvent {
  id: string;
  stage: ResearchStreamStatus['stage'] | ResearchStreamThinking['stage'];
  kind: 'status' | 'thinking';
  title: string;
  detail: string;
}

export function createResearchPlan(query: string): ResearchPlan {
  const normalizedQuery = query.trim();

  return {
    query: normalizedQuery,
    sourceLabel: 'Public web',
    summary: `Research "${normalizedQuery}" across public web sources, compare evidence, and produce a cited report.`,
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
    steps: response.steps.map((step) => ({
      id: step.id,
      title: step.title,
      detail: step.detail,
    })),
  };
}

export function buildResearchActivity(
  statuses: ResearchStreamStatus[],
  thinking: ResearchStreamThinking[],
): ResearchActivityEvent[] {
  return [
    ...statuses.map((status, index) => ({
      id: `status-${index}-${status.stage}`,
      stage: status.stage,
      kind: 'status' as const,
      title: status.label,
      detail: status.message,
    })),
    ...thinking.map((message, index) => ({
      id: `thinking-${index}-${message.stage}`,
      stage: message.stage,
      kind: 'thinking' as const,
      title: message.label,
      detail: message.text,
    })),
  ];
}
