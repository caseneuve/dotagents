# Pi package conventions

This checklist is the shared baseline for the move-only extraction in epic 0027. It intentionally avoids npm publication, scaffolding automation, and feature changes.

## Repositories and checkout layout

All repositories are public on GitHub, owned by `caseneuve`, and use `master` as the default branch for new repositories. Local checkouts live under `~/git/pi/`:

- https://github.com/caseneuve/pi-agent-channel → `~/git/pi/pi-agent-channel`
- https://github.com/caseneuve/pi-playwright → `~/git/pi/pi-playwright`
- https://github.com/caseneuve/pi-runtime-ui → `~/git/pi/pi-runtime-ui`
- https://github.com/caseneuve/pi-conversation-tools → `~/git/pi/pi-conversation-tools`
- https://github.com/caseneuve/pi-workbench → `~/git/pi/pi-workbench`
- https://github.com/caseneuve/pi-provider-extras → `~/git/pi/pi-provider-extras`
- https://github.com/caseneuve/pi-dotagents-resources → `~/git/pi/pi-dotagents-resources`

Repository/package names are the unscoped names above (for example `pi-agent-channel`). Do not reserve an npm scope; publication is follow-up 0051.

## Versioning and changelog

Each package is versioned independently using CalVer `YYYY.MM.PATCH` (for example `2026.07.0`) in `package.json`. Increment `PATCH` for fixes and move/features within the same month; start the patch sequence at `0` for a new month. Every user-visible or installable change updates a root `CHANGELOG.md` under an `Added`, `Changed`, `Fixed`, or `Removed` heading. Release tags use the exact package version with a `v` prefix (for example `v2026.07.0`) and Git installs should reference that immutable tag or its commit SHA.

## Legal defaults

Unless a repository records a deliberate change before code moves, each repository uses the MIT license, with copyright holder `Caseneuve` and the current year. Preserve notices already present in moved files and add the repository `LICENSE` and copyright metadata before the first public code move.

## Manifest and resource selection

Every repository has a `package.json` with an explicit `pi` manifest. Use stable, repository-relative paths (normally `./extensions`, `./skills`, `./prompts`, and/or `./themes`) and list only resources belonging to that package. Include the `pi-package` keyword.

Pi package filtering is configured in settings using an object entry in `packages`, for example:

```json
{
  "packages": [{
    "source": "git:github.com/caseneuve/pi-agent-channel@<ref>",
    "extensions": ["extensions/*.ts"],
    "skills": [],
    "prompts": [],
    "themes": []
  }]
}
```

Filters layer on top of the manifest: omitted keys load all manifest resources, `[]` loads none, glob patterns and `!pattern` select/exclude, and `+path`/`-path` force include/exclude exact paths. `pi config` (or `pi config -l` for project-local settings) enables or disables individual resources.

Experimental/scaffold resources must be explicitly excluded at manifest level, even when a broad directory is listed. Use Pi's `!pattern` syntax, for example `"extensions": ["./extensions", "!./extensions/scaffold/**"]`; do not rely on omission alone. Tree-sitter is outside this package set and must not be packaged or installed.

## Installation and refs

Validate both forms for every repository:

```bash
pi install ~/git/pi/pi-agent-channel
pi install git:github.com/caseneuve/pi-agent-channel@<tag-or-commit>
```

Pi currently accepts `git:host/user/repo@ref` (and protocol URL equivalents); `@ref` is a pinned tag or commit. Pinned refs are not advanced by `pi update --extensions` or `pi update --all`; move deliberately with `pi install git:...@new-ref`. Use immutable commit SHAs for production validation and record the SHA in test/docs; tags are allowed only when the tag itself is the reviewed immutable release ref.

## Dependencies and API compatibility

- `@earendil-works/pi-ai`, `@earendil-works/pi-agent-core`, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, and `typebox` belong in `peerDependencies` with a `"*"` range; do not bundle them.
- Non-Pi runtime imports belong in `dependencies` (not `devDependencies`), because Pi installs Git packages with production dependencies.
- Keep test/typecheck-only packages in `devDependencies`.
- Verify imports against the currently supported Earendil Pi API before moving; do not redesign extensions.

## Per-repository checklist

- [ ] `package.json` has the unscoped package name, MIT metadata, `pi-package` keyword, explicit manifest, correct dependencies, and CalVer version (`YYYY.MM.PATCH`).
- [ ] Root `CHANGELOG.md` records the change under a standard heading; release tags use `vYYYY.MM.PATCH`.
- [ ] README documents purpose, resources, supported platforms/limitations, local install, Git install with an immutable ref, filtering, and test/typecheck commands; links to Pi (`https://pi.dev/`) and `@earendil-works/pi-coding-agent` context.
- [ ] Repository metadata uses relevant discoverability topics/tags (at minimum `pi`, `agents`, `extensions`, plus package-specific terms).
- [ ] Copy the canonical [`docs/pi-package-AGENTS.md`](pi-package-AGENTS.md) into the repository as `AGENTS.md`; it documents the Pi source/docs reference, discussion → todo → branch → checkpoint commits → review → squash/merge workflow, TDD (or documented manual testing), FCIS/KISS/DRY/YAGNI design discipline, and review criteria. UI changes require screenshot review unless explicitly waived by a human.
- [ ] `prek` hooks are installed and committed/configured to run TypeScript formatting and lint checks before commits.
- [ ] Existing tests and fixtures move with the canonical implementation and pass from a clean checkout.
- [ ] Formatting follows repository conventions (TypeScript via Prettier with spaces).
- [ ] Commits link the source todo (`0027.x`) and preserve move-only scope.
- [ ] A peer review walks the manifest, resource paths, API imports, tests, and installation commands before merge.

Npm publication, generalized templates, new APIs, platform expansion, daemon hardening, and extension improvements remain out of scope.
