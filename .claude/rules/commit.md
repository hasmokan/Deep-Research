# Git Commit Guidelines

## Commit Format (Required)

```
<type>(<scope>): <subject>

<body>
```

## Type (Required)

| Type | Description |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation changes |
| `style` | Code formatting (no functional changes) |
| `refactor` | Refactoring (neither new feature nor bug fix) |
| `perf` | Performance optimization |
| `test` | Test related |
| `chore` | Build/tooling changes |

## Scope (Recommended)

- `web` - Frontend related
- `api` - Backend related
- `agent` - LangGraph Agent
- `db` - Database/Supabase
- `config` - Configuration files

## Rules

- ✅ Commit messages in English
- ✅ Subject no more than 50 characters
- ✅ Use imperative mood: add, fix, update, remove, refactor
- ❌ No empty commit messages
- ❌ No meaningless descriptions like "fix bug", "update"
- ❌ No direct commits to main branch

## Examples

```bash
# ✅ Correct
feat(web): add pagination to search results
fix(api): correct vector search threshold calculation
refactor(agent): restructure research agent nodes

# ❌ Wrong
update code
fix
changed some stuff
```

## Pre-commit Checklist

1. Does it contain sensitive information (API Keys, passwords)?
2. Are there console.log / print debug statements?
3. Does it pass type checking?
4. Do changes match commit message?
