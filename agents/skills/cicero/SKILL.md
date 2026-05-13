---
name: cicero
description: "Use the five classical canons of rhetoric as a disciplined, recursive human-agent work protocol: understand, arrange, choose method, define recoverability, then act."
---

# Cicero

Use this skill when starting, resuming, slicing, or de-risking intellectual work with a human. Cicero is an ordered but recursive protocol for disciplined, recoverable agent work.

Core rule: **do not enter Actio until Inventio, Dispositio, Elocutio, and Memoria are clear enough for the current task size, or the user explicitly waives the gate.**

## Operating modes

Choose the smallest useful mode unless the user asks for more ceremony:

- **quick**: compact pass for small tasks; one short section per canon.
- **full**: careful pass for ambiguous, risky, multi-step, or multi-session work.
- **slice**: apply Cicero recursively to one selected slice/subtask.
- **resume**: reconstruct state from memory artifacts, git, todos, docs, and recent conversation before acting.
- **reflect**: after work, identify where the protocol helped, where it was too heavy, and how to improve it.

If the invocation includes arguments, treat them as the task/request to frame.

## Canon order and circularity

Proceed in this order by default:

1. Inventio — understand the task.
2. Dispositio — arrange the work.
3. Elocutio — choose the working style.
4. Memoria — define tracking, checkpointing, resume, and rewind.
5. Actio — execute the approved next action.

The order is not a waterfall. Later canons may reveal flaws in earlier canons. When that happens, return explicitly, revise, and continue.

## Scope discipline

A Cicero flow is scoped to one explicit task. While inside that flow, do not start Actio for a new task, support task, cleanup, tooling change, or adjacent idea until the scope boundary is made explicit.

When new work appears, stop and classify it before acting:

- **same scope**: it is necessary to complete the current task's success criteria; fold it into the current Dispositio as a slice.
- **nested scope**: it is a subtask that needs its own Cicero pass; suspend the parent flow, run a slice/full flow for the nested task, then return explicitly.
- **new scope**: it is a separate task; ask whether to suspend/close the current flow and start a new Cicero flow, or defer the new task.
- **incidental cleanup**: it is not required for the current task; defer it unless the user explicitly authorizes expanding scope.

Default rule: be strict. If the work would deserve a separate commit, a separate review, a separate test plan, or a separate summary bullet, treat it as a separate scope until proven otherwise.

Use this scope note before switching or nesting:

```markdown
## Scope Check
Current scope: [current task]
New work noticed: [new task]
Classification: [same scope | nested scope | new scope | incidental cleanup]
Recommendation: [fold in | suspend and run nested Cicero | start new flow | defer]
Question: [confirmation needed from user]
```

Use this revision note:

```markdown
## Revision
Returning from: [canon]
Returning to: [canon]
Reason: [what changed]
Change: [specific adjustment]
```

Examples:

- Elocutio selects TDD, so return to Dispositio and reshape slices around failing tests.
- Memoria shows rollback would be expensive, so return to Dispositio and make slices smaller.
- Actio uncovers unknown dependencies, so stop and return to Inventio.

## 1. Inventio — understanding

Goal: establish the big WHAT before proposing action.

Ask and answer:

- What is the actual task?
- What does success look like?
- What evidence have I gathered from files, docs, tools, or conversation?
- What constraints, risks, and edge cases matter?
- What assumptions am I making?
- What is unknown?
- What questions must be asked before planning?
- What are plausible approaches?

Guidelines:

- Investigate the human before investigating the codebase, database, docs, or other artifacts. First make sure you understand what the user is trying to accomplish, not just the first solution or symptom they named.
- Do not start artifact investigation until the user's desired outcome, scope, and success criteria are clear enough for the task size, unless the user explicitly asks for exploratory investigation.
- Guard against X/Y problems: distinguish the user's underlying goal (X) from their proposed fix or framing (Y), and ask about the goal when they may diverge.
- For code work, inspect relevant files before planning only after the human-alignment check is clear enough, unless the user asks for pure brainstorming.
- Separate facts from assumptions.
- Ask concise clarifying questions when unknowns block useful arrangement.

Gate:

- Task restated in terms of the user's desired outcome, not only the proposed mechanism.
- Human alignment is clear enough: desired outcome, scope, and success criteria are known or explicitly deferred by the user.
- Relevant evidence gathered or evidence-gathering explicitly deferred.
- Blocking unknowns/questions listed.

## 2. Dispositio — arrangement

Goal: split work into logical, self-contained, feedback-producing slices.

Ask and answer:

- What are the smallest coherent slices?
- Which slices are independent and which depend on others?
- What is the acceptance criterion for each slice?
- How will each slice be verified?
- What can be deferred?
- Which slice should be executed first?

Opinionated slicing rules:

- Prefer **vertical slices** over horizontal layers.
- A good slice produces observable behavior, a failing/passing test, or reduced uncertainty.
- Avoid plans like "build DB layer, then API layer, then UI" unless explicitly justified.
- Prefer walking skeletons and thin end-to-end increments.
- If using TDD, slices should usually correspond to one failing test or a small cluster of related tests.
- Keep slices small enough for one focused agent session/turn when possible.

Gate:

- Slices are ordered.
- Each slice has verification.
- Horizontal slicing is avoided or justified.

## 3. Elocutio — working style

Goal: choose the HOW: the style, discipline, patterns, and constraints for the work.

Ask and answer:

- What style of work fits this task: TDD, spike, refactor-first, design-first, read-only review, etc.?
- What project conventions must be followed?
- Which principles apply: YAGNI, DRY, KISS, FCIS, functional core/imperative shell, small commits, etc.?
- What patterns should be used or avoided?
- What tradeoffs are acceptable?
- What does "good" look like here?

Guidelines:

- Elocutio may revise Dispositio. If the chosen method changes the natural slices, return and rewrite the arrangement.
- Prefer existing project style over imported preferences.
- Make the style operational, not decorative.

Gate:

- Working style selected.
- Project conventions noted.
- If style changes slice shape, Dispositio has been revised.

## 4. Memoria — continuity, resume, and rewind

Goal: make the work inspectable, interruptible, resumable, and cheaply reversible.

Core question:

> How will I track the work step by step so it is recoverable at every moment?

Ask and answer:

- Where will task state live: todo file, spec, issue, journal entry, plan file, tests, commits?
- What must be recorded after each slice?
- How often should checkpoint commits happen?
- What should checkpoint commit messages look like?
- How can another agent resume this work?
- If things go south, what is the cheapest safe rollback?
- Which files or commands form the recovery boundary?

Memoria should be concrete. Name files, commands, and policies.

Examples:

```markdown
Tracking artifact: `todos/NNNN-feature.md`
After each slice: record changed files, verification command/result, and next intended step.
Checkpoint policy: commit after every green vertical slice.
Commit shape: `checkpoint: <task> slice <N> <short result>`
Cheap rewind: use `git restore <file>` for isolated experiments; reset to last green checkpoint for broad regressions.
Resume note: current slice, last passing command, failing command if any, next action.
```

Gate:

- Tracking artifact/policy defined.
- Checkpoint frequency and shape defined when useful.
- Resume protocol defined for nontrivial work.
- Cheap rewind strategy defined before risky edits.

## 5. Actio — execution

Goal: execute only the approved next action after the prior gates are clear.

Ask and answer:

- What exact next action is allowed?
- Which slice am I executing?
- What tools/actions are allowed now?
- How will I verify it?
- When must I stop?
- What memory artifact must I update after acting?

Rules:

- Do not execute more than the selected slice unless the user authorizes broader execution.
- In quick mode, if the next action is low-risk/read-only and directly answers the user's request, proceed immediately unless the user asked only for a plan.
- If execution uncovers hidden complexity, stop and return to Inventio or Dispositio.
- After each slice, verify, update Memoria, summarize state, then ask/decide whether to continue.
- Never stop after framing without a clear handoff. End every Cicero response by naming the next step for the user.
- Use `Done` only when the full requested Cicero cycle is complete: the selected action was executed or intentionally deferred, verification/summary is complete, and no further Cicero-guided step is pending.
- If the cycle is not complete, end with either a proposed next action (`Next I can ...; proceed?`) or the specific question/investigation needed to continue.
- It is acceptable to keep asking or investigating when the current canon requires it, especially Inventio clarification or evidence gathering; make that the explicit next step.

Gate:

- Previous gates satisfied or explicitly waived.
- Next action and stop condition stated.
- Verification command/criterion stated.
- Response ending names the user's next step.
- `Done` is reserved for completion of the full requested cycle, not merely completion of a frame or intermediate slice.

## Output template

Use this template for full mode. Compress it for quick mode.

```markdown
# Cicero Frame

## 1. Inventio — Understanding
- Task:
- Success:
- Evidence:
- Unknowns / questions:
- Candidate approaches:

## 2. Dispositio — Arrangement
- Slice 1:
  - Outcome:
  - Verification:
- Slice 2:
  - Outcome:
  - Verification:
- Deferred:

## 3. Elocutio — Working Style
- Mode / discipline:
- Project conventions:
- Principles / patterns:
- Avoid:

## 4. Memoria — Continuity and Rewind
- Tracking artifact:
- Checkpoint policy:
- Resume protocol:
- Cheap rewind:

## 5. Actio — Next Action
- Allowed next step:
- Verification:
- Stop condition:
```

## Self-improvement loop

When asked to reflect, or after a substantial task, evaluate:

- Where did Cicero prevent premature action?
- Where was it too heavy?
- Where did the agent still jump too early?
- Were slices vertical and verifiable?
- Was Memoria concrete enough to resume/rewind cheaply?
- What specific edit to this skill would improve future runs?
