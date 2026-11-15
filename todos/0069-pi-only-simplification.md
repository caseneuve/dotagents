---
title: Final Pi-only layout and obsolete runtime retirement
status: done
priority: high
type: refactor
labels: []
created: 2026-11-15
parent: null
blocked-by: []
blocks: []
---

## Context

The user explicitly selected Pi only: root skills/prompts, native packages,
no bootstrap, PATH shims or parallel Agents installation. This supersedes old
Claude/Agents parity guidance. No live installation/configuration changes here.

## Acceptance Criteria

- [x] Five canonical skills, their real helpers/tests and five canonical prompts
      at root, explicit 5+5 manifest and no extensions/themes.
- [x] Ownership/reference inventory before tracked-only byte/mode-preserving
      archive of obsolete Claude/Agents, unused shared resources and bootstrap.
- [x] Active docs/tasks/tests use only canonical paths; actual helpers and native
      resource loader tested with private HOME/non-Git cwd outside /home.
- [x] Historical bytes/recovery mapping and unfinished product/skill work preserved;
      no unrelated todo falsely completed, dirty/ignored/user work untouched.
- [x] Independent source review and bounded proof/handoff; final exact-ref sign-off
      is required before integration. No merge/push/tag.

## Separate gated preparation

Remaining legacy pi/extensions and pi/themes retirement belongs on a distinct
reviewed branch/commit. NOT landable until seven calendar days AND five normal
sessions across two projects per active OS plus explicit exact-scope approval.
The cutover began 2026-11-15T16:20:48Z; no gate completion is claimed. Three
already archived helpers remain unchanged. This task does not close #0047.

## Validation and handoff

Record RED/GREEN, actual checks, inherited missing pinned clj-kondo limitation,
archive proof and exact refs in ~/.cache/pi-migration/evidence/pi-only-final/.
Lead t16 owns live handoff, including external workbench references. typesafe-ai,
settings/auth/HOME/PATH/installations and user terminals are outside scope.

## Source completion (not live adoption)

- RED ec8d6a6; GREEN 2e93100; narrow dependency cleanup dcae7da removes the
  unused external JVM after the retired-runner audit. No helper redesign.
- 40 tracked canonical resources/helper/test/fixture moves; 78 new byte/mode-exact
  historical archives plus the three previously archived helpers indexed unchanged.
- `bb test`: PASS 69 tests (todo10/46 assertions; Python14+17; native/helpers4;
  pinned Clojure24/152 assertions). `bb test:pi`: actual Pi1.5.2 native 5+5,
  positive filters, empty selections and prompt expansion PASS, no auth/API calls.
- Missing clj-kondo v2026.01.19 was an inherited host/image baseline limitation;
  preflight failed honestly before the pinned container was built. Later canonical
  image build downloaded and checksum-verified the original pin, and actual tests
  passed without repinning. Host v2026.10.26 remains unchanged; no all-OS claim.
- Independent reviewer pi-simplify-review approved behavior/layout 2e93100 and
  independently reran native/helper/package composition/object preservation checks.
  The tiny later dependency delta and this metadata require final exact-ref review;
  the authoritative final decision/ref is in evidence/pi-only-final/review.md.
- Lead-owned live path/configuration handoff and canonical integration are NOT
  performed by this source task. Existing ignored caches/dirty/local work must be
  preserved by that separate operation, not swept up by Git moves or git clean.
- #0069.1 is separate reviewed archive PREPARATION only. The 49 remaining gated
  legacy source/theme/test files stay unchanged here. #0047 remains OPEN; no soak
  waiver/completion, publication or experiment/product delivery is inferred.
