'use client';

/**
 * ChatGPT-style conversation sidebar for the research chat shell.
 */

import {
  Code2,
  Edit3,
  FolderPlus,
  MoreHorizontal,
  PanelLeft,
  Search,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ResearchSession } from '@/lib/research/sessions';

interface ChatSidebarProps {
  sessions: ResearchSession[];
  activeSessionId: string | null;
  onNewChat: () => void;
  onSelectSession: (sessionId: string) => void;
}

const secondaryNavigationItems = [
  { label: 'Search chats', icon: Search },
  { label: 'Projects', icon: FolderPlus },
  { label: 'Codex', icon: Code2 },
  { label: 'More', icon: MoreHorizontal },
];

export function ChatSidebar({
  sessions,
  activeSessionId,
  onNewChat,
  onSelectSession,
}: ChatSidebarProps) {
  return (
    <aside className="hidden h-screen w-[320px] shrink-0 border-r border-border bg-card lg:flex lg:flex-col">
      <div className="flex items-center justify-between px-5 py-5">
        <h1 className="text-2xl font-semibold text-foreground">deepresearch</h1>
        <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full" aria-label="Collapse sidebar">
          <PanelLeft className="h-5 w-5" />
        </Button>
      </div>

      <nav className="grid gap-1 px-3">
        <Button
          type="button"
          variant="ghost"
          className="h-11 justify-start rounded-[10px] px-3 text-base font-normal"
          onClick={onNewChat}
        >
          <Edit3 className="h-5 w-5" />
          New chat
        </Button>

        {secondaryNavigationItems.map((item) => {
          const Icon = item.icon;

          return (
            <Button
              key={item.label}
              variant="ghost"
              className="h-11 justify-start rounded-[10px] px-3 text-base font-normal"
            >
              <Icon className="h-5 w-5" />
              {item.label}
            </Button>
          );
        })}
      </nav>

      <div className="mt-7 min-h-0 flex-1 overflow-y-auto px-2">
        <p className="mb-2 px-3 text-sm font-semibold text-foreground">Recents</p>
        <div className="grid gap-1">
          {sessions.length > 0 ? (
            sessions.map((session) => (
              <button
                key={session.id}
                type="button"
                onClick={() => onSelectSession(session.id)}
                className={`truncate rounded-[10px] px-3 py-2.5 text-left text-sm transition-smooth hover:bg-muted ${
                  session.id === activeSessionId ? 'bg-muted text-foreground' : 'text-foreground'
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
    </aside>
  );
}
