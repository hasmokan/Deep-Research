'use client';

/**
 * Agent trace component with live thinking progress.
 */

import { useState } from 'react';
import {
  Activity,
  Brain,
  CheckCircle2,
  ChevronDown,
  Circle,
  ExternalLink,
  FileSearch,
  FileText,
  Sparkles,
  Wrench,
} from 'lucide-react';
import {
  buildResearchActivity,
  buildResearchActivityStream,
  type ResearchActivityEvent,
} from '@/lib/research/research-workflow';
import { useResearchStore } from '@/lib/store/research';
import type { Document, ResearchStreamTraceDocument } from '@/lib/api/types';
import type { ConversationResearchActivity, ResearchActivityStatus } from '@/lib/research/conversation';
import { useTypewriterText } from '@/lib/research/typewriter';

type LoadingStatus = 'pending' | 'active' | 'completed';

interface LoadingStateProps {
  activity?: ConversationResearchActivity;
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

function getActivityDisplayStatus(
  index: number,
  activeIndex: number,
  activityStatus: ResearchActivityStatus,
): LoadingStatus {
  if (activityStatus === 'completed') {
    return 'completed';
  }
  if (activityStatus === 'failed' || activityStatus === 'stopped') {
    return index < activeIndex ? 'completed' : 'pending';
  }
  if (index === activeIndex) {
    return 'active';
  }
  return index < activeIndex ? 'completed' : 'pending';
}

function getDocumentTitle(document: Document | ResearchStreamTraceDocument, index: number) {
  if ('title' in document && typeof document.title === 'string' && document.title.trim()) {
    return document.title;
  }

  if (!('metadata' in document)) {
    return `Source ${index + 1}`;
  }

  const title = document.metadata.title;
  const source = document.metadata.source;

  if (typeof title === 'string' && title.trim()) {
    return title;
  }
  if (typeof source === 'string' && source.trim()) {
    return source;
  }

  const match = document.content.match(/^\*\*(.+?)\*\*/);
  if (match?.[1]) {
    return match[1];
  }

  return `Source ${index + 1}`;
}

function getDocumentUrl(document: Document | ResearchStreamTraceDocument) {
  if ('url' in document && typeof document.url === 'string' && document.url.startsWith('http')) {
    return document.url;
  }

  if (!('metadata' in document)) {
    return null;
  }

  const url = document.metadata.url ?? document.metadata.href;
  return typeof url === 'string' && url.startsWith('http') ? url : null;
}

function EventIcon({ event, className }: { event: ResearchActivityEvent; className: string }) {
  if (event.kind === 'tool_call') {
    return <Wrench className={className} />;
  }
  if (event.kind === 'tool_result' || event.kind === 'sources') {
    return <FileSearch className={className} />;
  }
  if (event.kind === 'thinking' || event.kind === 'reasoning' || event.stage === 'analyze') {
    return <Brain className={className} />;
  }
  if (event.stage === 'report') {
    return <FileText className={className} />;
  }
  return <Sparkles className={className} />;
}

function shouldShowDocuments(event: ResearchActivityEvent) {
  return (
    (event.kind === 'sources' || event.kind === 'tool_result') &&
    event.documents &&
    event.documents.length > 0
  );
}

function shouldShowThinkingBlock(event: ResearchActivityEvent) {
  return event.kind === 'thinking' && event.detail.trim().length > 0;
}

interface ActivityEventRowProps {
  event: ResearchActivityEvent;
  status: LoadingStatus;
  isLast: boolean;
  isStreaming: boolean;
}

function ActivityEventRow({ event, status, isLast, isStreaming }: ActivityEventRowProps) {
  const shouldAnimateText = isStreaming && status === 'active' && event.detail.length > 0;
  const detail = useTypewriterText(event.detail, shouldAnimateText);
  const showCursor = shouldAnimateText && detail.length < event.detail.length;

  return (
    <div
      className={`
        relative -mx-1 flex gap-3 rounded-[8px] px-1 py-2.5
        ${shouldAnimateText ? 'agent-active-row' : ''}
      `}
    >
      <div className="relative flex w-6 shrink-0 justify-center">
        {!isLast && (
          <span className="absolute left-1/2 top-7 h-[calc(100%-0.5rem)] w-px -translate-x-1/2 bg-border/80" />
        )}
        <div
          className={`
            relative z-10 flex h-6 w-6 items-center justify-center rounded-full border bg-background transition-smooth
            ${status === 'completed'
              ? 'border-foreground bg-foreground text-background'
              : status === 'active'
              ? 'animate-pulse-ring border-foreground/30 text-foreground'
              : 'border-border text-muted-foreground'
            }
          `}
        >
          {status === 'completed' ? (
            <CheckCircle2 className="h-3.5 w-3.5" />
          ) : status === 'active' ? (
            <EventIcon event={event} className="h-3.5 w-3.5" />
          ) : (
            <Circle className="h-3 w-3" />
          )}
        </div>
      </div>

      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex min-w-0 items-center gap-2">
          <p
            className={`
              truncate text-sm font-medium
              ${status === 'pending' ? 'text-muted-foreground' : 'text-foreground'}
            `}
          >
            {event.title}
          </p>
          {event.kind === 'tool_call' && (
            <span className="rounded-full border border-border/70 bg-muted/60 px-2 py-0.5 text-[11px] text-muted-foreground">
              tool
            </span>
          )}
        </div>

        {!shouldShowThinkingBlock(event) && (
          <p className="text-sm leading-6 text-muted-foreground">
            {detail}
            {showCursor && (
              <span className="ml-0.5 inline-block h-4 w-px translate-y-0.5 animate-agent-cursor bg-foreground/70" />
            )}
          </p>
        )}

        {shouldShowDocuments(event) && (
          <div className="mt-2 flex flex-wrap gap-2">
            {event.documents?.slice(0, 8).map((document, documentIndex) => {
              const url = getDocumentUrl(document);
              const title = getDocumentTitle(document, documentIndex);

              if (url) {
                return (
                  <a
                    key={`${documentIndex}-${document.id}`}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex max-w-full items-center gap-1.5 rounded-[7px] border border-border/80 bg-muted/50 px-2.5 py-1 text-xs text-foreground transition-smooth hover:bg-muted"
                  >
                    <span className="truncate">{title}</span>
                    <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
                  </a>
                );
              }

              return (
                <span
                  key={`${documentIndex}-${document.id}`}
                  className="inline-flex max-w-full rounded-[7px] border border-border/80 bg-muted/50 px-2.5 py-1 text-xs text-foreground"
                >
                  <span className="truncate">{title}</span>
                </span>
              );
            })}
          </div>
        )}

        {shouldShowThinkingBlock(event) && (
          <div className="mt-2 whitespace-pre-wrap border-l border-border/80 pl-3 text-sm leading-6 text-foreground">
            {detail}
            {showCursor && (
              <span className="ml-0.5 inline-block h-4 w-px translate-y-0.5 animate-agent-cursor bg-foreground/70" />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function LoadingState({ activity }: LoadingStateProps = {}) {
  const store = useResearchStore();
  const [showOlderSteps, setShowOlderSteps] = useState(true);
  const streamStatuses = activity?.streamStatuses ?? store.streamStatuses;
  const streamThinking = activity?.streamThinking ?? store.streamThinking;
  const streamDocuments = activity?.streamDocuments ?? store.streamDocuments;
  const streamTrace = activity?.streamTrace ?? store.streamTrace;
  const activityStatus = activity?.status ?? 'running';
  const streamActivity = buildResearchActivity(streamStatuses, streamThinking, streamDocuments, streamTrace);
  const activityStream = buildResearchActivityStream(streamActivity, showOlderSteps);
  const visibleActivity = activityStream.visibleEvents;
  const activeActivityIndex = visibleActivity.length - 1;
  const hasHiddenSteps = activityStream.hiddenCount > 0;
  const isRunning = activityStatus === 'running';

  return (
    <section className="relative w-full overflow-hidden rounded-[10px] border border-border/70 bg-background/85 p-1 shadow-sm">
      {isRunning && (
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px overflow-hidden">
          <span className="block h-full w-1/3 animate-agent-trace-scan rounded-full bg-foreground/35" />
        </div>
      )}

      <div className="flex items-center justify-between gap-3 px-2 py-2">
        <button
          type="button"
          disabled={!hasHiddenSteps}
          onClick={() => setShowOlderSteps((current) => !current)}
          className="inline-flex min-w-0 items-center gap-2 rounded-[7px] px-2 py-1.5 text-sm font-medium text-muted-foreground transition-smooth hover:bg-muted/70 hover:text-foreground disabled:pointer-events-none disabled:opacity-70"
        >
          <ChevronDown
            className={`h-4 w-4 shrink-0 transition-transform ${showOlderSteps ? 'rotate-180' : ''}`}
          />
          <span className="truncate">
            {hasHiddenSteps ? activityStream.toggleLabel : 'Agent trace'}
          </span>
          {hasHiddenSteps && !showOlderSteps && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {activityStream.hiddenCount}
            </span>
          )}
        </button>

        <div className="inline-flex shrink-0 items-center gap-2 rounded-[7px] border border-border/70 bg-background px-2.5 py-1.5 text-xs font-medium text-muted-foreground">
          {isRunning ? (
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-agent-live-ping rounded-full bg-foreground/30" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-foreground" />
            </span>
          ) : (
            <Activity className="h-3.5 w-3.5" />
          )}
          {getBadgeLabel(activityStatus)}
        </div>
      </div>

      {activity?.query && (
        <div className="mx-4 mb-1 truncate border-l border-border/80 pl-3 text-xs text-muted-foreground">
          Query: {activity.query}
        </div>
      )}

      <div className="px-3 pb-3">
        {visibleActivity.length === 0 ? (
          <div className="flex items-center gap-3 border-l border-border/80 py-3 pl-3 text-sm text-muted-foreground">
            <span className="relative flex h-5 w-5 items-center justify-center rounded-full border border-foreground/25 text-foreground">
              <Activity className="h-3.5 w-3.5 animate-pulse" />
            </span>
            <span>Waiting for backend agent events</span>
            <span className="inline-flex items-center gap-1" aria-hidden="true">
              <span className="h-1 w-1 animate-agent-dot rounded-full bg-muted-foreground [animation-delay:0ms]" />
              <span className="h-1 w-1 animate-agent-dot rounded-full bg-muted-foreground [animation-delay:160ms]" />
              <span className="h-1 w-1 animate-agent-dot rounded-full bg-muted-foreground [animation-delay:320ms]" />
            </span>
          </div>
        ) : visibleActivity.map((event, index) => {
          const status = getActivityDisplayStatus(index, activeActivityIndex, activityStatus);
          const isLast = index === visibleActivity.length - 1;

          return (
            <ActivityEventRow
              key={event.id}
              event={event}
              status={status}
              isLast={isLast}
              isStreaming={isRunning}
            />
          );
        })}
      </div>

      {isRunning && (
        <div className="px-3 pb-3 pt-0.5">
          <div className="relative h-1 overflow-hidden rounded-full bg-muted">
            <span className="absolute inset-y-0 left-0 w-1/3 animate-agent-progress rounded-full bg-foreground/55" />
          </div>
        </div>
      )}
    </section>
  );
}
