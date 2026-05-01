---
name: feature-ideation
description: Use when the user wants new feature ideas, product improvements, roadmap options, or creative ways to evolve an application. Reads the codebase and docs first, asks a few sharp product-direction questions only when needed, then proposes grounded ideas with impact, effort, and likely implementation areas.
---

# Feature Ideation

Use this skill when the user wants help discovering what to build next.

The goal is not to brainstorm generically. The goal is to inspect the real product, understand its current shape, and then suggest improvements that are creative, grounded, and actionable.

## Workflow

1. Read the local repository before proposing ideas.
2. Start with the highest-signal context:
   - `README.md`
   - architecture docs
   - product docs under `docs/`
   - main UI, commands, routes, settings, or entry points
   - TODO/FIXME/FUTURE comments when relevant
3. Summarize the current product read in 3 to 6 sentences before ideating.
4. Ask 1 to 3 focused questions only if product direction is still unclear after inspecting the repo.
5. Propose ideas that mix:
   - quick wins
   - medium-sized product improvements
   - at least one more ambitious direction when appropriate
6. For each idea, include:
   - `Idea`
   - `Why it matters`
   - `Impact`
   - `Effort`
   - `Implementation areas`
7. End with the top 1 to 3 recommendations based on leverage, not just novelty.

## What Good Ideas Look Like

Good ideas are:
- tied to evidence in the repo
- specific enough to imagine building
- useful to the product or developer experience
- sized honestly
- broader than just "fix bugs" but less vague than "improve UX"

Look for:
- hidden capabilities that are hard to discover
- manual workflows that should be automated
- dead ends, confusing states, or poor recovery paths
- adjacent workflows the product almost supports already
- missing onboarding or setup guidance
- settings or commands that deserve a stronger surface
- repeated logic that wants to become a first-class feature
- trust, observability, collaboration, or feedback loops that are missing

## Questions To Ask

Only ask questions that materially improve the quality of the ideas. Prefer questions like:
- Who is the primary user?
- What does success look like right now: growth, adoption, speed, reliability, delight, revenue, or team leverage?
- Are we optimizing for a near-term win or a bigger strategic move?

Do not ask broad questions that the repo can answer.

## Effort Rubric

Use this effort scale:

- `Small`: focused change, narrow workflow, or single surface
- `Medium`: multiple files or surfaces, but still incremental
- `Large`: architectural, cross-cutting, or new-system work

When useful, add one sentence explaining what drives the estimate.

## Output Shape

Use this default structure unless the user asks for something else:

### Current read

Short summary of what the product seems to do today and what it appears to optimize for.

### Clarifying questions

Only include this section if needed.

### Ideas

For each idea, use this shape:

- `Idea:` name
- `Why it matters:` one or two sentences
- `Impact:` High, Medium, or Low
- `Effort:` Small, Medium, or Large
- `Implementation areas:` relevant files, modules, or product surfaces

### Recommendation

Name the best next bets and explain why now.

## Style

- Be creative and practical at the same time
- Push beyond the obvious
- Prefer concrete product thinking over generic advice
- Be willing to suggest one bold idea if the codebase supports it
- Keep the answer high-signal and well organized
