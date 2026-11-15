# treesitter extension (POC scaffold)

This directory contains the Python-first Tree-sitter POC scaffold.

Current state:

- canonical architecture: `DESIGN.md`
- contract/types: `contracts.ts`
- language adapter interface: `adapters/types.ts`
- first adapter metadata: `adapters/python.ts`
- extension entrypoint scaffold: `index.ts`

Parser loading and tool registration are intentionally deferred to:

- `0006.2` (parser + `treesitter_outline`)
- `0006.3` (`treesitter_context` + `treesitter_find`)
