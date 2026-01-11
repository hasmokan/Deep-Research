# Code Review Checklist

## Must Check After Every Code Change

### General Checks

- [ ] No unused imports/variables
- [ ] No `console.log` / `print` debug statements left
- [ ] No hardcoded sensitive information
- [ ] No commented-out dead code blocks
- [ ] Functions/components under 200 lines
- [ ] Files under 400 lines

### Frontend Checks (TypeScript/React)

- [ ] Components have explicit Props type definitions
- [ ] Use semantic color variables (not hardcoded colors)
- [ ] Client Components have `'use client'` directive
- [ ] Forms use zod for validation
- [ ] Async operations have loading/error state handling
- [ ] List rendering has unique keys
- [ ] Images use Next.js Image component

### Backend Checks (Python/FastAPI)

- [ ] Functions have complete type annotations
- [ ] Async functions use `async/await`
- [ ] API routes have Pydantic model validation
- [ ] Exceptions have proper error handling
- [ ] Database operations in try-except blocks

### Performance Checks

- [ ] No N+1 query issues
- [ ] Large lists have pagination
- [ ] Repeated calculations have caching/memoization
- [ ] No unnecessary re-renders

## Automatic Violation Marking

Must warn user when encountering:

```
⚠️ Code Review Warning
- Found console.log at xxx.ts:42
- Component SearchPanel exceeds 200 lines, consider splitting
- Missing error boundary handling
```
