'use client';

/**
 * Floating glassmorphism header with navigation and theme toggle
 */

import { Search, Sparkles, Github } from 'lucide-react';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { Button } from '@/components/ui/button';

export function Header() {
  return (
    <header className="fixed top-4 left-4 right-4 z-50">
      <nav className="glass-strong mx-auto max-w-5xl rounded-2xl px-4 py-3">
        <div className="flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary">
              <Sparkles className="h-5 w-5 text-primary-foreground" />
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-foreground">
                Deep Research
              </span>
              <span className="text-xs text-muted-foreground">
                AI-Powered
              </span>
            </div>
          </div>

          {/* Navigation */}
          <div className="hidden md:flex items-center gap-1">
            <Button variant="ghost" size="sm" className="gap-2 cursor-pointer">
              <Search className="h-4 w-4" />
              Search
            </Button>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 cursor-pointer"
              asChild
            >
              <a
                href="https://github.com"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="GitHub"
              >
                <Github className="h-4 w-4" />
              </a>
            </Button>
            <ThemeToggle />
          </div>
        </div>
      </nav>
    </header>
  );
}
