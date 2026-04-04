# Tree-sitter POC design (0006.1)

This document defines the canonical architecture for the Tree-sitter POC in
this repo.

## Scope of this task

This milestone is design-first:

- define module boundaries and responsibilities
- define stable v0 tool contracts (`outline`, `context`, `find`)
- define the Python-first adapter path
- explicitly constrain v0 to read-only syntax inspection

Implementation of parser loading and tool execution is tracked in `0006.2` and
`0006.3`.

## v0 goals

- improve agent navigation in complex codebases using syntax structure
- keep outputs compact and deterministic for LLM tool use
- prove value with one language first (Python)
- keep one extension/tool surface that can grow to more languages

## Non-goals (v0)

- semantic refactors or symbol-safe rename
- AST-driven code writes/replacements
- LSP replacement
- full cross-file semantic indexing

## Canonical artifact and module layout

The canonical design artifact is this file:

- `pi/extensions/treesitter/DESIGN.md`

Planned module shape:

- `pi/extensions/treesitter/index.ts`
  - extension entrypoint
  - wires tools to core parser + adapters
- `pi/extensions/treesitter/contracts.ts`
  - tool names, query modes, request/response type contracts
- `pi/extensions/treesitter/adapters/types.ts`
  - adapter interface shared by all languages
- `pi/extensions/treesitter/adapters/python.ts`
  - Python adapter metadata and mode support
- `pi/extensions/treesitter/core/*` (to be added in later tasks)
  - parser loading, file parsing, range normalization, shared helpers

## Architecture boundary

### Generic core responsibilities

Generic core logic must be language-agnostic:

- resolve language adapter from path/file extension
- parse file contents and handle parser lifecycle
- normalize locations/ranges in one format
- enforce common output shaping limits
- map adapter-specific data into stable tool results

### Language adapter responsibilities

Each adapter owns language-specific rules:

- language identity and supported file extensions
- extraction of declarations for `outline`
- enclosing-scope behavior for `context`
- curated structural modes for `find`
- stable node naming conventions for that language

## Primary implementation choice

Primary path for the POC:

- TypeScript/Node-side Tree-sitter integration inside a Pi extension

Contingency (only if needed):

- helper process bridge (e.g., Python subprocess) if Node-side parser wiring is
  unreasonably painful

The contingency is explicitly secondary and should not define the architecture.

## v0 tool contracts

The extension will expose three tools.

### 1) `treesitter_outline`

Input:

- `path`: file path (absolute or relative to cwd)

Output:

- `language`
- `path`
- `nodes[]` with compact fields:
  - `kind`
  - `name`
  - `range` (`startLine`, `startColumn`, `endLine`, `endColumn`)

### 2) `treesitter_context`

Input:

- `path`
- `line` (1-based)
- `column` (1-based)

Output:

- `language`
- `path`
- `position`
- `enclosing[]` ordered from inner-most scope to outer-most scope
- `nearestDeclaration` (optional)

### 3) `treesitter_find`

Input:

- `path`
- `mode` (curated per language)
- optional mode arguments (kept minimal in v0)

Output:

- `language`
- `path`
- `mode`
- `matches[]` with compact fields:
  - `kind`
  - `name` (optional)
  - `range`
  - `preview` (short)

## Python-first adapter plan

Python adapter (`adapters/python.ts`) starts with curated modes:

- `imports`
- `classes`
- `functions`
- `async_functions`
- `decorated_functions`
- `tests`

The contract must support adding other adapters later without changing tool
names or result envelope shape.

For v0, `treesitter_find.mode` is intentionally a curated typed set derived from
Python's initial modes. When more languages are added, the shared find-mode
contract can expand deliberately rather than defaulting to unconstrained strings.

## Read-only guarantee

The Tree-sitter POC tools are inspection-only.

They may:

- parse files
- return structure and ranges

They may not:

- edit files
- execute refactors
- mutate project state

## Progression to later tasks

- `0006.2`: parser loading feasibility + first `outline` tool end-to-end
- `0006.3`: `context` and curated `find` for Python
- `0006.4`: evaluation checklist, success/failure criteria, beta path
