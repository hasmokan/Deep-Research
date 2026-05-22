import type { ResearchResult } from '@/lib/api/types';
import type { ConversationMessage } from './conversation';

export function isReportResult(result: ResearchResult | null | undefined): result is ResearchResult {
  return Boolean(result && result.result_type !== 'answer');
}

export function getLatestArtifactResult(messages: ConversationMessage[]) {
  return [...messages]
    .reverse()
    .find((message) => isReportResult(message.result))
    ?.result ?? null;
}
