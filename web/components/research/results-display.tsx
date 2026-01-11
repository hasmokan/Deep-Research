'use client';

/**
 * Research results display component with modern card design
 */

import { FileText, Brain, BookOpen, ExternalLink, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ReactMarkdown from 'react-markdown';
import type { ResearchResult } from '@/lib/api/types';
import { useState } from 'react';

interface ResultsDisplayProps {
  result: ResearchResult;
}

interface CollapsibleSectionProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

function CollapsibleSection({
  title,
  description,
  icon,
  defaultOpen = true,
  children,
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="glass-card rounded-2xl overflow-hidden transition-smooth">
      {/* Header */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-5 cursor-pointer hover:bg-accent/5 transition-smooth"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
            {icon}
          </div>
          <div className="text-left">
            <h3 className="font-semibold text-foreground">{title}</h3>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
        </div>
        <div className="text-muted-foreground">
          {isOpen ? (
            <ChevronUp className="h-5 w-5" />
          ) : (
            <ChevronDown className="h-5 w-5" />
          )}
        </div>
      </button>

      {/* Content */}
      {isOpen && (
        <div className="px-5 pb-5 pt-0">
          <div className="border-t border-border/50 pt-5">
            {children}
          </div>
        </div>
      )}
    </div>
  );
}

export function ResultsDisplay({ result }: ResultsDisplayProps) {
  const hasDocuments = result.documents && result.documents.length > 0;

  return (
    <div className="space-y-6">
      {/* Documents Summary */}
      <CollapsibleSection
        title="Search Results"
        description={`Found ${result.documents?.length || 0} relevant documents`}
        icon={<FileText className="h-5 w-5 text-primary" />}
        defaultOpen={true}
      >
        {hasDocuments ? (
          <div className="space-y-3">
            {result.documents.slice(0, 5).map((doc, index) => (
              <div
                key={doc.id}
                className="group p-4 rounded-xl bg-background/50 border border-border/30 hover:border-primary/30 cursor-pointer transition-smooth"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-xs font-medium text-primary">
                        {index + 1}
                      </span>
                      <span className="text-sm font-medium text-foreground">
                        Document {index + 1}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {doc.content}
                    </p>
                  </div>
                  {doc.similarity !== undefined && (
                    <div className="flex flex-col items-end gap-1">
                      <span className="text-xs font-medium text-primary">
                        {(doc.similarity * 100).toFixed(0)}%
                      </span>
                      <span className="text-xs text-muted-foreground">
                        match
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {result.documents.length > 5 && (
              <Button variant="ghost" className="w-full cursor-pointer">
                Show {result.documents.length - 5} more documents
                <ExternalLink className="ml-2 h-4 w-4" />
              </Button>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">
            No documents found for this query
          </p>
        )}
      </CollapsibleSection>

      {/* Analysis */}
      {result.analysis && (
        <CollapsibleSection
          title="AI Analysis"
          description="Intelligent insights from documents"
          icon={<Brain className="h-5 w-5 text-primary" />}
          defaultOpen={true}
        >
          <div className="prose prose-sm dark:prose-invert max-w-none prose-headings:text-foreground prose-p:text-muted-foreground prose-strong:text-foreground prose-a:text-primary">
            <ReactMarkdown>{result.analysis}</ReactMarkdown>
          </div>
        </CollapsibleSection>
      )}

      {/* Research Report */}
      {result.report && (
        <CollapsibleSection
          title="Research Report"
          description="Comprehensive research findings"
          icon={<BookOpen className="h-5 w-5 text-primary" />}
          defaultOpen={true}
        >
          <div className="prose prose-sm dark:prose-invert max-w-none prose-headings:text-foreground prose-p:text-muted-foreground prose-strong:text-foreground prose-a:text-primary prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded">
            <ReactMarkdown>{result.report}</ReactMarkdown>
          </div>
        </CollapsibleSection>
      )}
    </div>
  );
}
