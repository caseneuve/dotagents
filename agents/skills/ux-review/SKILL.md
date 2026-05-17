---
name: ux-review
description: Review user-facing text (CLI help, error messages, README, ADRs, commit messages, onboarding docs) using a two-pass discipline that catches both wording bugs and structural-context gaps.
---

# UX Review

Use this skill when reviewing **user-facing text** — text where the reader
can't see what the author can: no source, no design notes, no chance to ask.
This is a *different* review type from `code-review` (which evaluates
correctness against shared specs). UX review evaluates whether a fresh
reader, with no project context, can use the artifact.

**Reader orientation**:
- *Author* of an artifact about to ship → read Pass 1 (self-cold-read),
  Step 3, Sign-off, Cost guidance.
- *Reviewer* invoked via Pass 2 → the **Pass 2** section is self-contained
  (prompt template + Findings format). Skip the rest unless deepening the
  methodology.

## When to use this skill (vs. `code-review`)

- Use **this skill** when the change touches: CLI help / `--help` output, error
  messages emitted to end users by parsers/compilers, README, ADRs, commit
  message conventions, onboarding docs, public API docs, or any prose meant
  for someone outside the immediate implementation context.
- Use **`code-review`** when the change is code, tests, infra, or other
  artifacts evaluated against a shared spec the reviewer can also see.
- For changes that touch both (e.g. a code change that also updates `--help`
  output): invoke `code-review` for the code and **also** this skill for the
  text. They catch different bugs.

**Underlying test**: if the consumer can't open the source or spec the author
had, this skill applies.

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

### Theoretical foundation (short version)

- **Information asymmetry** — Akerlof, G. A. (1970). "The Market for
  'Lemons': Quality Uncertainty and the Market Mechanism." *Quarterly
  Journal of Economics*, 84(3). Original use of "asymmetric information"
  as a term of art.
- **Curse of knowledge** — Camerer, Loewenstein & Weber (1989), *Journal
  of Political Economy*, 97(5). Better-informed parties cannot accurately
  model less-informed ones. Popularized in Pinker, S. (2014), *The Sense
  of Style*, ch. 3 — the most direct source for the help-text argument.
- **Theory of Mind** — Wimmer & Perner (1983), *Cognition*, 13(1)
  (Sally-Anne / false-belief test). Adults retain it but it degrades
  under cognitive load and large information gaps.
- **Cognitive walkthrough** — Polson, Lewis, Rieman & Wharton (1992),
  *Int. J. Man-Machine Studies*, 36(5). Formalized version of the
  fresh-cold-read pattern in HCI.
- **Usability engineering** — Nielsen, J. (1993), *Usability
  Engineering*. Empirical case for user testing: designers consistently
  fail to predict user confusion.

For the long-form treatment with full citations and the synthesis
argument, see the worked example referenced under "Reference" below.

## Protocol

### Pass 1 — author self-cold-read

The implementer re-reads their own text with a critical eye. Lens: "I know
what I meant; do the words match?".

Look for:

- **Wrong wording**: phrasing that misrepresents behaviour or intent.
- **Ambiguity**: phrasing that parses two ways (a classic: "default: X" — is
  X the default *value*, or what happens *when the flag is absent*?).
- **Visual artefacts**: framework auto-rendering of internal state into the
  output (e.g. CLI option defaults leaking into the formatted help line),
  alignment issues, unwanted truncation.
- **Cross-reference accuracy**: top-level command desc vs subcommand
  behaviour (e.g. top-level help promises X, subcommand actually does Y);
  example command line vs its comment; README install instructions vs
  the actual binary name.

Output: a list of fixes, applied immediately or queued. No template required
— the cost of structure exceeds the value at this scale.

### Pass 2 — fresh agent cold-read

A different agent (ideally one with no project context) reads the artifacts
and reacts as a first-time user. They have no ground truth — only what's
printed.

Send them the artifacts plus a prompt like (then **append the artifacts to
review after this block** — the prompt alone leaves the reviewer with
nothing to read):

```
This is NOT a code review. Don't open the source. React to the text below
as a fresh user who knows nothing about the project.

Per artifact, flag:
- Confusing wording — needs a second read or could be misread
- Missing context — assumed knowledge a fresh user wouldn't have
- Wrong-looking shape — visual or structural conventions that mislead about
  the artifact's role (e.g. CLI flags that look like positionals; section
  headers that misrepresent the section's content)
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

### Step 3 — apply, ship

Author applies high-value findings (high + med + selected low), defers or
declines the rest with rationale, ships.

## Reviewer sign-off pattern

Sign-off and ack-first conventions live in
`~/.agents/skills/agent-comms/SKILL.md`; that skill wins on any conflict.
The rough shape:

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
valuable — they catch drift the per-artifact pass misses. (Per-artifact rows
use `Issue` for a specific finding in one artifact; cross-artifact rows use
`Pattern` because they describe drift across multiple artifacts.)

## Cost guidance

**What counts as an artifact**: one atomic, single-screen-ish unit — one
`--help` block, one README section, one ADR, one error-message string.

From the worked example (pat-cli `#0025.1` self-pass, `#0025.2` fresh-pass
over 11 CLI helps):

- Self-pass: tens of minutes for a CLI's full help surface.
- Fresh-pass: similar, sometimes shorter — reviewer doesn't open source.
- Total round trip: well under an hour for a typical CLI's help surface.
- Cheaper than the post-ship cost of users repeatedly hitting confusing
  text. Each finding costs orders of magnitude more after release.

These estimates are calibrated to CLI helps. Long-form prose (READMEs,
ADRs, onboarding docs) runs longer per artifact but typically has fewer
artifacts; the per-trip total stays in the same ballpark.

## Anti-patterns

- **Self-pass only**: ships missing-context bugs because they're invisible
  from the inside.
- **Fresh-pass only**: ships subtle wording bugs because the fresh reader
  has no ground truth to compare against.
- **One agent doing both passes back-to-back**: defeats the cognitive reset.
  The fresh-pass agent **must be different** from the author. If no fresh
  agent is available, ship the self-pass and queue the fresh-pass — don't
  fake it with the same agent in the same session.
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

Examples in increasing-asymmetry order (**bold** = primary use case):

| Artifact | Asymmetry | Use this skill? |
|----------|-----------|-----------------|
| Function signatures (consumer has source access) | low | no — `code-review` covers it |
| Commit messages | medium | **yes** — esp. for shared repos |
| API docs (open source = wider, less-known audience) | medium | **yes** |
| ADRs (future-team is consumer) | high | **yes** |
| CLI help text | high | **yes** |
| Onboarding docs | very high | **yes** |
| Error messages | very high | **yes** |

## Reference

- Long-form theory + full citations + synthesis: journal entry
  `~/org/agent-journal/2026/05/17/1319-pat-cli.org` (on the host where
  this skill was authored; an agent on another machine can find the
  inline citation summary above sufficient).
- Worked example: pat-cli `#0025` (self-pass author) + `#0025.1`
  (post-self-pass polish) + `#0025.2` (fresh-pass via pat-rev review).
  Master commits `c5862d3`, `730166b`, `64758b5` on
  `pythonanywhere/pat-cli`.
- This SKILL.md was itself UX-reviewed via the protocol it documents
  (pat-rev's cold-read of pat-cli's help surface motivated the skill;
  v562's cold-read of this SKILL.md surfaced two rounds of polish before
  merge).
