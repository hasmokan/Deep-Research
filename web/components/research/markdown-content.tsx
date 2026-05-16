'use client';

/**
 * Markdown renderer backed by markdown-it.
 */

import { useMemo } from 'react';
import { renderMarkdown } from '@/lib/research/markdown-renderer';
import { cn } from '@/lib/utils';

interface MarkdownContentProps {
  content: string | null | undefined;
  className?: string;
}

export function MarkdownContent({ content, className }: MarkdownContentProps) {
  const html = useMemo(() => renderMarkdown(content), [content]);

  return (
    <div
      className={cn('research-markdown', className)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
