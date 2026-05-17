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

function getEventIcon(event: ResearchActivityEvent) {
  if (event.kind === 'tool_call') {
    return Wrench;
  }
  if (event.kind === 'tool_result' || event.kind === 'sources') {
    return FileSearch;
  }
  if (event.kind === 'thinking' || event.kind === 'reasoning' || event.stage === 'analyze') {
    return Brain;
  }
  if (event.stage === 'report') {
    return FileText;
  }
  return Sparkles;
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

  return (
    <section className="w-full rounded-[10px] border border-border/70 bg-background/85 p-1 shadow-sm">
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
          <Activity className="h-3.5 w-3.5" />
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
            <Activity className="h-4 w-4" />
            Waiting for backend agent events...
          </div>
        ) : visibleActivity.map((event, index) => {
          const status = getActivityDisplayStatus(index, activeActivityIndex, activityStatus);
          const Icon = getEventIcon(event);
          const isLast = index === visibleActivity.length - 1;

          return (
            <div key={event.id} className="relative flex gap-3 py-2.5">
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
                    <Icon className="h-3.5 w-3.5" />
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
                    {event.detail}
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
                    {event.detail}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
