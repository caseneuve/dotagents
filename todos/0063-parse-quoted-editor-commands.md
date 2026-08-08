---
title: parse quoted editor commands
status: done
priority: high
type: bug
labels: []
created: 2026-08-09
parent: null
blocked-by: []
blocks: []
---

## Context

Pi editor commands commonly contain quoted arguments, such as `emacsclient -nw -a ""`. Splitting `$EDITOR` on literal spaces passes quote characters to the child, so emacsclient receives `\"\"` instead of an empty alternate-editor argument and exits without opening anything.

## Acceptance Criteria

- [ ] Shared external-editor launch parses quoted and escaped arguments, including quoted empty strings.
- [ ] Diff review launches configured editors with shell-equivalent arguments and retains TUI lifecycle/error handling.
- [ ] Unit tests cover quoted empty arguments, unterminated quotes, and existing editor lifecycle paths.

## Affected Files

- `pi/extensions/shared/external-editor.ts` — shell-like editor command tokenizer.
- `test/pi/external-editor.test.ts` — tokenizer regression coverage.
- `todos/0063-parse-quoted-editor-commands.md` — tracking.

## E2E Spec

GIVEN `$EDITOR=env TERM=xterm-ghostty-direct emacsclient -nw -a ""`
WHEN `/diff` opens the external editor
THEN emacsclient receives an empty `-a` argument, starts/attaches normally, and Pi resumes after exit.

## Notes

Pi's built-in Ctrl-G editor uses its own command splitter in the installed runtime; this change fixes extension-launched editors. A wrapper executable is the compatibility workaround for the built-in path until that runtime parser is updated.
