---
title: publish extracted Pi packages to npm
status: open
priority: low
type: chore
labels: [pi, packaging, follow-up]
created: 2026-07-10
parent: null
blocked-by: [0027.9]
blocks: []
---

## Current release gate (2026-11-15)

Remains OPEN. Approved local compatibility/native composition is not publication,
remote GitHub availability, authenticated API validation or cross-platform
certification. No pushes/tags/npm releases are authorized by this closeout.
This existing item also owns the explicitly separated remote immutable-ref
release-validation gate; no new release epic is created.

- [ ] After explicit distribution approval, validate clean remote Git installation
      of the exact reviewed immutable published refs for retained packages and
      record provenance/results separately from local/loopback Git tests.
- [ ] Keep remote Git release validation distinct from npm publication, live
      settings adoption and all-OS/real-provider claims; preserve disabled selections.

Evidence of bounded local delivery:
`~/.cache/pi-migration/evidence/composition/final-review.md` and per-package
reviews. Local native proof does not satisfy the remote release criterion above.

## Context

The initial distribution strategy is local paths plus public Git repositories owned by `caseneuve`.
Publishing to npm is optional follow-up work and must not influence extraction ownership or imply
that packages belong to the separate `earendil-works` organization.

No existing todo owns npm account/scope selection and publication of the extracted package set.

## Acceptance Criteria

- [ ] Decide npm account, scope or unscoped naming, ownership, access, and 2FA/provenance policy.
- [ ] Confirm names do not imply ownership by `earendil-works`; keep `@earendil-works/*` only as Pi API dependencies.
- [ ] Define semver, tags, changelog, release, rollback/deprecation, and automation policy.
- [ ] Validate package tarballs include explicit Pi resources and required runtime dependencies only.
- [ ] Test clean `pi install npm:...` for every published package and document migration from Git/local sources.

## Notes

Public Git installation remains supported after npm publication.
