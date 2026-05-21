# Agent Skills

Put local skills in this directory. Each skill lives in its own folder with a `SKILL.md` file:

```markdown
---
name: identity-research
description: Guidance for source-backed identity research.
allowed_tools:
  - web_search
  - ask_clarification
---

Prefer source-backed identity checks before answering. Ask a clarification question when a name is ambiguous.
```

By default the API loads all `skills/*/SKILL.md` files. You can override the directory with `AGENT_SKILLS_DIR` and limit loaded skills with comma-separated `AGENT_ENABLED_SKILLS`.
