'use client';

import { CheckCircle2, Gauge, Sparkles } from 'lucide-react';
import { LoadingState, ResultsDisplay } from '@/components/research';
import { MarkdownContent } from '@/components/research/markdown-content';
import { ResearchPlanPanel } from '@/components/research/research-plan-panel';
import type { ConversationMessage } from '@/lib/research/conversation';
import { formatTokenCount, getVisibleTokenUsage } from '@/lib/research/token-usage';

export function UserBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[560px] rounded-[20px] bg-foreground px-4 py-3 text-sm leading-6 text-background">
        {content}
      </div>
    </div>
  );
}

export function ThinkingDots() {
  return (
    <div className="mx-auto flex w-full max-w-[640px] items-center gap-2 px-2 py-2 text-sm text-muted-foreground">
      <span className="relative flex h-5 w-5 items-center justify-center rounded-full border border-foreground/20 text-foreground">
        <Sparkles className="h-3.5 w-3.5" />
      </span>
      <span>Thinking</span>
      <span className="inline-flex items-center gap-1" aria-hidden="true">
        <span className="h-1 w-1 animate-agent-dot rounded-full bg-muted-foreground [animation-delay:0ms]" />
        <span className="h-1 w-1 animate-agent-dot rounded-full bg-muted-foreground [animation-delay:160ms]" />
        <span className="h-1 w-1 animate-agent-dot rounded-full bg-muted-foreground [animation-delay:320ms]" />
      </span>
    </div>
  );
}

function RollingTokenNumber({
  minWidthCh = 2.6,
  prefix = '',
  value,
}: {
  minWidthCh?: number;
  prefix?: string;
  value: number;
}) {
  const formatted = `${prefix}${formatTokenCount(value)}`;

  return (
    <span
      className="token-usage-number"
      style={{ minWidth: `${minWidthCh}ch` }}
      aria-label={formatted}
    >
      <span key={formatted} className="token-usage-number-current">
        {formatted}
      </span>
    </span>
  );
}

function ConversationTokenUsageBadge({ message }: { message: ConversationMessage }) {
  const visibleUsage = getVisibleTokenUsage(
    message.result?.token_usage ?? message.researchActivity?.tokenUsage,
    message.researchActivity?.liveTokenUsage,
  );

  if (!visibleUsage) {
    return null;
  }

  const { usage, isEstimated } = visibleUsage;
  const title = [
    `Input: ${formatTokenCount(usage.input_tokens)}`,
    `Output: ${formatTokenCount(usage.output_tokens)}`,
    `Total: ${formatTokenCount(usage.total_tokens)}`,
    isEstimated ? 'Estimated until provider usage arrives' : 'Provider usage',
  ].join(' / ');

  return (
    <div className="mt-1.5 ml-9 flex justify-start">
      <div
        aria-live="polite"
        aria-label={isEstimated ? 'Estimated token usage' : 'Token usage'}
        aria-atomic="false"
        title={title}
        className="inline-flex max-w-full items-center gap-1.5 text-[10px] leading-4 text-muted-foreground/65"
      >
        <Gauge className={`h-3 w-3 shrink-0 opacity-60 ${isEstimated ? 'animate-pulse' : ''}`} />
        <span className="font-medium text-muted-foreground/80">
          {isEstimated ? 'estimated' : 'tokens'}
        </span>
        <span className="font-mono text-foreground/70 tabular-nums">
          <RollingTokenNumber minWidthCh={5.4} prefix={isEstimated ? '~' : ''} value={usage.total_tokens} />
        </span>
        <span className="hidden text-muted-foreground/35 sm:inline">/</span>
        <span className="hidden items-center gap-1 sm:inline-flex">
          <span>in</span>
          <span className="font-mono text-foreground/60 tabular-nums">
            <RollingTokenNumber minWidthCh={4.6} value={usage.input_tokens} />
          </span>
          <span>out</span>
          <span className="font-mono text-foreground/60 tabular-nums">
            <RollingTokenNumber minWidthCh={4.6} value={usage.output_tokens} />
          </span>
        </span>
      </div>
    </div>
  );
}

export function AssistantResultMessage({ message }: { message: ConversationMessage }) {
  if (!message.result && !message.researchActivity && !message.researchPlan) {
    return null;
  }

  if (message.researchPlan) {
    return (
      <div className="mx-auto max-w-[680px]">
        <ResearchPlanPanel
          plan={message.researchPlan}
          activity={message.researchActivity}
        />
      </div>
    );
  }

  if (message.result?.result_type === 'answer') {
    return (
      <>
        {message.researchActivity && (
          <div className="mx-auto w-full max-w-[680px]">
            <LoadingState activity={message.researchActivity} />
          </div>
        )}

        <div className="mx-auto w-full max-w-[640px]">
          <div className="flex gap-3">
            <div className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
              <CheckCircle2 className="h-3.5 w-3.5" />
            </div>
            <article className="min-w-0 flex-1">
              <MarkdownContent
                content={message.result.answer || message.result.report || message.content}
                className="text-sm leading-6"
              />
            </article>
          </div>
          <ConversationTokenUsageBadge message={message} />
        </div>
      </>
    );
  }

  return (
    <>
      {message.researchActivity && (
        <div className="mx-auto w-full max-w-[720px]">
          <LoadingState activity={message.researchActivity} />
        </div>
      )}

      {message.result && (
        <>
          <div className="mx-auto w-full max-w-3xl xl:hidden">
            <ResultsDisplay result={message.result} />
          </div>

          <div className="mx-auto hidden w-full max-w-[620px] xl:block">
            <div className="rounded-[14px] border border-border bg-card p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">Research report generated</p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    I opened the full report in the artifact panel on the right. Continue asking follow-up questions here.
                  </p>
                </div>
              </div>
            </div>
            <ConversationTokenUsageBadge message={message} />
          </div>
        </>
      )}
      {!message.result && (
        <div className="mx-auto w-full max-w-[720px]">
          <ConversationTokenUsageBadge message={message} />
        </div>
      )}
    </>
  );
}
