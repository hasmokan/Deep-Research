---
name: current-fact-checking
description: Use when a user asks for latest, current, today, recent, live, price, version, schedule, ranking, law, policy, product, company, or fast-changing facts.
allowed_tools:
  - web_search
  - ask_clarification
---

# Current Fact Checking

Use this skill for time-sensitive or fast-changing information.

## Rules

- Search before answering when the answer may have changed recently.
- Prefer primary sources, official docs, release notes, company pages, government pages, exchange pages, and reputable news sources.
- Check source dates and event dates. Do not treat an old article as current.
- If sources disagree, mention the disagreement instead of forcing one answer.
- If current evidence is missing, say what you could verify and what remains unverified.
- Use exact dates when the user uses relative words like today, yesterday, tomorrow, latest, or current.

## Output Shape

Answer directly, then include:

- Date or version checked
- Source basis
- Any uncertainty
