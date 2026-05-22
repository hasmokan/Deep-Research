'use client';

/**
 * Compact inline failure state rendered inside the conversation.
 */

import { useState } from 'react';
import { AlertTriangle, Check, ChevronDown, Copy, MessageCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ErrorDiagnostics {
  requestId?: string | null;
  traceId?: string | null;
  runId?: string | null;
}

interface ErrorStateProps {
  error: string;
  diagnostics?: ErrorDiagnostics | null;
  onRetry?: () => void;
  onDirectAnswer?: () => void;
}

export function ErrorState({ error, diagnostics, onRetry, onDirectAnswer }: ErrorStateProps) {
  const [isDetailsOpen, setDetailsOpen] = useState(false);
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  const summary = getFriendlyErrorSummary(error);
  const diagnosticItems = [
    { label: 'Error ID', value: diagnostics?.requestId },
    { label: 'Trace', value: diagnostics?.traceId },
    { label: 'Run', value: diagnostics?.runId },
  ].filter((item): item is { label: string; value: string } => Boolean(item.value));

  const copyDiagnostic = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedValue(value);
      window.setTimeout(() => setCopiedValue((current) => (current === value ? null : current)), 1200);
    } catch {
      setCopiedValue(null);
    }
  };

  return (
    <div role="status" aria-live="polite" className="flex w-full justify-start">
      <div className="min-w-0 max-w-[min(680px,88%)]">
        <div className="mb-1.5 flex items-center gap-2 px-1 text-xs text-muted-foreground">
          <span className="font-medium text-foreground/80">Assistant</span>
          <span className="h-1 w-1 rounded-full bg-muted-foreground/50" aria-hidden="true" />
          <span>Interrupted</span>
        </div>

        <div className="rounded-[8px] border border-border/80 bg-card/90 px-3.5 py-3 shadow-sm">
          <div className="flex gap-3">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] bg-muted text-muted-foreground">
              <AlertTriangle className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">This response stopped</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">{summary}</p>
            </div>
          </div>

          {diagnosticItems.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5 pl-10">
              {diagnosticItems.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => {
                    void copyDiagnostic(item.value);
                  }}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-[7px] border border-border bg-background px-2 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-muted"
                  title={`Copy ${item.label}`}
                >
                  <span className="shrink-0 font-medium text-foreground/80">{item.label}</span>
                  <code className="max-w-[180px] truncate font-mono text-[11px] text-muted-foreground">
                    {item.value}
                  </code>
                  {copiedValue === item.value ? (
                    <Check className="h-3 w-3 shrink-0" />
                  ) : (
                    <Copy className="h-3 w-3 shrink-0" />
                  )}
                </button>
              ))}
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-1.5 pl-10">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!onRetry}
              onClick={onRetry}
              className="h-8 rounded-[7px] px-2.5"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Try again
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!onDirectAnswer}
              onClick={onDirectAnswer}
              className="h-8 rounded-[7px] px-2.5"
            >
              <MessageCircle className="h-3.5 w-3.5" />
              Direct answer
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-expanded={isDetailsOpen}
              onClick={() => setDetailsOpen((open) => !open)}
              className="h-8 rounded-[7px] px-2.5"
            >
              <ChevronDown
                className={cn(
                  'h-3.5 w-3.5 transition-transform',
                  isDetailsOpen && 'rotate-180',
                )}
              />
              Details
            </Button>
          </div>

          {isDetailsOpen && (
            <pre className="mt-3 max-h-36 overflow-auto whitespace-pre-wrap rounded-[7px] bg-muted/60 px-3 py-2 text-xs leading-5 text-muted-foreground">
              {error}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

function getFriendlyErrorSummary(error: string): string {
  const normalized = error.trim();
  const lower = normalized.toLowerCase();

  if (lower.includes('authentication') || lower.includes('token') || lower.includes('unauthorized')) {
    return 'Your session could not be verified. Refresh the page or sign in again before retrying.';
  }

  if (lower.includes('json') || lower.includes('plan')) {
    return 'The model returned a format the app could not read. Retry, or skip planning and answer directly.';
  }

  if (lower.includes('network') || lower.includes('fetch') || lower.includes('connection')) {
    return 'The connection dropped before the answer finished. Your question is still here.';
  }

  return 'The answer did not finish. You can retry from the same question or continue without a plan.';
}
