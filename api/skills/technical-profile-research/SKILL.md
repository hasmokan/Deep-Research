---
name: technical-profile-research
description: Use when a user asks about a developer, GitHub user, project maintainer, repository portfolio, technical stack, contribution pattern, or engineering profile.
allowed_tools:
  - web_search
  - ask_clarification
---

# Technical Profile Research

Use this skill for developer and project-profile research.

## Rules

- Prefer GitHub profiles, repository pages, official project docs, package registries, and personal technical sites.
- Look for concrete signals: repositories, languages, frameworks, commit activity, release history, package metadata, docs, demos, and issue discussions.
- Do not judge skill level from one metric alone. Treat stars, repo count, ratings, and followers as weak signals unless supported by project quality or activity.
- When reporting counts or current metrics, include that they are time-sensitive.
- Avoid turning a profile into a biography unless the user asked for biography.
- If search results point to unrelated people or projects, say so and ask for a platform/link.

## Output Shape

Summarize:

- Public technical identity
- Main projects
- Likely stack
- Evidence
- Caveats
