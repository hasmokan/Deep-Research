'use client';

/**
 * ChatGPT-style conversation sidebar for the research chat shell.
 */

import { Edit3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getVisibleChatSidebarItems } from '@/lib/research/chat-shell';
import { useResizablePanel } from '@/lib/research/resizable-panels';
import type { ResearchSession } from '@/lib/research/sessions';

interface ChatSidebarProps {
  sessions: ResearchSession[];
  activeSessionId: string | null;
  isDisabled?: boolean;
  isPending?: boolean;
  onNewChat: () => void;
  onSelectSession: (sessionId: string) => void;
}

const CHAT_SIDEBAR_WIDTH = {
  defaultWidth: 210,
  constraints: { min: 180, max: 360 },
};

export function ChatSidebar({
  sessions,
  activeSessionId,
  isDisabled = false,
  isPending = false,
  onNewChat,
  onSelectSession,
}: ChatSidebarProps) {
  const visibleSessions = getVisibleChatSidebarItems(sessions);
  const sidebarWidth = useResizablePanel({
    defaultWidth: CHAT_SIDEBAR_WIDTH.defaultWidth,
    constraints: CHAT_SIDEBAR_WIDTH.constraints,
    edge: 'right',
  });

  return (
    <aside
      className="relative hidden h-screen shrink-0 border-r border-border bg-card lg:flex lg:flex-col"
      style={{ width: sidebarWidth.width }}
    >
      <div className="px-4 pb-2 pt-4">
        <h1 className="truncate text-sm font-semibold text-foreground">DeepResearch</h1>
      </div>

      <nav className="px-2.5 pt-2">
        <Button
          type="button"
          variant="secondary"
          className="h-9 w-full justify-start rounded-lg px-2.5 text-sm font-medium"
          disabled={isDisabled}
          onClick={onNewChat}
        >
          <Edit3 className="h-4 w-4" />
          New chat
        </Button>
      </nav>

      <div className="mt-5 min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        <p className="mb-2 px-3 text-[11px] font-semibold uppercase text-muted-foreground">Chats</p>
        <div className="grid gap-1">
          {isPending ? (
            <div className="grid gap-1" aria-hidden="true">
              <span className="h-8 rounded-lg bg-muted/60" />
              <span className="h-8 rounded-lg bg-muted/45" />
              <span className="h-8 rounded-lg bg-muted/30" />
            </div>
          ) : visibleSessions.length > 0 ? (
            visibleSessions.map((session) => (
              <button
                key={session.id}
                type="button"
                disabled={isDisabled}
                onClick={() => onSelectSession(session.id)}
                className={`truncate rounded-lg px-3 py-2 text-left text-sm transition-smooth hover:bg-muted ${
                  session.id === activeSessionId ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground'
                }`}
              >
                {session.title}
              </button>
            ))
          ) : (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              No chats yet
            </p>
          )}
        </div>
      </div>
      <div
        role="separator"
        aria-label="Resize chat sidebar"
        aria-orientation="vertical"
        aria-valuemin={CHAT_SIDEBAR_WIDTH.constraints.min}
        aria-valuemax={CHAT_SIDEBAR_WIDTH.constraints.max}
        aria-valuenow={sidebarWidth.width}
        tabIndex={0}
        className="absolute -right-1 top-0 z-50 hidden h-full w-2 cursor-col-resize touch-none outline-none transition-colors hover:bg-foreground/10 focus-visible:bg-foreground/15 lg:block"
        onMouseDown={sidebarWidth.startResize}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') {
            event.preventDefault();
            sidebarWidth.resizeBy(-16);
          }
          if (event.key === 'ArrowRight') {
            event.preventDefault();
            sidebarWidth.resizeBy(16);
          }
        }}
      />
    </aside>
  );
}
