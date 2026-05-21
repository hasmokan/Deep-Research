'use client';

/**
 * Reviewable research plan shown before a deep research run starts.
 */

import { useEffect, useState } from 'react';
import { CheckCircle2, Globe2, ListChecks, Loader2, Pencil, Play, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LoadingState } from './loading-state';
import type { ConversationResearchActivity } from '@/lib/research/conversation';
import {
  getRevealedPlanStepCount,
  type ResearchPlan,
  type ResearchPlanStep,
} from '@/lib/research/research-workflow';
import { TYPEWRITER_INTERVAL_MS, TYPEWRITER_STEP, useTypewriterText } from '@/lib/research/typewriter';

interface ResearchPlanPanelProps {
  plan: ResearchPlan | null;
  activity?: ConversationResearchActivity;
  isLoading?: boolean;
  isStreaming?: boolean;
  revealSteps?: boolean;
  onRevealComplete?: () => void;
  onEdit?: () => void;
  onCancel?: () => void;
  onStart?: () => void;
}

interface ResearchPlanStepRowProps {
  step: ResearchPlanStep;
  index: number;
  shouldAnimateText: boolean;
  showSpinner: boolean;
}

const PLAN_REVEAL_TICK_MS = 50;
const PLAN_REVEAL_SETTLE_MS = 180;

function TypewriterCursor() {
  return (
    <span className="ml-0.5 inline-block h-4 w-px translate-y-0.5 animate-agent-cursor bg-foreground/70" />
  );
}

function getTypewriterDurationMs(text: string) {
  return Math.ceil(text.length / TYPEWRITER_STEP) * TYPEWRITER_INTERVAL_MS;
}

function ResearchPlanStepRow({
  step,
  index,
  shouldAnimateText,
  showSpinner,
}: ResearchPlanStepRowProps) {
  const detail = useTypewriterText(step.detail, shouldAnimateText);
  const showCursor = shouldAnimateText && detail.length < step.detail.length;
  const stepNumber = String(index + 1).padStart(2, '0');

  return (
    <li className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3 border-t border-border/70 py-3 first:border-t-0">
      <div className="pt-0.5">
        <div
          className={`
            flex h-7 w-7 items-center justify-center rounded-[7px] border text-[11px] font-semibold leading-none tabular-nums
            ${showSpinner
              ? 'border-foreground/35 bg-background text-foreground'
              : 'border-border bg-muted/70 text-muted-foreground'}
          `}
        >
          <span className="sr-only">{index + 1}</span>
          {showSpinner ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            stepNumber
          )}
        </div>
      </div>
      <div className="min-w-0">
        <div className="flex min-w-0 items-start gap-2">
          <p className="min-w-0 break-words text-sm font-semibold leading-5 text-foreground">
            {step.title}
          </p>
          {!showSpinner && (
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/80" />
          )}
        </div>
        <p className="mt-1 max-w-[62ch] break-words text-sm leading-6 text-muted-foreground">
          {detail}
          {showCursor && <TypewriterCursor />}
        </p>
      </div>
    </li>
  );
}

export function ResearchPlanPanel({
  plan,
  activity,
  isLoading = false,
  isStreaming = false,
  revealSteps = false,
  onRevealComplete,
  onEdit,
  onCancel,
  onStart,
}: ResearchPlanPanelProps) {
  const planSteps = plan?.steps ?? [];
  const summary = useTypewriterText(plan?.summary ?? '', Boolean(plan && isStreaming));
  const showSummaryCursor = Boolean(plan && isStreaming && summary.length < plan.summary.length);
  const [revealElapsedMs, setRevealElapsedMs] = useState(0);
  const revealKey = plan
    ? `${plan.query}-${plan.steps.map((step) => `${step.id}:${step.title}:${step.detail}`).join('|')}`
    : 'planning-shell';
  const revealedStepCount = revealSteps
    ? getRevealedPlanStepCount(planSteps.length, revealElapsedMs)
    : planSteps.length;
  const visibleSteps = revealSteps
    ? planSteps.slice(0, revealedStepCount)
    : planSteps;
  const lastVisibleStepIndex = visibleSteps.length - 1;
  const finalStepDetail = planSteps.at(-1)?.detail ?? '';
  const revealCompletionDelayMs = getTypewriterDurationMs(finalStepDetail) + PLAN_REVEAL_SETTLE_MS;

  useEffect(() => {
    if (!plan || !revealSteps) {
      return;
    }

    const startedAt = window.performance.now();
    const timer = window.setInterval(() => {
      setRevealElapsedMs(window.performance.now() - startedAt);
    }, PLAN_REVEAL_TICK_MS);

    return () => window.clearInterval(timer);
  }, [plan, revealKey, revealSteps]);

  useEffect(() => {
    if (!plan || !revealSteps || revealedStepCount < planSteps.length) {
      return;
    }

    const timer = window.setTimeout(() => {
      onRevealComplete?.();
    }, revealCompletionDelayMs);

    return () => window.clearTimeout(timer);
  }, [onRevealComplete, plan, planSteps.length, revealCompletionDelayMs, revealSteps, revealedStepCount]);

  return (
    <section className="overflow-hidden rounded-[12px] border border-border bg-card shadow-[0_14px_44px_rgba(0,0,0,0.08)] dark:shadow-[0_14px_44px_rgba(0,0,0,0.26)]">
      <div className="border-b border-border/70 px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] border border-border bg-background text-foreground">
              <ListChecks className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-lg font-semibold leading-6 text-foreground">Research plan</h3>
              {plan ? (
                <p className="mt-1.5 max-w-[62ch] break-words text-sm leading-6 text-muted-foreground">
                  {summary}
                  {showSummaryCursor && <TypewriterCursor />}
                </p>
              ) : (
                <div className="mt-3 max-w-2xl space-y-2">
                  <div className="h-3 w-[min(32rem,78vw)] max-w-full animate-pulse rounded-full bg-muted" />
                  <div className="h-3 w-[min(22rem,62vw)] max-w-full animate-pulse rounded-full bg-muted/75" />
                </div>
              )}
            </div>
          </div>
          <div className="inline-flex h-8 w-fit shrink-0 items-center gap-2 rounded-[8px] border border-border bg-background px-2.5 text-xs font-medium text-muted-foreground">
            <Globe2 className="h-3.5 w-3.5" />
            <span className="max-w-[11rem] truncate">{plan?.sourceLabel ?? 'Public web'}</span>
          </div>
        </div>
      </div>

      <div className="px-4 py-2 sm:px-5">
        {visibleSteps.length > 0 && (
          <ol>
            {visibleSteps.map((step, index) => (
              <ResearchPlanStepRow
                key={step.id}
                step={step}
                index={index}
                shouldAnimateText={isStreaming}
                showSpinner={isStreaming && index === lastVisibleStepIndex}
              />
            ))}
          </ol>
        )}

        {!plan && (
          <div className="space-y-3 py-3">
            {[0, 1, 2, 3].map((item) => (
              <div key={item} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3">
                <div className="h-7 w-7 animate-pulse rounded-[7px] bg-muted" />
                <div className="space-y-2 pt-0.5">
                  <div className="h-3 w-[min(18rem,70vw)] max-w-full animate-pulse rounded-full bg-muted" />
                  <div className="h-3 w-full max-w-[34rem] animate-pulse rounded-full bg-muted/75" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {activity && (
        <div className="border-t border-border/70 px-4 py-4 sm:px-5">
          <LoadingState activity={activity} />
        </div>
      )}

      {(onEdit || onCancel || onStart) && (
        <div className="flex flex-col gap-2 border-t border-border/70 bg-muted/25 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          {onEdit ? (
            <Button
              type="button"
              variant="ghost"
              onClick={onEdit}
              disabled={isLoading}
              className="h-9 justify-start rounded-[8px] px-3 text-muted-foreground hover:text-foreground"
            >
              <Pencil className="h-4 w-4" />
              Edit
            </Button>
          ) : (
            <span aria-hidden="true" />
          )}
          <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
            {onCancel && (
              <Button
                type="button"
                variant="outline"
                onClick={onCancel}
                disabled={isLoading}
                className="h-9 rounded-[8px] px-3"
              >
                <X className="h-4 w-4" />
                Cancel
              </Button>
            )}
            {onStart && (
              <Button
                type="button"
                onClick={onStart}
                disabled={isLoading}
                className="h-9 rounded-[8px] bg-foreground px-4 text-background hover:bg-foreground/90"
              >
                <Play className="h-4 w-4 fill-current" />
                Start
              </Button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
