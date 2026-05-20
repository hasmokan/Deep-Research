'use client';

/**
 * Compact research completion summary rendered inline in the conversation.
 * The full report body belongs in the artifact panel, not the chat timeline.
 */

import { BrainCircuit, CheckCircle2, ExternalLink, FileText } from 'lucide-react';
import type { Document, ResearchResult } from '@/lib/api/types';

interface ResultsDisplayProps {
  result: ResearchResult;
}

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

export function ResultsDisplay({ result }: ResultsDisplayProps) {
  const thinkingSections = [
    { title: 'Analysis thinking', content: result.analysis_thinking },
    { title: 'Report thinking', content: result.report_thinking },
  ].filter((section) => section.content);
  const hasDocuments = result.documents && result.documents.length > 0;

  return (
    <div className="mx-auto w-full max-w-[760px] space-y-6">
      <div className="flex gap-4">
        <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
          <BrainCircuit className="h-4 w-4" />
        </div>
        <article className="min-w-0 flex-1">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Research complete
          </div>

          {result.report ? (
            <div className="rounded-[16px] border border-border bg-card p-4">
              <p className="text-sm font-semibold text-foreground">Research report generated</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                The full report is available in the artifact panel. The conversation keeps only the research steps,
                status, sources, and model thinking process.
              </p>
            </div>
          ) : (
            <p className="text-base leading-7 text-muted-foreground">
              No report text was returned. The analysis notes below may still contain useful findings.
            </p>
          )}
        </article>
      </div>

      <div className="ml-12 grid gap-3 md:grid-cols-2">
        <section className="rounded-[16px] border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-foreground" />
              <h3 className="text-sm font-semibold text-foreground">Sources used</h3>
            </div>
            <span className="rounded-full border border-border px-2 py-1 text-xs text-muted-foreground">
              {result.documents?.length || 0}
            </span>
          </div>

          {hasDocuments ? (
            <div className="space-y-2">
              {result.documents.slice(0, 4).map((document, index) => {
                const url = getDocumentUrl(document);

                return (
                  <div key={document.id} className="flex items-start justify-between gap-3 rounded-[12px] bg-muted/50 p-3">
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

        <section className="rounded-[16px] border border-border bg-card p-4">
          <div className="mb-3 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-foreground" />
            <h3 className="text-sm font-semibold text-foreground">Activity history</h3>
          </div>
          <div className="space-y-3">
            {[
              `Searched ${result.documents?.length || 0} source candidates`,
              result.analysis ? 'Compared evidence and uncertainty' : 'No analysis returned',
              result.report ? 'Prepared final answer' : 'No report returned',
            ].map((item) => (
              <div key={item} className="flex gap-3">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-foreground" />
                <p className="text-sm leading-5 text-muted-foreground">{item}</p>
              </div>
            ))}
          </div>

          {thinkingSections.length > 0 && (
            <details className="mt-4 rounded-[12px] bg-muted/50 p-3">
              <summary className="cursor-pointer text-sm font-medium text-foreground">
                Model thinking details
              </summary>
              <div className="mt-3 space-y-3">
                {thinkingSections.map((section) => (
                  <div key={section.title}>
                    <p className="mb-1 text-xs font-medium text-foreground">{section.title}</p>
                    <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-words rounded-[10px] border border-border bg-card p-3 text-xs leading-5 text-muted-foreground">
                      {section.content}
                    </pre>
                  </div>
                ))}
              </div>
            </details>
          )}
        </section>
      </div>
    </div>
  );
}
