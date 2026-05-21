'use client';

/**
 * Bottom chat composer for deep research mode.
 */

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { getResearchSubmitAction } from '@/lib/research/research-workflow';
import {
  CircleStop,
  Loader2,
  Search,
  SendHorizontal,
  SlidersHorizontal,
} from 'lucide-react';

interface SearchFormProps {
  query: string;
  isLoading: boolean;
  isPlanning?: boolean;
  isDisabled?: boolean;
  placeholder?: string;
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
  isDisabled = false,
  placeholder = 'Get a detailed report',
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

    if (isDisabled) {
      return;
    }

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
      className="pointer-events-auto mx-auto w-full max-w-2xl rounded-2xl border border-border bg-card/97 p-2 shadow-[0_10px_32px_rgba(0,0,0,0.12)] backdrop-blur-2xl dark:shadow-[0_10px_32px_rgba(0,0,0,0.32)]"
    >
      <Textarea
        placeholder={placeholder}
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={handleTextareaKeyDown}
        disabled={isDisabled || isLoading || isPlanning}
        rows={2}
        className="min-h-10 resize-none border-0 bg-transparent px-3 py-2 text-sm shadow-none focus-visible:ring-0"
      />

      <div className="flex items-center justify-between gap-3 px-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <Button
            type="button"
            variant={isDeepResearchMode ? 'secondary' : 'ghost'}
            className="h-8 rounded-lg px-2.5 text-xs"
            aria-pressed={isDeepResearchMode}
            disabled={isDisabled}
            onClick={onToggleDeepResearchMode}
          >
            <SlidersHorizontal className="h-4 w-4" />
            Deep research
          </Button>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            type="submit"
            disabled={isDisabled || (!currentQuery && !isLoading) || isPlanning}
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
