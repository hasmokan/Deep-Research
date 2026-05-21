---
name: identity-research
description: Use when a user asks who a person, username, handle, creator, developer, public account, or online identity is.
allowed_tools:
  - web_search
  - ask_clarification
---

# Identity Research

Use this skill for public identity and profile questions.

## Rules

- If the spelling, platform, or target identity is ambiguous, ask a clarification question before searching.
- Search exact handles and names first. Prefer official profiles, verified accounts, repository owners, personal sites, and primary project pages.
- Compare at least two signals before linking a handle to a person, project, or community.
- Do not infer private identity, legal name, location, employer, or personal contact details unless they are explicitly public and relevant.
- Separate verified facts from inference. Use wording like "appears to be", "public sources suggest", or "I could not confirm" when evidence is weak.
- Answer in the user's language and keep the result compact.

## Output Shape

Start with the most likely identity, then list key evidence:

- Main identity or role
- Relevant platforms or links
- Confidence and uncertainty
- What could not be confirmed
