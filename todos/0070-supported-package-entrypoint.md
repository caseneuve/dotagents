---
title: Make dotagents the entry point for supported Pi packages
status: done
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

- [x] Link all seven supported packages with accurate ownership/capabilities.
- [x] Keep the entry point limited to supported public packages, without private tooling links.
- [x] Explain independent native installation and resource-name ownership; no bootstrap.
- [x] Keep archive recovery linked, without a long obsolete migration narrative.
- [x] Verify links/manifest descriptions and obtain independent exact-ref docs review.

## Verification boundaries

GitHub repository creation must wait for two independent audits of the exact new
repository histories. Empty public repositories are not a remote installation
proof; user pushes source later. Existing private/untracked work is not staged.
README documentation does not certify the privacy of all already-public repos.

## Verification

Independent docs approval a569b05 and namespace clarification renewal7da269e;
only README and this task change from cc2913b. All relative links exist, and
canonical manifests confirm seven packages totaling12extensions/5skills/5prompts/
2themes. All seven GitHub URLs now resolve to PUBLIC repositories. The three new
repositories are explicitly empty; source push remains the user's action.

Two independent baseline privacy audits found no credentials/private user or
customer content in publishable history. The user accepted historical local
provenance paths by explicitly requesting current-files-only replacement; themes
received a separately reviewed URL update, without history rewrite. Private
tooling stays private and is not linked as a supported public package here.

This final task-only closeout receives exact-tip review before lead integration.
No runtime/manifest/archive payload, user setting or dependency was changed.
