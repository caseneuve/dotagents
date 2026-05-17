---
name: ux-review
description: Review user-facing text (CLI help, error messages, README, ADRs, commit messages, onboarding docs) using a two-pass discipline that catches both wording bugs and structural-context gaps.
---

# UX Review

Use this skill when reviewing **user-facing text** — text where the reader has
categorically less information access than the author. This is a *different*
review type from `code-review` (which evaluates correctness against shared
specs). UX review evaluates whether a fresh reader, with no project context,
can use the artifact.

## When to use this skill (vs. `code-review`)

- Use **this skill** when the change touches: CLI help / `--help` output, error
  messages, README, ADRs, commit message conventions, onboarding docs, public
  API docs, DSL syntax errors, or any prose meant for someone outside the
  immediate implementation context.
- Use **`code-review`** when the change is code, tests, infra, or other
  artifacts evaluated against a shared spec the reviewer can also see.
- For changes that touch both (e.g. a code change that also updates `--help`
  output): invoke `code-review` for the code and **also** this skill for the
  text. They catch different bugs.

## Why two passes

Author and consumer have asymmetric information access:

- **Author** knows the implementation, the intent, the design decisions, all
  unwritten constraints.
- **Consumer** has only the printed text — cannot read the source, cannot
  read the design, cannot ask.

Each side alone has only half the gap visible. So:

- **Self-cold-read by the author** catches *wording bugs* — places where the
  text doesn't say what was meant. Author has ground truth, scans for
  mismatches.
- **Fresh-cold-read by a different agent** catches *structural-context gaps*
  — info that should be there but isn't. Fresh reader notices when their
  question doesn't get answered.

Skip self → ship wrong wording. Skip fresh → ship missing context. Both →
both classes caught.

For the underlying theory (Akerlof's information asymmetry, Camerer et al.'s
curse of knowledge, Wimmer & Perner's Theory of Mind, Pinker's *Sense of
Style*, Polson et al.'s cognitive walkthrough, Nielsen's usability
engineering), see the journal entry at
`~/org/agent-journal/2026/05/17/1319-pat-cli.org`.

## Protocol

### Pass 1 — author self-cold-read

The implementer re-reads their own text with a critical eye. Lens: "I know
what I meant; do the words match?".

Look for:

- **Wrong wording**: phrasing that misrepresents behaviour or intent.
- **Ambiguity**: phrasing that parses two ways (a classic: "default: X" — is
  X the default *value*, or what happens *when the flag is absent*?).
- **Visual artefacts**: babashka.cli-style default-leak, alignment issues,
  unwanted truncation.
- **Cross-reference accuracy**: top-level command desc vs subcommand
  behaviour; example command line vs comment.

Output: a list of fixes, applied immediately or queued. No template required
— the cost of structure exceeds the value at this scale.

### Pass 2 — fresh agent cold-read

A different agent (ideally one with no project context) reads the artifacts
and reacts as a first-time user. They have no ground truth — only what's
printed.

Send them the artifacts plus a prompt like:

```
This is NOT a code review. Don't open the source. React to the text below
as a fresh user who knows nothing about the project.

Per artifact, flag:
- Confusing wording — needs a second read or could be misread
- Missing context — assumed knowledge a fresh user wouldn't have
- Wrong-looking shape — flags that look like positionals or vice versa
- Bad examples — examples that don't help understand the artifact
- Cross-artifact inconsistencies an attentive reader would notice

Severity:
- low — cosmetic
- med — costs >30s of confusion
- high — leads the reader down a wrong path

Output: per-artifact findings table, severity column, suggested-fix column
where you have one. Cross-cutting observations as a separate section.
```

The fresh agent isn't perfectly fresh if they've reviewed the diff before —
that's fine; ask them to bracket prior knowledge and react to printed text
only. Findings will skew toward "missing context" because that's the lens
self-pass is weakest at.

### Pass 3 — apply, ship

Author applies high-value findings (high + med + selected low), defers or
declines the rest with rationale, ships.

## Reviewer sign-off pattern

Same as `code-review`'s comms protocol when an agent channel is available:

1. Author requests review on the project channel with the artifacts inline.
2. Reviewer acks, runs the cold-read, replies with findings.
3. Author applies fixes, requests re-review if scope warrants, otherwise
   confirms shipped.
4. Both sides confirm complete (`OUT`).

## Findings table format

When the reviewer is producing findings, structure them like:

```
## Per-artifact findings

### <artifact name>

| Sev | Issue | Suggested fix |
|-----|-------|---------------|
| med | ...   | ...           |

## Cross-artifact / structural observations

| Sev | Pattern | Suggested fix |
|-----|---------|---------------|
| med | ...     | ...           |
```

Severity ∈ {low, med, high}. Cross-cutting observations are usually the most
valuable — they catch drift the per-artifact pass misses.

## Cost guidance

- Self-pass: ~5–15 min per ~10 artifacts.
- Fresh-pass: ~10–25 min per ~10 artifacts (reviewer doesn't open source;
  pure reaction-to-text).
- Total round trip: ~30–60 min for a typical CLI's full help surface.
- Cheaper than the post-ship cost of users repeatedly hitting confusing help.

## Anti-patterns

- **Self-pass only**: ships missing-context bugs because they're invisible
  from the inside.
- **Fresh-pass only**: ships subtle wording bugs because the fresh reader
  has no ground truth to compare against.
- **One agent doing both passes back-to-back**: defeats the cognitive reset.
  The fresh-pass agent should be different from the author. If the same
  agent must do both, separate them by enough time / unrelated work for the
  reset to be real (a day, ideally; an hour at minimum).
- **Treating UX review as code review style-nits**: misses the asymmetry. UX
  review is about whether the artifact is usable, not whether the prose is
  pretty.
- **Reviewer reading the source first**: contaminates the cold-read with
  implementation knowledge. If the reviewer needs source access, they
  should note which findings depended on it and which didn't.

## Generalization

The principle applies wherever:

1. Knowledge gap between author and consumer is large.
2. Consumer has limited access to the author's knowledge (no source, no
   design doc, can't ask).
3. Artifact's correctness depends on the consumer's mental model.

Examples in increasing-asymmetry order:

| Artifact | Asymmetry | Use this skill? |
|----------|-----------|-----------------|
| Function signatures (in-codebase) | low | no — `code-review` covers it |
| API docs (open source) | medium | yes |
| CLI help text | high | **yes** |
| Error messages | very high | **yes** |
| ADRs (future-team is consumer) | high | **yes** |
| Commit messages | medium | yes — esp. for shared repos |
| Onboarding docs | very high | **yes** |

## Reference

- Theory + citations: `~/org/agent-journal/2026/05/17/1319-pat-cli.org`
- Worked example: pat-cli `#0025`, `#0025.1`, `#0025.2` (commits `c5862d3`,
  `730166b`, `64758b5` on `pythonanywhere/pat-cli` master).
