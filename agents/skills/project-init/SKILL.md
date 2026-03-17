---
name: project-init
description: Generate a concise project `AGENTS.md` by detecting the stack, commands, and workflow rules, then filling a standard template.
---

# Project Init

Use this skill when the user wants a project-level `AGENTS.md` for Codex or another agent-oriented workflow.

Work in three phases: detect what you can, ask only for what is missing, then draft the file.

## Phase 1: auto-detect project info

Gather concrete repo facts before asking questions:

- Project name from the directory name
- Primary language and framework from files such as `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, or `bb.edn`
- Test commands from package scripts, task runners, or common config files
- Linter and formatter tools from config files such as `.eslintrc*`, `biome.json`, `ruff.toml`, `pyproject.toml`, or `.clj-kondo/`
- Existing workflow conventions from recent commit messages and repo docs
- Existing project docs such as `README.md`, `CONTRIBUTING.md`, `ARCHITECTURE.md`, and `docs/`

## Phase 2: clarify only the gaps

Ask the user only about details you cannot infer safely, such as:

- Required development workflow, especially TDD and review expectations
- Canonical build, test, lint, and run commands when multiple options exist
- Project-specific rules or forbidden actions
- Important directories if the layout is not obvious
- Known gotchas the agent should avoid

Keep questions minimal and concrete.

## Phase 3: draft `AGENTS.md`

Create a concise file tailored to the repo. Show the draft before writing when the project conventions are still uncertain.

Only include sections that add operational value. Prefer a short, high-signal file over exhaustive project documentation.

## Template

    # AGENTS.md

    ## Quick Reference

    | Item | Value |
    |------|-------|
    | Language | [detected] |
    | Test runner | [detected or confirmed] |
    | Linter | [detected] |
    | Formatter | [detected] |

    ## Commands

    ```bash
    # Build
    [command]

    # Test
    [command]

    # Test (single file)
    [command]

    # Lint
    [command]

    # Run
    [command]
    ```

    ## Project Structure

    [Key directories and why they matter]

    ## Rules

    ### MUST
    - [project-specific requirements]

    ### MUST NOT
    - [things the agent should avoid]

    ### PREFER
    - [style and workflow preferences]

    ## Known Gotchas

    - [common pitfalls]

    ## Additional Context

    [Only if needed]
