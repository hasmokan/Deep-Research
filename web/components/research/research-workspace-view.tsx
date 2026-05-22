'use client';

import {
  BookOpenCheck,
  Compass,
  FileText,
  FlaskConical,
  LogOut,
  Menu,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ChatSidebar } from '@/components/layouts/chat-sidebar';
import { ErrorState, LoadingState, ReportSidebar, SearchForm } from '@/components/research';
import { ResearchPlanPanel } from '@/components/research/research-plan-panel';
import {
  AssistantResultMessage,
  ThinkingDots,
  UserBubble,
} from '@/components/research/conversation-messages';
import type { ResearchResult } from '@/lib/api/types';
import type { ConversationMessage } from '@/lib/research/conversation';
import type { ErrorDiagnostic } from '@/lib/research/error-diagnostics';
import type { ResearchPlan } from '@/lib/research/research-workflow';
import type { ResearchSession } from '@/lib/research/sessions';

const STARTER_PROMPTS: Array<{ label: string; prompt: string; Icon: LucideIcon }> = [
  {
    label: 'AI agent product map',
    prompt: 'Map the current AI agent product landscape and compare the strongest positioning signals.',
    Icon: Compass,
  },
  {
    label: 'Company strategy brief',
    prompt: 'Compare OpenAI and Anthropic strategy across product, distribution, and enterprise adoption.',
    Icon: BookOpenCheck,
  },
  {
    label: 'Evidence timeline',
    prompt: 'Build a source-backed timeline for recent AI policy and model release milestones.',
    Icon: FlaskConical,
  },
];

export interface ResearchWorkspaceViewProps {
  activePlan: ResearchPlan | null;
  activePlanActivityMessage?: ConversationMessage;
  activeSessionId: string | null;
  authEmail?: string | null;
  canUseWorkspace: boolean;
  currentQuery: string;
  error: string | null;
  errorDiagnostic: ErrorDiagnostic | null;
  hasConversation: boolean;
  hasInlineRunningActivity: boolean;
  isDeepResearchMode: boolean;
  isLoading: boolean;
  isMobileChatOpen: boolean;
  isMobileReportOpen: boolean;
  isPlanning: boolean;
  isWorkspacePending: boolean;
  localQuery: string;
  query: string;
  sessions: ResearchSession[];
  shouldShowPlanPanel: boolean;
  sidebarResult: ResearchResult | null;
  visibleMessages: ConversationMessage[];
  conversationEndRef: React.RefObject<HTMLDivElement | null>;
  conversationScrollRef: React.RefObject<HTMLDivElement | null>;
  onCancelPlan: () => void;
  onCloseReportSidebar: () => void;
  onCreatePlan: (queryOverride?: string, options?: { appendUserMessage?: boolean }) => void | Promise<void>;
  onDirectAnswerFromError: () => void;
  onEditPlan: () => void;
  onExpandReport: () => void;
  onNewChat: () => void;
  onPlanRevealComplete: () => void;
  onQueryChange: (nextQuery: string) => void;
  onRetryFromError: () => void;
  onSelectSession: (sessionId: string) => void;
  onSignOut: () => void | Promise<void>;
  onStartResearch: (
    queryOverride?: unknown,
    options?: { skipPlan?: boolean; appendUserMessage?: boolean },
  ) => void | Promise<void>;
  onStarterPrompt: (prompt: string) => void;
  onStop: () => void;
  onToggleDeepResearchMode: () => void;
  setMobileChatOpen: (isOpen: boolean) => void;
  setMobileReportOpen: (isOpen: boolean) => void;
}

export function ResearchWorkspaceView({
  activePlan,
  activePlanActivityMessage,
  activeSessionId,
  authEmail,
  canUseWorkspace,
  currentQuery,
  error,
  errorDiagnostic,
  hasConversation,
  hasInlineRunningActivity,
  isDeepResearchMode,
  isLoading,
  isMobileChatOpen,
  isMobileReportOpen,
  isPlanning,
  isWorkspacePending,
  localQuery,
  query,
  sessions,
  shouldShowPlanPanel,
  sidebarResult,
  visibleMessages,
  conversationEndRef,
  conversationScrollRef,
  onCancelPlan,
  onCloseReportSidebar,
  onCreatePlan,
  onDirectAnswerFromError,
  onEditPlan,
  onExpandReport,
  onNewChat,
  onPlanRevealComplete,
  onQueryChange,
  onRetryFromError,
  onSelectSession,
  onSignOut,
  onStartResearch,
  onStarterPrompt,
  onStop,
  onToggleDeepResearchMode,
  setMobileChatOpen,
  setMobileReportOpen,
}: ResearchWorkspaceViewProps) {
  return (
    <div
      className="flex h-dvh overflow-hidden bg-background text-foreground"
      aria-busy={isWorkspacePending}
    >
      <ChatSidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        isDisabled={!canUseWorkspace}
        isPending={isWorkspacePending}
        onNewChat={onNewChat}
        onSelectSession={onSelectSession}
      />

      <main className="relative flex h-dvh min-w-0 flex-1 flex-col overflow-hidden">
        <header className="z-40 flex h-12 shrink-0 items-center justify-between border-b border-border/60 bg-background/90 px-4 backdrop-blur-xl lg:px-5">
          <div className="flex items-center gap-2 lg:hidden">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-lg"
              aria-label="Open chats"
              onClick={() => setMobileChatOpen(true)}
            >
              <Menu className="h-4 w-4" />
            </Button>
            <span className="text-base font-semibold">DeepResearch</span>
          </div>
          <div className="hidden lg:block" />
          <div className="flex min-w-0 items-center gap-2">
            {authEmail && (
              <>
                {sidebarResult && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 rounded-lg xl:hidden"
                    aria-label="Open report"
                    onClick={() => setMobileReportOpen(true)}
                  >
                    <FileText className="h-4 w-4" />
                  </Button>
                )}
                <span className="hidden max-w-[240px] truncate text-sm text-muted-foreground md:inline">
                  {authEmail}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 rounded-lg"
                  aria-label="Sign out"
                  onClick={() => {
                    void onSignOut();
                  }}
                >
                  <LogOut className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
        </header>

        <div ref={conversationScrollRef} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 pb-48 pt-5 md:px-5">
            {!hasConversation && (
              <div className="flex flex-1 items-start justify-center pt-[18vh] md:pt-[21vh]">
                <div className="w-full max-w-[640px]">
                  <div className="mx-auto mb-4 max-w-[480px] text-center">
                    <h1 className="text-2xl font-semibold leading-tight text-foreground md:text-[28px]">
                      Hello again.
                    </h1>
                    <p className="mx-auto mt-3 text-sm leading-6 text-muted-foreground">
                      Ask a question, compare sources, or turn a thread into a focused research brief.
                    </p>
                  </div>

                  <SearchForm
                    query={localQuery}
                    isLoading={isLoading}
                    isPlanning={isPlanning}
                    isDisabled={!canUseWorkspace}
                    placeholder="How can I assist you today?"
                    hasPlan={Boolean(activePlan)}
                    isDeepResearchMode={isDeepResearchMode}
                    onQueryChange={onQueryChange}
                    onCreatePlan={onCreatePlan}
                    onStartResearch={onStartResearch}
                    onToggleDeepResearchMode={onToggleDeepResearchMode}
                    onStop={onStop}
                  />

                  <div className="mx-auto mt-7 flex max-w-[600px] flex-wrap items-center justify-center gap-2">
                    {STARTER_PROMPTS.map(({ label, prompt, Icon }) => (
                      <button
                        key={label}
                        type="button"
                        disabled={!canUseWorkspace}
                        onClick={() => onStarterPrompt(prompt)}
                        className="group inline-flex h-9 items-center gap-2 rounded-full border border-border bg-card/70 px-3 text-sm font-medium text-muted-foreground transition-colors hover:border-foreground/25 hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                      >
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors group-hover:text-foreground">
                          <Icon className="h-4 w-4" />
                        </span>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {hasConversation && (
              <div className="space-y-6">
                {visibleMessages.map((message) => (
                  message.role === 'user' ? (
                    <UserBubble key={message.id} content={message.content} />
                  ) : (
                    <AssistantResultMessage key={message.id} message={message} />
                  )
                ))}

                {isPlanning && !activePlan && <ThinkingDots />}

                {shouldShowPlanPanel && (
                  <div className="mx-auto max-w-[700px]">
                    <ResearchPlanPanel
                      key={activePlan
                        ? `${activePlan.query}-${activePlan.steps.map((step) => step.id).join('-')}`
                        : `planning-shell-${query || currentQuery}`}
                      plan={activePlan}
                      activity={!isPlanning ? activePlanActivityMessage?.researchActivity : undefined}
                      isLoading={isLoading || isPlanning}
                      isStreaming={isPlanning && Boolean(activePlan)}
                      revealSteps={isPlanning && Boolean(activePlan)}
                      onRevealComplete={activePlan ? onPlanRevealComplete : undefined}
                      onEdit={!isPlanning ? onEditPlan : undefined}
                      onCancel={!isPlanning ? onCancelPlan : undefined}
                      onStart={!isPlanning
                        ? () => {
                            void onStartResearch();
                          }
                        : undefined}
                    />
                  </div>
                )}

                {isLoading && !hasInlineRunningActivity && (
                  <div className="mx-auto max-w-[720px]">
                    <LoadingState />
                  </div>
                )}

                {error && !isLoading && (
                  <div className="mx-auto max-w-[720px]">
                    <ErrorState
                      error={error}
                      diagnostics={errorDiagnostic}
                      onRetry={onRetryFromError}
                      onDirectAnswer={onDirectAnswerFromError}
                    />
                  </div>
                )}

                <div ref={conversationEndRef} className="h-1" />
              </div>
            )}
          </div>
        </div>

        {hasConversation && (
          <div className="pointer-events-none absolute bottom-0 left-0 right-0 z-40 bg-gradient-to-t from-background via-background/95 to-transparent px-4 pb-3 pt-12">
            <SearchForm
              query={localQuery}
              isLoading={isLoading}
              isPlanning={isPlanning}
              isDisabled={!canUseWorkspace}
              hasPlan={Boolean(activePlan)}
              isDeepResearchMode={isDeepResearchMode}
              onQueryChange={onQueryChange}
              onCreatePlan={onCreatePlan}
              onStartResearch={onStartResearch}
              onToggleDeepResearchMode={onToggleDeepResearchMode}
              onStop={onStop}
            />
            <p className="mx-auto mt-2 max-w-3xl text-center text-xs text-muted-foreground">
              deepresearch can make mistakes. Check important info.
            </p>
          </div>
        )}
      </main>

      {sidebarResult && (
        <ReportSidebar
          result={sidebarResult}
          onExpand={onExpandReport}
          onClose={onCloseReportSidebar}
        />
      )}

      {isMobileChatOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden" role="dialog" aria-modal="true" aria-label="Chat history">
          <button
            type="button"
            className="absolute inset-0 bg-background/70 backdrop-blur-sm"
            aria-label="Close chats"
            onClick={() => setMobileChatOpen(false)}
          />
          <div className="animate-chat-sidebar-in relative z-10">
            <ChatSidebar
              sessions={sessions}
              activeSessionId={activeSessionId}
              isDisabled={!canUseWorkspace}
              isPending={isWorkspacePending}
              variant="drawer"
              onClose={() => setMobileChatOpen(false)}
              onNewChat={onNewChat}
              onSelectSession={onSelectSession}
            />
          </div>
        </div>
      )}

      {sidebarResult && isMobileReportOpen && (
        <div className="fixed inset-0 z-50 flex justify-end xl:hidden" role="dialog" aria-modal="true" aria-label="Research report">
          <button
            type="button"
            className="absolute inset-0 bg-background/70 backdrop-blur-sm"
            aria-label="Close report"
            onClick={() => setMobileReportOpen(false)}
          />
          <div className="relative z-10">
            <ReportSidebar
              result={sidebarResult}
              variant="drawer"
              onExpand={onExpandReport}
              onClose={() => setMobileReportOpen(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
