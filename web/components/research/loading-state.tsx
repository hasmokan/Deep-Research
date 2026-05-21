'use client';

/**
 * Agent trace component with live thinking progress.
 */

import { useState } from 'react';
import {
  Activity,
  Brain,
  ChevronDown,
  Code2,
  ExternalLink,
  FileSearch,
  FileText,
  MessageCircle,
  Sparkles,
  Wrench,
} from 'lucide-react';
import {
  buildResearchActivityTimeline,
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
  if (event.stage === 'coding') {
    return <Code2 className={className} />;
  }
  if (event.stage === 'answer' || event.stage === 'route') {
    return <MessageCircle className={className} />;
  }
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

function isThinkingEvent(event: ResearchActivityEvent) {
  return event.kind === 'thinking';
}

function shouldShowDocuments(event: ResearchActivityEvent) {
  return (
    (event.kind === 'sources' || event.kind === 'tool_result') &&
    event.documents &&
    event.documents.length > 0
  );
}

function splitThinkingNotes(detail: string) {
  return detail
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^•\s*/, ''))
    .filter(Boolean);
}

function DocumentLinks({
  documents,
}: {
  documents?: Array<Document | ResearchStreamTraceDocument>;
}) {
  if (!documents?.length) {
    return null;
  }

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {documents.slice(0, 6).map((document, documentIndex) => {
        const url = getDocumentUrl(document);
        const title = getDocumentTitle(document, documentIndex);

        if (url) {
          return (
            <a
              key={`${documentIndex}-${document.id}`}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex max-w-full items-center gap-1.5 rounded-[7px] border border-border/80 bg-background/80 px-2 py-1 text-[11px] text-foreground transition-smooth hover:bg-muted"
            >
              <span className="truncate">{title}</span>
              <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
            </a>
          );
        }

        return (
          <span
            key={`${documentIndex}-${document.id}`}
            className="inline-flex max-w-full rounded-[7px] border border-border/80 bg-background/80 px-2 py-1 text-[11px] text-foreground"
          >
            <span className="truncate">{title}</span>
          </span>
        );
      })}
    </div>
  );
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
  const usesThinkingMarker = isThinkingEvent(event);
  const thinkingNotes = usesThinkingMarker ? splitThinkingNotes(detail) : [];

  return (
    <div
      className={`
        relative -mx-1 flex gap-2.5 rounded-[8px] px-1 py-2
        ${shouldAnimateText ? 'agent-active-row' : ''}
      `}
    >
      <div className="relative flex w-5 shrink-0 justify-center pt-0.5">
        {!isLast && (
          <span className="absolute left-1/2 top-6 h-[calc(100%-0.25rem)] w-px -translate-x-1/2 bg-border/80" />
        )}
        {usesThinkingMarker ? (
          <span
            className={`
              relative z-10 mt-2 h-1.5 w-1.5 rounded-full transition-smooth
              ${status === 'active'
                ? 'bg-foreground ring-4 ring-foreground/10'
                : status === 'completed'
                ? 'bg-foreground/65'
                : 'bg-muted-foreground/45'
              }
            `}
          />
        ) : (
          <div
            className={`
              relative z-10 flex h-5 w-5 items-center justify-center rounded-[6px] border bg-background transition-smooth
              ${status === 'active'
                ? 'animate-pulse-ring border-foreground/35 text-foreground'
                : status === 'completed'
                ? 'border-border/90 text-foreground/75'
                : 'border-border/80 text-muted-foreground'
              }
            `}
          >
            <EventIcon event={event} className="h-3 w-3" />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1 space-y-1">
        {usesThinkingMarker ? (
          <div className="space-y-1.5 text-xs leading-5 text-muted-foreground">
            {thinkingNotes.length > 0 ? (
              thinkingNotes.map((note, noteIndex) => (
                <p key={`${event.id}-${noteIndex}`}>{note}</p>
              ))
            ) : (
              <p>{event.title}</p>
            )}
            {showCursor && (
              <span className="ml-0.5 inline-block h-4 w-px translate-y-0.5 animate-agent-cursor bg-foreground/70" />
            )}
          </div>
        ) : (
          <>
            <div className="flex min-w-0 items-center gap-2">
              <p
                className={`
                  truncate text-xs font-medium
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

            <p className="text-xs leading-5 text-muted-foreground">
              {detail}
              {showCursor && (
                <span className="ml-0.5 inline-block h-4 w-px translate-y-0.5 animate-agent-cursor bg-foreground/70" />
              )}
            </p>

            {shouldShowDocuments(event) && (
              <DocumentLinks documents={event.documents} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function LoadingState({ activity }: LoadingStateProps = {}) {
  const store = useResearchStore();
  const [showOlderSteps, setShowOlderSteps] = useState(false);
  const streamStatuses = activity?.streamStatuses ?? store.streamStatuses;
  const streamThinking = activity?.streamThinking ?? store.streamThinking;
  const streamDocuments = activity?.streamDocuments ?? store.streamDocuments;
  const streamTrace = activity?.streamTrace ?? store.streamTrace;
  const streamAgentMessages = activity?.streamAgentMessages ?? store.streamAgentMessages;
  const activityStatus = activity?.status ?? 'running';
  const streamActivity = buildResearchActivityTimeline({
    statuses: streamStatuses,
    thinking: streamThinking,
    documents: streamDocuments,
    trace: streamTrace,
    agentMessages: streamAgentMessages,
  });
  const activityStream = buildResearchActivityStream(streamActivity, showOlderSteps);
  const visibleActivity = activityStream.visibleEvents;
  const activeActivityIndex = visibleActivity.length - 1;
  const hasHiddenSteps = activityStream.hiddenCount > 0;
  const hasActivityDetails = streamActivity.length > 0;
  const isRunning = activityStatus === 'running';
  const stepCount = streamActivity.length;

  return (
    <section className="relative w-full overflow-hidden rounded-[8px] border border-border/70 bg-background/85 p-0.5 shadow-sm">
      {isRunning && (
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px overflow-hidden">
          <span className="block h-full w-1/3 animate-agent-trace-scan rounded-full bg-foreground/35" />
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {hasActivityDetails ? (
            <button
              type="button"
              disabled={!hasHiddenSteps}
              onClick={() => setShowOlderSteps((current) => !current)}
              className="inline-flex min-w-0 items-center gap-2 rounded-[7px] px-1.5 py-1 text-sm font-medium text-muted-foreground transition-smooth hover:bg-muted/70 hover:text-foreground disabled:pointer-events-none disabled:opacity-70"
            >
              <ChevronDown
                className={`h-3.5 w-3.5 shrink-0 transition-transform ${showOlderSteps ? 'rotate-180' : ''}`}
              />
              <span className="truncate">
                {hasHiddenSteps ? activityStream.toggleLabel : 'Agent trace'}
              </span>
            </button>
          ) : (
            <span className="px-1.5 py-1 text-sm font-medium text-muted-foreground">
              Agent trace
            </span>
          )}
          <span className="shrink-0 text-xs text-muted-foreground">
            {stepCount > 0
              ? `${stepCount} step${stepCount === 1 ? '' : 's'}`
              : 'Waiting'}
          </span>
        </div>

        <div className="inline-flex shrink-0 items-center gap-2 rounded-[7px] border border-border/70 bg-background px-2.5 py-1.5 text-xs font-medium text-muted-foreground">
          <Activity className={`h-3.5 w-3.5 ${isRunning ? 'animate-pulse' : ''}`} />
          {getBadgeLabel(activityStatus)}
        </div>
      </div>

      {activity?.query && (
        <div className="px-3 pb-1">
          <div className="relative -mx-1 flex gap-2.5 rounded-[8px] bg-muted/35 px-1 py-1.5">
            <div className="relative flex w-5 shrink-0 justify-center pt-0.5">
              <div className="relative z-10 flex h-5 w-5 items-center justify-center rounded-[6px] border border-border/80 bg-background text-muted-foreground">
                <MessageCircle className="h-3 w-3" />
              </div>
            </div>
            <p className="min-w-0 flex-1 truncate text-xs leading-5 text-muted-foreground">
              <span className="font-medium text-foreground/75">Query</span>
              <span className="text-muted-foreground/70">: </span>
              {activity.query}
            </p>
          </div>
        </div>
      )}

      <div className="px-3 pb-3">
        {visibleActivity.length === 0 ? (
          <div className="flex items-center gap-3 border-l border-border/80 py-3 pl-3 text-sm text-muted-foreground">
            <span className="relative flex h-5 w-5 items-center justify-center rounded-[6px] border border-foreground/25 text-foreground">
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

        {hasHiddenSteps && !showOlderSteps && (
          <button
            type="button"
            onClick={() => setShowOlderSteps(true)}
            className="mt-1 flex w-full items-center gap-2 rounded-[7px] px-1 py-2 text-left text-sm text-muted-foreground transition-smooth hover:bg-muted/60 hover:text-foreground"
          >
            <ChevronDown className="h-4 w-4 rotate-[-90deg]" />
            <span>{activityStream.hiddenCount} earlier step{activityStream.hiddenCount === 1 ? '' : 's'}</span>
          </button>
        )}
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
