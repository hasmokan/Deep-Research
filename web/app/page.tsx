'use client';

/**
 * Chatbot-first deep research interface.
 */

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, MoreHorizontal, Share, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { ChatSidebar } from '@/components/layouts/chat-sidebar';
import { ErrorState, LoadingState, ReportSidebar, ResultsDisplay, SearchForm } from '@/components/research';
import { ResearchPlanPanel } from '@/components/research/research-plan-panel';
import { apiClient } from '@/lib/api';
import { createResearchPlan, normalizeResearchPlan, type ResearchPlan } from '@/lib/research/research-workflow';
import { useResearchStore } from '@/lib/store/research';

function UserBubble({ query }: { query: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[680px] rounded-[26px] bg-foreground px-5 py-4 text-base leading-7 text-background">
        {query}
      </div>
    </div>
  );
}

export default function Home() {
  const [localQuery, setLocalQuery] = useState('');
  const [researchPlan, setResearchPlan] = useState<ResearchPlan | null>(null);
  const [isPlanning, setPlanning] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const conversationEndRef = useRef<HTMLDivElement | null>(null);
  const {
    query,
    isLoading,
    error,
    result,
    setQuery,
    setLoading,
    setError,
    setResult,
    resetStream,
    addStreamStatus,
    addStreamThinking,
  } = useResearchStore();

  const currentQuery = localQuery.trim();
  const activePlan = researchPlan?.query === currentQuery ? researchPlan : null;
  const conversationQuery = result?.query || researchPlan?.query || query || currentQuery;
  const hasConversation = Boolean(conversationQuery || isPlanning || isLoading || error || result);
  const hasResult = result && !isLoading && !error;

  useEffect(() => {
    if (hasConversation) {
      conversationEndRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'end',
      });
    }
  }, [hasConversation, researchPlan, isPlanning, isLoading, error, result]);

  const handleQueryChange = (nextQuery: string) => {
    setLocalQuery(nextQuery);

    if (researchPlan && nextQuery.trim() !== researchPlan.query) {
      setResearchPlan(null);
    }
  };

  const handleCreatePlan = async () => {
    if (!currentQuery) {
      setError('Please enter a research query');
      return;
    }

    const requestedQuery = currentQuery;

    setQuery(currentQuery);
    setError(null);
    setResult(null);
    resetStream();
    setResearchPlan(null);
    setPlanning(true);

    try {
      const generatedPlan = await apiClient.createResearchPlan({ query: requestedQuery });
      setResearchPlan(normalizeResearchPlan(generatedPlan));
    } catch {
      setResearchPlan(createResearchPlan(requestedQuery));
    } finally {
      setPlanning(false);
    }
  };

  const handleStartResearch = async () => {
    if (!currentQuery) {
      setError('Please enter a research query');
      return;
    }

    if (!activePlan) {
      void handleCreatePlan();
      return;
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      setQuery(currentQuery);
      setLoading(true);
      setError(null);
      setResult(null);
      resetStream();

      const researchResult = await apiClient.streamResearch(
        { query: currentQuery },
        {
          onStatus: addStreamStatus,
          onThinking: addStreamThinking,
          signal: abortController.signal,
        },
      ).catch((streamError) => {
        if (abortController.signal.aborted) {
          throw streamError;
        }
        return apiClient.executeResearch({ query: currentQuery });
      });

      setResult(researchResult);
    } catch (researchError) {
      if (!abortController.signal.aborted) {
        setError(researchError instanceof Error ? researchError.message : 'An error occurred');
      }
    } finally {
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null;
      }
      setLoading(false);
    }
  };

  const handleStop = () => {
    abortControllerRef.current?.abort();
  };

  const handleCancelPlan = () => {
    abortControllerRef.current?.abort();
    setResearchPlan(null);
    setQuery('');
    setError(null);
    setResult(null);
    resetStream();
  };

  const handleEditPlan = () => {
    setResearchPlan(null);
  };

  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      <ChatSidebar activeQuery={conversationQuery} />

      <main className="relative flex h-dvh min-w-0 flex-1 flex-col overflow-hidden">
        <header className="z-40 flex h-16 shrink-0 items-center justify-between bg-background/85 px-4 backdrop-blur-xl lg:px-6">
          <div className="flex items-center gap-2 lg:hidden">
            <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-foreground text-background">
              <Sparkles className="h-5 w-5" />
            </div>
            <span className="text-lg font-semibold">deepresearch</span>
          </div>
          <div className="hidden lg:block" />
          <div className="flex items-center gap-1">
            <Button variant="ghost" className="h-9 rounded-full px-3">
              <Share className="h-4 w-4" />
              Share
            </Button>
            <ThemeToggle />
            <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full" aria-label="More actions">
              <MoreHorizontal className="h-5 w-5" />
            </Button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col px-4 pb-40 pt-8 md:px-8">
            {!hasConversation && (
              <div className="flex flex-1 items-center justify-center">
                <div className="max-w-2xl text-center">
                  <div className="mx-auto mb-6 flex h-12 w-12 items-center justify-center rounded-2xl bg-foreground text-background">
                    <Sparkles className="h-6 w-6" />
                  </div>
                  <h1 className="text-4xl font-semibold md:text-5xl">
                    What should we research?
                  </h1>
                  <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-muted-foreground">
                    Ask for a detailed report, review the plan, then start a live deep research run.
                  </p>
                </div>
              </div>
            )}

            {hasConversation && (
              <div className="space-y-8">
                {conversationQuery && <UserBubble query={conversationQuery} />}

                {activePlan && !hasResult && (
                  <div className="mx-auto max-w-[820px]">
                    <ResearchPlanPanel
                      plan={activePlan}
                      isLoading={isLoading}
                      onEdit={handleEditPlan}
                      onCancel={handleCancelPlan}
                      onStart={handleStartResearch}
                    />
                  </div>
                )}

                {isPlanning && (
                  <div className="mx-auto flex max-w-[720px] items-center gap-3 rounded-[18px] border border-border bg-card p-5 text-muted-foreground shadow-sm">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm">Generating a query-specific research plan...</span>
                  </div>
                )}

                {isLoading && (
                  <div className="mx-auto max-w-[900px]">
                    <LoadingState />
                  </div>
                )}

                {error && !isLoading && (
                  <div className="mx-auto max-w-[720px]">
                    <ErrorState error={error} />
                  </div>
                )}

                {hasResult && (
                  <div className="mx-auto w-full max-w-4xl xl:hidden">
                    <ResultsDisplay result={result} />
                  </div>
                )}

                {hasResult && (
                  <div className="mx-auto hidden w-full max-w-[720px] xl:block">
                    <div className="rounded-[18px] border border-border bg-card p-5 shadow-sm">
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
                          <CheckCircle2 className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-foreground">Research report generated</p>
                          <p className="mt-1 text-sm leading-6 text-muted-foreground">
                            I opened the full report in the artifact panel on the right. Continue asking follow-up questions here.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <div ref={conversationEndRef} className="h-1" />
              </div>
            )}
          </div>
        </div>

        <div className="pointer-events-none absolute bottom-0 left-0 right-0 z-40 px-4 pb-4 pt-10">
          <SearchForm
            query={localQuery}
            isLoading={isLoading}
            isPlanning={isPlanning}
            hasPlan={Boolean(activePlan)}
            onQueryChange={handleQueryChange}
            onCreatePlan={handleCreatePlan}
            onStartResearch={handleStartResearch}
            onStop={handleStop}
          />
          <p className="mx-auto mt-2 max-w-3xl text-center text-xs text-muted-foreground">
            deepresearch can make mistakes. Check important info.
          </p>
        </div>
      </main>

      {hasResult && <ReportSidebar result={result} />}
    </div>
  );
}
