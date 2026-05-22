'use client';

/**
 * Right-side report artifact panel for completed research.
 */

import { CheckCircle2, Download, ExternalLink, FileText, Maximize2, X } from 'lucide-react';
import type { Document, ResearchResult } from '@/lib/api/types';
import { Button } from '@/components/ui/button';
import { useResizablePanel } from '@/lib/research/resizable-panels';
import { MarkdownContent } from './markdown-content';

interface ReportSidebarProps {
  result: ResearchResult;
  variant?: 'desktop' | 'drawer';
  onExpand?: () => void;
  onClose?: () => void;
}

const REPORT_SIDEBAR_WIDTH = {
  defaultWidth: 480,
  constraints: { min: 360, max: 720 },
};

function getDocumentTitle(document: Document, index: number) {
  const title = document.metadata.title;
  const source = document.metadata.source;

  if (typeof title === 'string' && title.trim()) {
    return title;
  }
  if (typeof source === 'string' && source.trim()) {
    return source;
  }
  return `Source ${index + 1}`;
}

function getDocumentUrl(document: Document) {
  const url = document.metadata.url ?? document.metadata.href;
  return typeof url === 'string' && url.startsWith('http') ? url : null;
}

export function ReportSidebar({
  result,
  variant = 'desktop',
  onExpand,
  onClose,
}: ReportSidebarProps) {
  const hasDocuments = result.documents && result.documents.length > 0;
  const sidebarWidth = useResizablePanel({
    defaultWidth: REPORT_SIDEBAR_WIDTH.defaultWidth,
    constraints: REPORT_SIDEBAR_WIDTH.constraints,
    edge: 'left',
  });

  return (
    <aside
      className={`animate-report-sidebar-in relative h-dvh shrink-0 border-l border-border bg-muted/35 ${
        variant === 'drawer' ? 'flex w-[min(92vw,520px)] flex-col' : 'hidden xl:flex xl:flex-col'
      }`}
      style={variant === 'desktop' ? { width: sidebarWidth.width } : undefined}
    >
      <div
        role="separator"
        aria-label="Resize report panel"
        aria-orientation="vertical"
        aria-valuemin={REPORT_SIDEBAR_WIDTH.constraints.min}
        aria-valuemax={REPORT_SIDEBAR_WIDTH.constraints.max}
        aria-valuenow={sidebarWidth.width}
        tabIndex={0}
        className={`absolute -left-1 top-0 z-50 h-full w-2 cursor-col-resize touch-none outline-none transition-colors hover:bg-foreground/10 focus-visible:bg-foreground/15 ${
          variant === 'desktop' ? 'hidden xl:block' : 'hidden'
        }`}
        onMouseDown={sidebarWidth.startResize}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') {
            event.preventDefault();
            sidebarWidth.resizeBy(16);
          }
          if (event.key === 'ArrowRight') {
            event.preventDefault();
            sidebarWidth.resizeBy(-16);
          }
        }}
      />
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-card/95 px-4 backdrop-blur-xl">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">
            {result.query}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">Research report</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full"
            aria-label="Expand report"
            title="Expand report"
            onClick={onExpand}
          >
            <Maximize2 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full"
            aria-label="Export report"
            title="Export report"
          >
            <Download className="h-4 w-4" />
          </Button>
          {onClose && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full"
              aria-label="Close report"
              title="Close report"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="mx-auto max-w-[440px] rounded-[12px] border border-border bg-card px-4 py-4 shadow-[0_10px_36px_rgba(0,0,0,0.07)] dark:shadow-[0_10px_36px_rgba(0,0,0,0.28)]">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-muted/60 px-2.5 py-1 text-xs text-muted-foreground">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Research complete
          </div>

          {result.report ? (
            <MarkdownContent content={result.report} />
          ) : (
            <p className="text-sm leading-6 text-muted-foreground">
              No report text was returned. The analysis notes may still contain useful findings.
            </p>
          )}

          <section className="mt-8 rounded-[14px] border border-border bg-muted/35 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-foreground" />
                <h3 className="text-sm font-semibold text-foreground">Sources</h3>
              </div>
              <span className="rounded-full border border-border bg-card px-2 py-1 text-xs text-muted-foreground">
                {result.documents?.length || 0}
              </span>
            </div>

            {hasDocuments ? (
              <div className="space-y-2">
                {result.documents.slice(0, 6).map((document, index) => {
                  const url = getDocumentUrl(document);

                  return (
                    <div key={document.id} className="flex items-start justify-between gap-3 rounded-[12px] bg-card p-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">
                          {getDocumentTitle(document, index)}
                        </p>
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                          {document.content}
                        </p>
                      </div>
                      {url && (
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Open source ${index + 1}`}
                          className="shrink-0 text-muted-foreground transition-smooth hover:text-foreground"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm leading-6 text-muted-foreground">
                No source documents were returned for this run.
              </p>
            )}
          </section>
        </div>
      </div>
    </aside>
  );
}
