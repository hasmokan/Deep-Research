# Forbidden Operations

## Strictly Prohibited Operations

### Git Operations

- ❌ `git push --force` to main/master
- ❌ `git reset --hard` without confirmation
- ❌ Commit files with sensitive information
- ❌ Develop directly on main branch
- ❌ `git clean -fd` without confirmation

### File Operations

- ❌ Delete `package.json` / `requirements.txt`
- ❌ Delete `.gitignore`
- ❌ Delete entire `src/` / `app/` / `api/` directories
- ❌ Modify files in `node_modules/`
- ❌ Modify shadcn source files under `components/ui/`

### Code Practices

- ❌ Use `any` type (TypeScript)
- ❌ Use `// @ts-ignore` to bypass type checking
- ❌ Use `eval()` or `exec()`
- ❌ Hardcode API endpoints (use environment variables)
- ❌ Synchronous blocking operations in async functions

### Database Operations

- ❌ DELETE / UPDATE without WHERE clause
- ❌ DROP TABLE / DROP DATABASE (requires confirmation)
- ❌ Directly modify production database

## Operations Requiring Confirmation

Must ask user before executing:

```
⚠️ Dangerous Operation Confirmation

About to execute: {operation}
Scope of impact: {scope}
Risk level: {level}

Proceed? [y/N]
```

### Confirmation Required List

- Delete files/directories
- Modify configuration files
- Database migrations
- Environment variable changes
- Dependency version upgrades
- Git branch operations (merge, rebase)

## Violation Handling

When detecting violations:
1. Immediately stop execution
2. Display warning message
3. Provide safe alternatives
4. Wait for explicit user instruction
