# Frontend Development Guide

Next.js frontend development guidelines based on shadcn/ui component library.

## Tech Stack

- **Framework**: Next.js 16+ (App Router)
- **UI Components**: shadcn/ui (Radix UI primitives)
- **Styling**: Tailwind CSS v4 + CSS Variables
- **Language**: TypeScript (strict mode)
- **Forms**: react-hook-form + zod
- **State**: Zustand (client) / React Server Components (server)
- **Icons**: Lucide React

## Directory Structure

```
web/
├── app/                      # App Router pages
│   ├── (auth)/              # Auth route group
│   ├── (dashboard)/         # Dashboard route group
│   ├── api/                 # Route Handlers
│   ├── layout.tsx           # Root layout
│   └── globals.css          # Global styles + CSS Variables
├── components/
│   ├── ui/                  # shadcn/ui base components (DO NOT MODIFY)
│   ├── forms/               # Form components
│   ├── layouts/             # Layout components
│   └── features/            # Feature module components
│       ├── search/          # Search feature
│       ├── report/          # Report feature
│       └── chat/            # Chat feature
├── hooks/                   # Custom Hooks
├── lib/
│   ├── api/                 # API client
│   ├── utils.ts             # Utility functions (cn, etc.)
│   └── validations/         # Zod schemas
├── stores/                  # Zustand stores
└── types/                   # TypeScript type definitions
```

---

## 1. Component Design Principles

### Server vs Client Components

```tsx
// ✅ Default to Server Components
// app/research/page.tsx
import { SearchResults } from '@/components/features/search/SearchResults'

export default async function ResearchPage() {
  const data = await fetchResearchData()  // Server-side data fetching
  return <SearchResults data={data} />
}

// ✅ Use Client Components only when interactivity is needed
// components/features/search/SearchInput.tsx
'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

export function SearchInput({ onSearch }: { onSearch: (q: string) => void }) {
  const [query, setQuery] = useState('')
  return (
    <div className="flex gap-2">
      <Input value={query} onChange={(e) => setQuery(e.target.value)} />
      <Button onClick={() => onSearch(query)}>Search</Button>
    </div>
  )
}
```

### File Naming Conventions

| Type | Convention | Example |
|------|-----------|---------|
| Component files | PascalCase | `SearchPanel.tsx` |
| Page files | lowercase | `page.tsx`, `layout.tsx` |
| Hooks | camelCase + use prefix | `useSearch.ts` |
| Utility functions | camelCase | `formatDate.ts` |
| Type definitions | camelCase | `research.types.ts` |

---

## 2. shadcn/ui Usage Guidelines

### Installing New Components

```bash
# Use CLI to add components
pnpm dlx shadcn@latest add button card dialog

# Components will be installed to components/ui/
```

### Component Usage Principles

```tsx
// ✅ Correct: Use shadcn/ui components directly
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'

// ✅ Correct: Compose shadcn/ui to create business components
// components/features/report/ReportCard.tsx
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

interface ReportCardProps {
  title: string
  status: 'draft' | 'published'
  children: React.ReactNode
}

export function ReportCard({ title, status, children }: ReportCardProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{title}</CardTitle>
          <Badge variant={status === 'published' ? 'default' : 'secondary'}>
            {status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

// ❌ Wrong: Directly modify source files under components/ui/
// ❌ Wrong: Reinvent the wheel, not using existing components
```

### Common Components Quick Reference

| Scenario | Components |
|----------|------------|
| Button actions | `Button`, `IconButton` |
| Form inputs | `Input`, `Textarea`, `Select`, `Checkbox`, `Switch` |
| Data display | `Card`, `Table`, `Badge`, `Avatar` |
| Feedback | `Toast` (sonner), `Alert`, `AlertDialog` |
| Navigation | `Tabs`, `NavigationMenu`, `Breadcrumb` |
| Overlays | `Dialog`, `Sheet`, `Popover`, `Tooltip` |
| Layout | `Separator`, `ScrollArea`, `Collapsible` |

---

## 3. Styling Guidelines

### Tailwind CSS Class Order

Follow logical grouping: layout → size → spacing → typography → color → effects → state

```tsx
// ✅ Correct class order
<div className="
  flex items-center justify-between    {/* layout */}
  w-full max-w-2xl h-12                {/* size */}
  px-4 py-2 gap-3                      {/* spacing */}
  text-sm font-medium                  {/* typography */}
  bg-background text-foreground        {/* color */}
  rounded-lg shadow-sm                 {/* effects */}
  hover:bg-accent transition-colors    {/* state */}
">
```

### CSS Variables (Theme Colors)

```tsx
// ✅ Use semantic color variables
<div className="bg-background text-foreground" />
<div className="bg-muted text-muted-foreground" />
<div className="bg-primary text-primary-foreground" />
<div className="border-border" />
<div className="text-destructive" />

// ❌ Avoid hardcoded colors
<div className="bg-white text-black" />  // Doesn't support dark mode
<div className="bg-[#1a1a1a]" />         // Not semantic enough
```

### cn() Utility Function

```tsx
import { cn } from '@/lib/utils'

interface ButtonProps {
  variant?: 'default' | 'outline'
  className?: string
}

export function CustomButton({ variant = 'default', className }: ButtonProps) {
  return (
    <button
      className={cn(
        // Base styles
        'inline-flex items-center justify-center rounded-md px-4 py-2',
        // Variant styles
        variant === 'default' && 'bg-primary text-primary-foreground',
        variant === 'outline' && 'border border-input bg-background',
        // External className (can override)
        className
      )}
    />
  )
}
```

---

## 4. Form Handling Guidelines

### Zod Schema Definition

```tsx
// lib/validations/research.ts
import { z } from 'zod'

export const searchSchema = z.object({
  query: z.string().min(1, 'Please enter search content').max(500, 'Search content too long'),
  filters: z.object({
    dateRange: z.enum(['week', 'month', 'year', 'all']).default('all'),
    sources: z.array(z.string()).optional(),
  }).optional(),
})

export type SearchFormData = z.infer<typeof searchSchema>
```

### react-hook-form + shadcn/ui Integration

```tsx
'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { searchSchema, type SearchFormData } from '@/lib/validations/research'

import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

export function SearchForm({ onSubmit }: { onSubmit: (data: SearchFormData) => void }) {
  const form = useForm<SearchFormData>({
    resolver: zodResolver(searchSchema),
    defaultValues: {
      query: '',
    },
  })

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="query"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Search Content</FormLabel>
              <FormControl>
                <Input placeholder="Enter research topic..." {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? 'Searching...' : 'Start Search'}
        </Button>
      </form>
    </Form>
  )
}
```

---

## 5. State Management Guidelines

### Zustand Store Pattern

```tsx
// stores/research-store.ts
import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'

interface ResearchState {
  // State
  query: string
  results: SearchResult[]
  isLoading: boolean

  // Actions
  setQuery: (query: string) => void
  search: (query: string) => Promise<void>
  reset: () => void
}

export const useResearchStore = create<ResearchState>()(
  devtools(
    persist(
      (set, get) => ({
        // Initial state
        query: '',
        results: [],
        isLoading: false,

        // Actions
        setQuery: (query) => set({ query }),

        search: async (query) => {
          set({ isLoading: true, query })
          try {
            const results = await searchAPI(query)
            set({ results, isLoading: false })
          } catch (error) {
            set({ isLoading: false })
            throw error
          }
        },

        reset: () => set({ query: '', results: [], isLoading: false }),
      }),
      { name: 'research-store' }
    )
  )
)
```

### Usage in Components

```tsx
'use client'

import { useResearchStore } from '@/stores/research-store'

export function SearchResults() {
  // ✅ Selective subscription to avoid unnecessary re-renders
  const results = useResearchStore((state) => state.results)
  const isLoading = useResearchStore((state) => state.isLoading)

  // ❌ Avoid subscribing to entire store
  // const store = useResearchStore()

  if (isLoading) return <Skeleton />
  return <ResultsList results={results} />
}
```

---

## 6. API Calling Guidelines

### API Client Wrapper

```tsx
// lib/api/client.ts
const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

class APIClient {
  private async request<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const res = await fetch(`${API_BASE}${endpoint}`, {
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      ...options,
    })

    if (!res.ok) {
      throw new APIError(res.status, await res.text())
    }

    return res.json()
  }

  // Research APIs
  research = {
    search: (query: string) =>
      this.request<SearchResult[]>('/api/research', {
        method: 'POST',
        body: JSON.stringify({ query }),
      }),

    getReport: (id: string) =>
      this.request<Report>(`/api/reports/${id}`),
  }
}

export const api = new APIClient()
```

### Server Actions (Recommended)

```tsx
// app/actions/research.ts
'use server'

import { revalidatePath } from 'next/cache'
import { searchSchema } from '@/lib/validations/research'

export async function searchAction(formData: FormData) {
  const validated = searchSchema.safeParse({
    query: formData.get('query'),
  })

  if (!validated.success) {
    return { error: validated.error.flatten() }
  }

  const results = await fetch(`${process.env.API_URL}/api/research`, {
    method: 'POST',
    body: JSON.stringify(validated.data),
  }).then(r => r.json())

  revalidatePath('/research')
  return { data: results }
}
```

---

## 7. Responsive Design

### Breakpoint Usage

```tsx
// Tailwind default breakpoints
// sm: 640px, md: 768px, lg: 1024px, xl: 1280px, 2xl: 1536px

// ✅ Mobile-first approach
<div className="
  flex flex-col          {/* default: mobile vertical layout */}
  md:flex-row            {/* medium screen: horizontal layout */}
  gap-4 md:gap-6         {/* responsive spacing */}
">
  <aside className="w-full md:w-64 lg:w-80">Sidebar</aside>
  <main className="flex-1">Main content</main>
</div>
```

### Container Queries (Recommended)

```tsx
// Container-based responsive instead of viewport-based
<div className="@container">
  <div className="@md:flex @md:gap-4">
    {/* Apply flex layout when container width >= 28rem */}
  </div>
</div>
```

---

## 8. Dark Mode

### Configuration

```tsx
// app/layout.tsx
import { ThemeProvider } from '@/components/providers/theme-provider'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
```

### Theme Toggle Component

```tsx
'use client'

import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Button } from '@/components/ui/button'

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
    >
      <Sun className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
      <span className="sr-only">Toggle theme</span>
    </Button>
  )
}
```

---

## 9. Performance Optimization

### Image Optimization

```tsx
import Image from 'next/image'

// ✅ Use Next.js Image component
<Image
  src="/research-hero.png"
  alt="Research"
  width={800}
  height={400}
  priority                    // Above-the-fold images
  className="rounded-lg"
/>
```

### Dynamic Imports

```tsx
import dynamic from 'next/dynamic'

// Lazy load heavy components
const ReportEditor = dynamic(
  () => import('@/components/features/report/ReportEditor'),
  {
    loading: () => <Skeleton className="h-96" />,
    ssr: false,  // Client-side rendering only
  }
)
```

### Suspense Boundaries

```tsx
import { Suspense } from 'react'
import { SearchResults } from '@/components/features/search/SearchResults'
import { Skeleton } from '@/components/ui/skeleton'

export default function ResearchPage() {
  return (
    <div>
      <h1>Research Results</h1>
      <Suspense fallback={<Skeleton className="h-64" />}>
        <SearchResults />
      </Suspense>
    </div>
  )
}
```

---

## Common Commands

```bash
# Development server
pnpm dev

# Type checking
pnpm type-check

# Linting
pnpm lint

# Build
pnpm build

# Add shadcn/ui component
pnpm dlx shadcn@latest add <component-name>
```

## Environment Variables

```bash
# .env.local
NEXT_PUBLIC_API_URL=http://localhost:8000
```
