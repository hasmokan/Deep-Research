'use client';

/**
 * Research search form component with glassmorphism design
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { apiClient } from '@/lib/api';
import { useResearchStore } from '@/lib/store/research';
import { Search, RotateCcw, Loader2 } from 'lucide-react';

export function SearchForm() {
  const [localQuery, setLocalQuery] = useState('');
  const { isLoading, setQuery, setLoading, setError, setResult } = useResearchStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!localQuery.trim()) {
      setError('Please enter a research query');
      return;
    }

    try {
      setQuery(localQuery);
      setLoading(true);
      setError(null);
      setResult(null);

      const result = await apiClient.executeResearch({ query: localQuery });
      setResult(result);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setLocalQuery('');
    setQuery('');
    setError(null);
    setResult(null);
  };

  return (
    <div className="glass-strong rounded-2xl p-6">
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Search Input */}
        <div className="relative">
          <Textarea
            placeholder="Enter your research query... (e.g., Latest trends in artificial intelligence)"
            value={localQuery}
            onChange={(e) => setLocalQuery(e.target.value)}
            rows={3}
            disabled={isLoading}
            className="resize-none bg-background/50 border-border/50 focus:border-primary focus:ring-primary/20 rounded-xl text-base placeholder:text-muted-foreground/60 transition-smooth"
          />
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <Button
            type="submit"
            disabled={isLoading || !localQuery.trim()}
            className="flex-1 h-11 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-medium cursor-pointer transition-smooth"
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Researching...
              </>
            ) : (
              <>
                <Search className="mr-2 h-4 w-4" />
                Start Research
              </>
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleReset}
            disabled={isLoading}
            className="h-11 px-4 rounded-xl border-border/50 hover:bg-secondary cursor-pointer transition-smooth"
          >
            <RotateCcw className="h-4 w-4" />
            <span className="sr-only md:not-sr-only md:ml-2">Reset</span>
          </Button>
        </div>

        {/* Helper Text */}
        <p className="text-xs text-muted-foreground text-center">
          Press Enter to search or click the button above
        </p>
      </form>
    </div>
  );
}
