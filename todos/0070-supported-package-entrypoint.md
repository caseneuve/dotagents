---
title: Make dotagents the entry point for supported Pi packages
status: in_progress
priority: medium
type: docs
labels: [pi, documentation]
created: 2026-11-16
parent: null
blocked-by: []
blocks: []
---

## Scope

User requested independent privacy/security audits before creating public GitHub
repositories for the three new supported packages, then a dotagents README entry
point with the full supported package list and links. Audit/remote creation is a
separate lead-owned operation; this source task only changes README and this todo.
No push, tag, npm publication, installation or runtime changes are included.

## Acceptance

- [ ] Link all seven supported packages with accurate ownership/capabilities.
- [ ] List template-pi-package separately as development tooling, not a runtime package.
- [ ] Explain independent native installation and resource-name ownership; no bootstrap.
- [ ] Keep archive recovery linked, without a long obsolete migration narrative.
- [ ] Verify links/manifest descriptions and obtain independent exact-ref docs review.

## Verification boundaries

GitHub repository creation must wait for two independent audits of the exact new
repository histories. Empty public repositories are not a remote installation
proof; user pushes source later. Existing private/untracked work is not staged.
README documentation does not certify the privacy of all already-public repos.
