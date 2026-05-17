'use client';

/**
 * Loading state component with live thinking progress and research steps
 */

import { useEffect, useState } from 'react';
import { Activity, Brain, CheckCircle2, Circle, FileSearch, FileText, Sparkles } from 'lucide-react';
import { loadingThinkingMessages } from '@/lib/research/loading-thinking';
import { buildResearchActivity } from '@/lib/research/research-workflow';
import { useResearchStore } from '@/lib/store/research';
import type { ResearchStreamStatus } from '@/lib/api/types';
import type { ConversationResearchActivity, ResearchActivityStatus } from '@/lib/research/conversation';

type LoadingStatus = 'pending' | 'active' | 'completed';

interface LoadingStep {
  id: string;
  label: string;
  icon: React.ReactNode;
}

interface LoadingStateProps {
  activity?: ConversationResearchActivity;
}

const loadingSteps: LoadingStep[] = [
  {
    id: 'search',
    label: 'Searching web',
    icon: <FileSearch className="h-4 w-4" />,
  },
  {
    id: 'analyze',
    label: 'Reading sources',
    icon: <Brain className="h-4 w-4" />,
  },
  {
    id: 'report',
    label: 'Drafting report',
    icon: <FileText className="h-4 w-4" />,
  },
];

function getLoadingStatus(index: number, activeIndex: number): LoadingStatus {
  if (index < activeIndex) {
    return 'completed';
  }
  if (index === activeIndex) {
    return 'active';
  }
  return 'pending';
}

function getStreamStepIndex(statuses: ResearchStreamStatus[]) {
  const latestStage = statuses.at(-1)?.stage;

  if (latestStage === 'analyze') {
    return 1;
  }
  if (latestStage === 'report') {
    return 2;
  }
  return 0;
}

function getTitle(status: ResearchActivityStatus) {
  if (status === 'completed') {
    return 'Research trace';
  }
  if (status === 'failed') {
    return 'Research interrupted';
  }
  if (status === 'stopped') {
    return 'Research stopped';
  }
  return 'Researching';
}

function getBadgeLabel(status: ResearchActivityStatus) {
  if (status === 'completed') {
    return 'Saved trace';
  }
  if (status === 'failed') {
    return 'Needs retry';
  }
  if (status === 'stopped') {
    return 'Stopped';
  }
  return 'Live stream';
}

function getStepDisplayStatus(
  index: number,
  activeIndex: number,
  activityStatus: ResearchActivityStatus,
): LoadingStatus {
  if (activityStatus === 'completed') {
    return 'completed';
  }

  return getLoadingStatus(index, activeIndex);
}

function getActivityDisplayStatus(
  index: number,
  activeIndex: number,
  activityStatus: ResearchActivityStatus,
): LoadingStatus {
  if (activityStatus === 'completed') {
    return 'completed';
  }
  if (activityStatus === 'failed' || activityStatus === 'stopped') {
    return index < activeIndex ? 'completed' : getLoadingStatus(index, activeIndex);
  }

  return getLoadingStatus(index, activeIndex);
}

export function LoadingState({ activity }: LoadingStateProps = {}) {
  const store = useResearchStore();
  const [tick, setTick] = useState(0);
  const streamStatuses = activity?.streamStatuses ?? store.streamStatuses;
  const streamThinking = activity?.streamThinking ?? store.streamThinking;
  const activityStatus = activity?.status ?? 'running';
  const streamActivity = buildResearchActivity(streamStatuses, streamThinking);
  const hasStreamActivity = streamActivity.length > 0;
  const fallbackActivity = loadingThinkingMessages.map((message) => ({
    id: message.stage,
    stage: message.stage,
    kind: 'status' as const,
    title: message.label,
    detail: message.text,
  }));
  const displayActivity = hasStreamActivity ? streamActivity : fallbackActivity;
  const visibleActivity = displayActivity.slice(-6);
  const visibleOffset = displayActivity.length - visibleActivity.length;
  const activeActivityIndex = hasStreamActivity
    ? streamActivity.length - 1
    : Math.min(tick, loadingThinkingMessages.length - 1);
  const activeStepIndex = hasStreamActivity
    ? getStreamStepIndex(streamStatuses)
    : Math.min(Math.floor(tick / 2), loadingSteps.length - 1);

  useEffect(() => {
    if (activityStatus !== 'running') {
      return undefined;
    }

    const interval = window.setInterval(() => {
      setTick((currentTick) => currentTick + 1);
    }, 1800);

    return () => window.clearInterval(interval);
  }, [activityStatus]);

  return (
    <div className="glass-strong shadow-premium rounded-[8px] p-4 md:p-6">
      <div className="space-y-6">
        <div className="flex flex-col gap-4 border-b border-border/70 pb-5 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-[7px] bg-primary text-primary-foreground">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-foreground">
                {getTitle(activityStatus)}
              </h3>
              <p className="text-sm text-muted-foreground">
                {activity?.query
                  ? `Query: ${activity.query}`
                  : 'The agent is searching, reading, and building a report you can review.'}
              </p>
            </div>
          </div>
          <div className="inline-flex w-fit items-center gap-2 rounded-[7px] border border-border bg-background/70 px-3 py-2 text-xs font-medium text-muted-foreground">
            <Activity className="h-3.5 w-3.5" />
            {getBadgeLabel(activityStatus)}
          </div>
        </div>

        <div className="overflow-x-auto pb-1">
          <div className="flex min-w-[620px] items-center gap-3">
            {loadingSteps.map((step, index) => {
              const status = getStepDisplayStatus(index, activeStepIndex, activityStatus);

              return (
                <div key={step.id} className="flex flex-1 items-center">
                  <div
                    className={`
                      flex min-w-0 flex-1 items-center gap-3 rounded-[8px] border px-3 py-3 transition-smooth
                      ${status === 'completed'
                        ? 'border-foreground/15 bg-foreground text-background'
                        : status === 'active'
                        ? 'thinking-scan border-foreground/20 bg-foreground/5 text-foreground'
                        : 'border-border/70 bg-muted/60 text-muted-foreground'
                      }
                    `}
                  >
                    <div className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] bg-background/90 text-foreground">
                      {status === 'completed' ? (
                        <CheckCircle2 className="h-4 w-4" />
                      ) : (
                        step.icon
                      )}
                    </div>
                    <span className="relative z-10 text-sm font-medium">
                      {step.label}
                    </span>
                  </div>

                  {index < loadingSteps.length - 1 && (
                    <div
                      className={`
                        mx-2 h-px w-8 shrink-0 md:w-10
                        ${status === 'completed' ? 'bg-foreground/70' : 'bg-border'}
                      `}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 className="text-sm font-semibold text-foreground">Activity history</h4>
              <p className="text-xs text-muted-foreground">A concise trace of what the research run is doing</p>
            </div>
            <span className="rounded-[7px] border border-border px-2.5 py-1 text-xs text-muted-foreground">
              {displayActivity.length} events
            </span>
          </div>

          <div className="overflow-hidden rounded-[8px] border border-border/80 bg-background/70">
            {visibleActivity.map((event, index) => {
              const status = getActivityDisplayStatus(
                index + visibleOffset,
                activeActivityIndex,
                activityStatus,
              );

              return (
                <div
                  key={event.id}
                  className={`
                    flex gap-3 border-b border-border/60 p-4 transition-smooth last:border-b-0
                    ${status === 'active'
                      ? 'bg-card'
                      : ''
                    }
                  `}
                >
                  <div
                    className={`
                      mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-smooth
                      ${status === 'completed'
                        ? 'border-foreground bg-foreground text-background'
                        : status === 'active'
                        ? 'animate-pulse-ring border-foreground/30 bg-foreground/10 text-foreground'
                        : 'border-border bg-muted text-muted-foreground'
                      }
                    `}
                  >
                    {status === 'completed' ? (
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    ) : status === 'active' ? (
                      <span className="h-2 w-2 rounded-full bg-foreground" />
                    ) : (
                      <Circle className="h-3 w-3" />
                    )}
                  </div>
                  <div className="min-w-0 space-y-1">
                    <p
                      className={`
                        text-sm font-medium
                      ${status === 'pending' ? 'text-muted-foreground' : 'text-foreground'}
                      `}
                    >
                      {event.title}
                    </p>
                    <p className="text-sm leading-6 text-muted-foreground">
                      {event.detail}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-4 gap-2">
          <div className="skeleton h-2 rounded-full" />
          <div className="skeleton h-2 rounded-full" />
          <div className="skeleton h-2 rounded-full" />
          <div className="skeleton h-2 rounded-full opacity-60" />
        </div>
      </div>
    </div>
  );
}
