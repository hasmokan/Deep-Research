'use client';

/**
 * Reviewable research plan shown before a deep research run starts.
 */

import { CheckCircle2, Globe2, ListChecks } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LoadingState } from './loading-state';
import type { ConversationResearchActivity } from '@/lib/research/conversation';
import type { ResearchPlan } from '@/lib/research/research-workflow';

interface ResearchPlanPanelProps {
  plan: ResearchPlan;
  activity?: ConversationResearchActivity;
  isLoading?: boolean;
  onEdit?: () => void;
  onCancel?: () => void;
  onStart?: () => void;
}

export function ResearchPlanPanel({
  plan,
  activity,
  isLoading = false,
  onEdit,
  onCancel,
  onStart,
}: ResearchPlanPanelProps) {
  return (
    <div className="rounded-[18px] border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-col gap-3 pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <ListChecks className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-xl font-semibold text-foreground">Research plan</h3>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              {plan.summary}
            </p>
          </div>
        </div>
        <div className="inline-flex w-fit items-center gap-2 rounded-full border border-border bg-background px-2.5 py-1.5 text-xs text-muted-foreground">
          <Globe2 className="h-3.5 w-3.5" />
          {plan.sourceLabel}
        </div>
      </div>

      <div className="grid gap-4">
        {plan.steps.map((step, index) => (
          <div key={step.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div className="flex h-5 w-5 items-center justify-center rounded-full border border-dashed border-muted-foreground/45 bg-background">
                <span className="sr-only">{index + 1}</span>
              </div>
              {index < plan.steps.length - 1 && (
                <div className="my-1 h-full min-h-6 w-px bg-border" />
              )}
            </div>
            <div className="pb-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground" />
                <p className="text-base font-medium text-foreground">{step.title}</p>
              </div>
              <p className="mt-1 text-base leading-7 text-muted-foreground">
                {step.detail}
              </p>
            </div>
          </div>
        ))}
      </div>

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
