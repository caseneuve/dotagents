---
name: project-init
triggers:
  - init project
  - initialize project
  - create CLAUDE.md
  - setup claude
  - project setup
---

# project-init - Generate CLAUDE.md for a Project

Use this skill when the user wants to create a CLAUDE.md file for their project.

## Process

### Phase 1: Auto-detect project info

Gather information automatically:

```bash
# Project name
basename "$(pwd)"

# Detect language/framework
ls -la  # Look for: package.json, pyproject.toml, Cargo.toml, go.mod, bb.edn, etc.

# Detect test runner
# Node: look in package.json scripts for "test"
# Python: look for pytest.ini, pyproject.toml [tool.pytest], or tests/ directory
# Clojure: look for test/ directory, bb.edn tasks

# Detect linter/formatter
# Node: .eslintrc*, .prettierrc*, biome.json
# Python: ruff.toml, pyproject.toml [tool.ruff], .flake8
# Clojure: .clj-kondo/

# Detect existing conventions
# Look at recent commit messages for style
git log --oneline -10

# Check for existing docs
ls README.md CONTRIBUTING.md ARCHITECTURE.md docs/ 2>/dev/null
```

### Phase 2: Ask clarifying questions

Ask the user about things that can't be auto-detected:

1. **Development workflow** - TDD? Review before commit?
2. **Key commands** - How to build, test, run, lint?
3. **Special rules** - Things the agent should never do?
4. **Project structure** - Key directories and their purpose?
5. **Known gotchas** - Common mistakes to avoid?

Keep questions minimal - only ask what's needed.

### Phase 3: Generate CLAUDE.md

Create the file using the template below, filling in detected and provided information.

**Important:**
- Show the generated content to the user for review before writing
- Only include sections that are relevant
- Keep it concise - this is a reference, not documentation

---

## Template

```markdown
# CLAUDE.md

## Quick Reference

| Item        | Value              |
|-------------|--------------------|
| Language    | [detected]         |
| Test runner | [detected/asked]   |
| Linter      | [detected]         |
| Formatter   | [detected]         |

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

```
[key directories and their purpose]
```

## Rules

### MUST
- [project-specific requirements]

### MUST NOT
- [things to avoid]

### PREFER
- [stylistic preferences]

## Known Gotchas

- [common mistakes or confusing aspects]

## Additional Context

[any other relevant information for the agent]
```

---

## Example Invocations

```
User: init project
User: create CLAUDE.md
User: setup claude for this project
```

## Tips

- Start with auto-detection to minimize questions
- Propose sensible defaults based on detected stack
- Keep the generated CLAUDE.md concise - agents work better with focused context
- Suggest adding project-specific skills if patterns emerge
