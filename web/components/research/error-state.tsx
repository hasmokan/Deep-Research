'use client';

/**
 * Error state component with friendly design
 */

import { AlertCircle, RotateCcw, HelpCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useResearchStore } from '@/lib/store/research';

interface ErrorStateProps {
  error: string;
}

export function ErrorState({ error }: ErrorStateProps) {
  const { reset } = useResearchStore();

  return (
    <div className="glass-strong shadow-premium rounded-[8px] border-destructive/20 p-8">
      <div className="flex flex-col items-center text-center space-y-6">
        {/* Icon */}
        <div className="flex h-16 w-16 items-center justify-center rounded-[8px] bg-destructive/10">
          <AlertCircle className="h-8 w-8 text-destructive" />
        </div>

        {/* Message */}
        <div className="space-y-2">
          <h3 className="text-lg font-semibold text-foreground">
            Something went wrong
          </h3>
          <p className="text-sm text-muted-foreground max-w-md">
            {error}
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3">
          <Button
            onClick={reset}
            className="gap-2 rounded-[7px] cursor-pointer transition-smooth"
          >
            <RotateCcw className="h-4 w-4" />
            Try Again
          </Button>
          <Button
            variant="outline"
            className="gap-2 rounded-[7px] cursor-pointer transition-smooth"
            asChild
          >
            <a
              href="https://github.com"
              target="_blank"
              rel="noopener noreferrer"
            >
              <HelpCircle className="h-4 w-4" />
              Get Help
            </a>
          </Button>
        </div>

        {/* Suggestions */}
        <div className="w-full max-w-md pt-4 border-t border-border/50">
          <p className="text-xs text-muted-foreground mb-3">
            Common solutions:
          </p>
          <ul className="text-xs text-muted-foreground space-y-1.5 text-left">
            <li className="flex items-start gap-2">
              <span className="text-foreground">-</span>
              Check your internet connection
            </li>
            <li className="flex items-start gap-2">
              <span className="text-foreground">-</span>
              Try a simpler or more specific query
            </li>
            <li className="flex items-start gap-2">
              <span className="text-foreground">-</span>
              Wait a moment and try again
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
