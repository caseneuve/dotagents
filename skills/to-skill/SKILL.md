---
name: to-skill
description: Turn hard-won context from resolving an ambiguous or repetitive task into a concise, portable skill. Use after an agent had to discover non-obvious setup, commands, tests, tools, decision rules, or coordination steps that future agents should not have to rediscover.
---

# To Skill

Convert the verified lesson from the current task into reusable instructions.
Create a workflow, not a transcript or postmortem.

## Record only durable lessons

Create the skill when the task is likely to recur, the original instruction
omitted material context, and the successful workflow is now verified. If the
lesson is one-off or still uncertain, identify the gap instead of encoding a
guess.

## Choose the destination

1. An explicit user-provided location always wins. Treat a path ending in
   `.md` as the output file; otherwise create `<location>/<skill-name>/SKILL.md`.
2. Otherwise write
   `<project-root>/.pi/skills/<skill-name>/SKILL.md`. Use the nearest project
   root, or the current working directory when there is none.
3. Derive a narrow, kebab-case name from the reusable task, not from the error
   or incident. Inspect the destination before writing. Update a same-purpose
   skill rather than duplicating it; never overwrite an unrelated skill.

## Distill the workflow

1. Recover from the conversation and execution evidence:
   - the short future request that should trigger the skill;
   - the context that request failed to provide;
   - the verified actions or decision rules that resolved it;
   - the check that proved success.
2. Keep only what a capable agent could not reliably infer from the future
   request. This may include prerequisite detection, action order, commands,
   test selection, tool use, or a subagent's role and expected deliverable.
3. Generalize the evidence:
   - remove the originating project, repository, user, host, ticket, branch,
     commit, session, process, and temporary-file references;
   - use relative paths, role-based placeholders, and capability-based tool
     wording instead of machine paths or harness-specific API names;
   - retain an exact command only when it is part of the reusable contract;
   - state uncertainty or a decision check instead of inventing a universal
     rule from one success.
4. Omit narrative, failed attempts, obvious agent behavior, broad best
   practices, and policy already supplied by normal project instructions.

## Write the skill

Use standard skill frontmatter:

```yaml
---
name: <lowercase-kebab-case-name>
description: <what the skill does and concrete signals for when to use it>
---
```

Make the description match the future ambiguous request, not the current
incident or the act of creating a skill. In the body, prefer a short ordered
procedure with explicit decision points and verification. Add scripts,
references, examples, or setup sections only when the workflow cannot remain
reliable without them.

## Audit before finishing

- Would a fresh agent receiving the same short request know to load this skill
  and complete the task without rediscovering the missing context?
- Is every instruction supported by what was observed or verified?
- Are commands and paths portable, or clearly scoped placeholders?
- Are tool and subagent steps defined by purpose and output rather than by one
  runtime's interface?
- Can any line be removed without reducing correctness? Remove it.
- Re-read the written file and inspect the diff for leaked local references.

Unless the user requested a draft only, write the skill and report its path,
its trigger in one sentence, and the verification performed.
