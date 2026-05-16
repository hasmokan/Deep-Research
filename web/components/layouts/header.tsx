'use client';

/**
 * Floating monochrome header with compact research navigation
 */

import { Github, Search, Sparkles } from 'lucide-react';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { Button } from '@/components/ui/button';

export function Header() {
  return (
    <header className="fixed top-4 left-4 right-4 z-50">
      <nav className="glass-strong shadow-premium mx-auto max-w-6xl rounded-[8px] px-3 py-2.5">
        <div className="flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-[7px] bg-primary shadow-sm">
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
          <div className="hidden items-center gap-1 md:flex">
            <Button variant="ghost" size="sm" className="h-8 gap-2 rounded-[7px] cursor-pointer">
              <Search className="h-4 w-4" />
              Search
            </Button>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-[7px] cursor-pointer"
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
