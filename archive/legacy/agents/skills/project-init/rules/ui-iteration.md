# UI Iteration Discipline (Project Rule Pack)

Use this rule in UI-heavy projects. Keep it project-local (for example `.claude/rules/ui-iteration.md`) instead of global runtime rules.

## Acceptance lock before edits

Before implementing a visual/interaction fix, restate acceptance criteria as GIVEN/WHEN/THEN bullets and confirm once.

## Verification standard

Do not report "fixed" until all checks pass:

1. Verify in a user-representative viewport.
   - If unknown, ask once for width or state the width used.
2. Verify target behavior with both:
   - computed style / DOM checks for the affected elements
   - screenshot of the exact impacted area

## Pivot rule

If two consecutive attempts fail on the same UX bug, stop micro-tweaks and propose a structural alternative with explicit tradeoffs.

## Context-dependent template features

For template features that depend on engine context (for example prev/next, related posts):

- confirm available context keys before implementation, or
- ask for engine-side context support first.
