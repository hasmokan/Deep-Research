'use client';

/**
 * Main research page with Hero-centric layout
 */

import { useResearchStore } from '@/lib/store/research';
import { SearchForm, LoadingState, ResultsDisplay, ErrorState } from '@/components/research';
import { Header } from '@/components/layouts/header';
import { Sparkles, FileSearch, FileText, Zap } from 'lucide-react';

export default function Home() {
  const { isLoading, error, result } = useResearchStore();

  const hasResult = result && !isLoading && !error;

  return (
    <div className="min-h-screen bg-background gradient-mesh">
      {/* Header */}
      <Header />

      {/* Main Content */}
      <main className="relative pt-28 pb-16">
        <div className="container mx-auto px-4 max-w-5xl">
          <div className="space-y-12">
            {/* Hero Section */}
            {!hasResult && (
              <section className="text-center space-y-6 py-8">
                {/* Badge */}
                <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-1.5 text-sm font-medium text-primary">
                  <Sparkles className="h-4 w-4" />
                  <span>AI-Powered Research</span>
                </div>

                {/* Title */}
                <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight text-foreground">
                  Deep Research
                  <span className="block text-primary mt-2">Intelligence</span>
                </h1>

                {/* Description */}
                <p className="max-w-2xl mx-auto text-lg text-muted-foreground">
                  Harness the power of AI to search, analyze, and generate comprehensive research reports from your documents.
                </p>

                {/* Features */}
                <div className="flex flex-wrap justify-center gap-6 pt-4">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                      <FileSearch className="h-4 w-4 text-primary" />
                    </div>
                    <span>Semantic Search</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                      <Zap className="h-4 w-4 text-primary" />
                    </div>
                    <span>AI Analysis</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                      <FileText className="h-4 w-4 text-primary" />
                    </div>
                    <span>Report Generation</span>
                  </div>
                </div>
              </section>
            )}

            {/* Search Form */}
            <section className={hasResult ? '' : 'max-w-2xl mx-auto'}>
              <SearchForm />
            </section>

            {/* Loading State */}
            {isLoading && (
              <section className="max-w-2xl mx-auto">
                <LoadingState />
              </section>
            )}

            {/* Error State */}
            {error && !isLoading && (
              <section className="max-w-2xl mx-auto">
                <ErrorState error={error} />
              </section>
            )}

            {/* Results Display */}
            {hasResult && (
              <section>
                <ResultsDisplay result={result} />
              </section>
            )}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border py-8">
        <div className="container mx-auto px-4 max-w-5xl">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
            <p>Deep Research - AI-Powered Intelligence</p>
            <p>Built with Next.js, LangGraph & Supabase</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
