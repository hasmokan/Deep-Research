'use client';

/**
 * Bottom chat composer for deep research mode.
 */

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { getResearchSubmitAction } from '@/lib/research/research-workflow';
import {
  CircleStop,
  Globe2,
  Grid2X2,
  Loader2,
  Mic,
  Plus,
  Search,
  SendHorizontal,
  SlidersHorizontal,
} from 'lucide-react';

interface SearchFormProps {
  query: string;
  isLoading: boolean;
  isPlanning?: boolean;
  hasPlan: boolean;
  isDeepResearchMode: boolean;
  onQueryChange: (query: string) => void;
  onCreatePlan: () => void | Promise<void>;
  onStartResearch: (queryOverride?: string, options?: { skipPlan?: boolean }) => void;
  onToggleDeepResearchMode: () => void;
  onStop: () => void;
}

export function SearchForm({
  query,
  isLoading,
  isPlanning = false,
  hasPlan,
  isDeepResearchMode,
  onQueryChange,
  onCreatePlan,
  onStartResearch,
  onToggleDeepResearchMode,
  onStop,
}: SearchFormProps) {
  const currentQuery = query.trim();

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();

    if (isLoading) {
      onStop();
      return;
    }

    if (isPlanning) {
      return;
    }

    const action = getResearchSubmitAction({
      query: currentQuery,
      hasPlan,
      isDeepResearchMode,
    });

    if (action === 'none') {
      return;
    }

    if (action === 'start-research') {
      if (hasPlan && !currentQuery) {
        onStartResearch();
        return;
      }

      onStartResearch(currentQuery, { skipPlan: true });
      return;
    }

    onCreatePlan();
  };

  const handleTextareaKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="pointer-events-auto mx-auto w-full max-w-xl rounded-[18px] border border-border bg-card/96 p-2 shadow-[0_10px_36px_rgba(0,0,0,0.13)] backdrop-blur-2xl dark:shadow-[0_10px_36px_rgba(0,0,0,0.34)]"
    >
      <Textarea
        placeholder="Get a detailed report"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={handleTextareaKeyDown}
        disabled={isLoading || isPlanning}
        rows={2}
        className="min-h-9 resize-none border-0 bg-transparent px-3 py-1.5 text-sm shadow-none focus-visible:ring-0"
      />

      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full"
            aria-label="Add attachment"
          >
            <Plus className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant={isDeepResearchMode ? 'secondary' : 'ghost'}
            className="h-8 rounded-full px-2.5 text-xs"
            aria-pressed={isDeepResearchMode}
            onClick={onToggleDeepResearchMode}
          >
            <SlidersHorizontal className="h-4 w-4" />
            Deep research
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="h-8 rounded-full px-2.5 text-xs"
          >
            <Grid2X2 className="h-4 w-4" />
            Apps
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="h-8 rounded-full px-2.5 text-xs"
          >
            <Globe2 className="h-4 w-4" />
            Sites
          </Button>
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            className="hidden h-8 rounded-full px-2.5 text-xs text-muted-foreground sm:inline-flex"
          >
            Pro
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full"
            aria-label="Voice input"
          >
            <Mic className="h-4 w-4" />
          </Button>
          <Button
            type="submit"
            disabled={(!currentQuery && !isLoading) || isPlanning}
            size="icon"
            className="h-9 w-9 rounded-full bg-foreground text-background hover:bg-foreground/90"
            aria-label={isLoading ? 'Stop research' : isPlanning ? 'Creating plan' : hasPlan ? 'Start research' : 'Create plan'}
          >
            {isLoading ? (
              <CircleStop className="h-4 w-4" />
            ) : isPlanning ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : hasPlan ? (
              <Search className="h-4 w-4" />
            ) : (
              <SendHorizontal className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </form>
  );
}
