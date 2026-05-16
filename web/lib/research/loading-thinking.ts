export type LoadingThinkingStage = 'search' | 'read' | 'analyze' | 'report';

export interface LoadingThinkingMessage {
  stage: LoadingThinkingStage;
  label: string;
  text: string;
}

export const loadingThinkingMessages: LoadingThinkingMessage[] = [
  {
    stage: 'search',
    label: 'Searching',
    text: 'Looking across available sources for useful signals and context.',
  },
  {
    stage: 'read',
    label: 'Reading',
    text: 'Reading the strongest matches and separating evidence from noise.',
  },
  {
    stage: 'analyze',
    label: 'Thinking',
    text: 'Comparing patterns, contradictions, and gaps before drafting.',
  },
  {
    stage: 'report',
    label: 'Writing',
    text: 'Turning the analysis into a clear research report for review.',
  },
];

export function getLoadingThinkingMessage(index: number): LoadingThinkingMessage {
  const safeIndex = Math.abs(index) % loadingThinkingMessages.length;
  return loadingThinkingMessages[safeIndex];
}
