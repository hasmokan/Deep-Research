'use client';

/**
 * Reviewable research plan shown before a deep research run starts.
 */

import { useEffect, useState } from 'react';
import { CheckCircle2, Globe2, ListChecks, Loader2 } from 'lucide-react';
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
  isLast: boolean;
  shouldAnimateText: boolean;
  showSpinner: boolean;
}

const PLAN_REVEAL_TICK_MS = 50;
const PLAN_REVEAL_SETTLE_MS = 180;
const PLAN_SKELETON_ROWS = 4;

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
  isLast,
  shouldAnimateText,
  showSpinner,
}: ResearchPlanStepRowProps) {
  const detail = useTypewriterText(step.detail, shouldAnimateText);
  const showCursor = shouldAnimateText && detail.length < step.detail.length;

  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div
          className={`
            flex h-5 w-5 items-center justify-center rounded-full border bg-background
            ${showSpinner
              ? 'border-foreground/35 text-foreground'
              : 'border-dashed border-muted-foreground/45 text-muted-foreground'}
          `}
        >
          <span className="sr-only">{index + 1}</span>
          {showSpinner ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : null}
        </div>
        {!isLast && (
          <div className="my-1 h-full min-h-6 w-px bg-border" />
        )}
      </div>
      <div className="min-w-0 pb-2">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground" />
          <p className="text-base font-medium text-foreground">{step.title}</p>
        </div>
        <p className="mt-1 text-base leading-7 text-muted-foreground">
          {detail}
          {showCursor && <TypewriterCursor />}
        </p>
      </div>
    </div>
  );
}

function PlanPanelSkeleton() {
  return (
    <div className="grid gap-4" aria-label="Preparing research plan">
      {Array.from({ length: PLAN_SKELETON_ROWS }).map((_, index) => (
        <div key={index} className="flex gap-3">
          <div className="flex flex-col items-center">
            <div className="h-5 w-5 rounded-full border border-dashed border-muted-foreground/30 bg-background" />
            {index < PLAN_SKELETON_ROWS - 1 && (
              <div className="my-1 h-full min-h-6 w-px bg-border" />
            )}
          </div>
          <div className="min-w-0 flex-1 pb-2">
            <div className="mt-0.5 h-4 w-44 max-w-[58%] animate-pulse rounded-full bg-muted" />
            <div className="mt-3 h-3.5 w-full max-w-[92%] animate-pulse rounded-full bg-muted/80" />
            <div className="mt-2 h-3.5 w-2/3 animate-pulse rounded-full bg-muted/70" />
          </div>
        </div>
      ))}
    </div>
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
    <div className="rounded-[18px] border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-col gap-3 pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <ListChecks className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-xl font-semibold text-foreground">Research plan</h3>
            {plan ? (
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                {summary}
                {showSummaryCursor && <TypewriterCursor />}
              </p>
            ) : (
              <div className="mt-3 max-w-2xl space-y-2">
                <div className="h-3.5 w-[min(34rem,80vw)] max-w-full animate-pulse rounded-full bg-muted" />
                <div className="h-3.5 w-[min(24rem,64vw)] max-w-full animate-pulse rounded-full bg-muted/75" />
              </div>
            )}
          </div>
        </div>
        <div className="inline-flex w-fit items-center gap-2 rounded-full border border-border bg-background px-2.5 py-1.5 text-xs text-muted-foreground">
          <Globe2 className="h-3.5 w-3.5" />
          {plan?.sourceLabel ?? 'Public web'}
        </div>
      </div>

      {visibleSteps.length > 0 ? (
        <div className="grid gap-4">
          {visibleSteps.map((step, index) => (
            <ResearchPlanStepRow
              key={step.id}
              step={step}
              index={index}
              isLast={index === visibleSteps.length - 1}
              shouldAnimateText={isStreaming}
              showSpinner={isStreaming && index === lastVisibleStepIndex}
            />
          ))}
        </div>
      ) : (
        <PlanPanelSkeleton />
      )}

      {activity && (
        <div className="mt-5 border-t border-border/70 pt-5">
          <LoadingState activity={activity} />
        </div>
      )}

      {(onEdit || onCancel || onStart) && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onEdit}
            disabled={isLoading}
            className="rounded-full px-4"
          >
            Edit
          </Button>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={isLoading}
              className="rounded-full px-4"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={onStart}
              disabled={isLoading}
              className="rounded-full bg-foreground px-5 text-background hover:bg-foreground/90"
            >
              Start
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
