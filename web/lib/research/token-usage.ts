import type { TokenUsage } from '@/lib/api/types';

export type TokenUsageDirection = 'input' | 'output';

export interface VisibleTokenUsage {
  usage: TokenUsage;
  isEstimated: boolean;
}

export function addTokenUsage(base: TokenUsage | null | undefined, delta: TokenUsage | null | undefined): TokenUsage {
  const baseUsage = normalizeTokenUsage(base);
  const deltaUsage = normalizeTokenUsage(delta);

  return {
    input_tokens: baseUsage.input_tokens + deltaUsage.input_tokens,
    output_tokens: baseUsage.output_tokens + deltaUsage.output_tokens,
    total_tokens: baseUsage.total_tokens + deltaUsage.total_tokens,
  };
}

export function addEstimatedTokenUsageFromText(
  base: TokenUsage | null | undefined,
  text: string,
  direction: TokenUsageDirection,
): TokenUsage {
  const estimatedTokens = estimateTokenCount(text);
  const delta = direction === 'input'
    ? { input_tokens: estimatedTokens, output_tokens: 0, total_tokens: estimatedTokens }
    : { input_tokens: 0, output_tokens: estimatedTokens, total_tokens: estimatedTokens };

  return addTokenUsage(base, delta);
}

export function getVisibleTokenUsage(
  realUsage: TokenUsage | null | undefined,
  liveUsage: TokenUsage | null | undefined,
): VisibleTokenUsage | null {
  const real = normalizeTokenUsage(realUsage);
  if (real.total_tokens > 0) {
    return { usage: real, isEstimated: false };
  }

  const live = normalizeTokenUsage(liveUsage);
  if (live.total_tokens > 0) {
    return { usage: live, isEstimated: true };
  }

  return null;
}

export function formatTokenCount(count: number) {
  if (count < 10_000) {
    return count.toLocaleString();
  }

  return `${(count / 1000).toFixed(1)}K`;
}

function normalizeTokenUsage(usage: TokenUsage | null | undefined): TokenUsage {
  return {
    input_tokens: Math.max(0, Math.trunc(usage?.input_tokens ?? 0)),
    output_tokens: Math.max(0, Math.trunc(usage?.output_tokens ?? 0)),
    total_tokens: Math.max(0, Math.trunc(usage?.total_tokens ?? 0)),
  };
}

function estimateTokenCount(text: string) {
  const normalizedText = text.trim();
  if (!normalizedText) {
    return 0;
  }

  let weightedCharacters = 0;
  for (const char of normalizedText) {
    weightedCharacters += /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(char) ? 1 : 0.25;
  }

  return Math.max(1, Math.ceil(weightedCharacters));
}
