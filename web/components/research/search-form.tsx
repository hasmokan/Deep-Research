'use client';

/**
 * Bottom chat composer for deep research mode.
 */

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
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
  onQueryChange: (query: string) => void;
  onCreatePlan: () => void | Promise<void>;
  onStartResearch: () => void;
  onStop: () => void;
}

export function SearchForm({
  query,
  isLoading,
  isPlanning = false,
  hasPlan,
  onQueryChange,
  onCreatePlan,
  onStartResearch,
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

    if (!currentQuery) {
      return;
    }

    if (hasPlan) {
      onStartResearch();
      return;
    }

    onCreatePlan();
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="pointer-events-auto mx-auto w-full max-w-3xl rounded-[24px] border border-border bg-card/96 p-2.5 shadow-[0_18px_70px_rgba(0,0,0,0.16)] backdrop-blur-2xl dark:shadow-[0_18px_70px_rgba(0,0,0,0.45)]"
    >
      <Textarea
        placeholder="Get a detailed report"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        disabled={isLoading || isPlanning}
        rows={2}
        className="min-h-12 resize-none border-0 bg-transparent px-4 py-2 text-base shadow-none focus-visible:ring-0"
      />

      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-full"
            aria-label="Add attachment"
          >
            <Plus className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="h-9 rounded-full px-3 text-sm text-foreground"
          >
            <SlidersHorizontal className="h-4 w-4" />
            Deep research
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="h-9 rounded-full px-3 text-sm"
          >
            <Grid2X2 className="h-4 w-4" />
            Apps
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="h-9 rounded-full px-3 text-sm"
          >
            <Globe2 className="h-4 w-4" />
            Sites
          </Button>
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            className="hidden h-9 rounded-full px-3 text-sm text-muted-foreground sm:inline-flex"
          >
            Pro
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-full"
            aria-label="Voice input"
          >
            <Mic className="h-4 w-4" />
          </Button>
          <Button
            type="submit"
            disabled={(!currentQuery && !isLoading) || isPlanning}
            size="icon"
            className="h-10 w-10 rounded-full bg-foreground text-background hover:bg-foreground/90"
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
