# dataflow — Python

Use `scripts/py_typeflow.py` to pull real signature/type info and a
first-pass purity classification for a set of functions, instead of reading
each one by hand from scratch. It is a starting point for steps 2 and 3a —
always confirm borderline purity calls by reading the body.

## Usage

```bash
python3 <path-to-this-skill>/scripts/py_typeflow.py --root <repo_root> SYMBOL [SYMBOL ...]
```

Example:

```bash
python3 ~/.agents/skills/dataflow/scripts/py_typeflow.py \
  --root src \
  process_order fetch_inventory decide_shipping_method
```

Output, per symbol:

```
process_order(order: Order, warehouse: Warehouse, dry_run: bool) -> Order
  defined in: orders/pipeline.py:88
  purity: mixed (calls fetch_inventory [I/O: cursor.execute], assigns local, calls dispatch_shipment)
  flags: return type Order — same type as first param (uses dataclasses.replace)

decide_shipping_method(is_express: bool, is_international: bool) -> ShippingMethod
  defined in: orders/pipeline.py:40
  purity: pure (no I/O calls, no attribute-assignment on non-local names, no global/nonlocal)

fetch_inventory(warehouse_id: str, sku: str) -> list[tuple]
  defined in: orders/inventory.py:21
  purity: side-effecting (cursor.execute, socket/db context manager)
  flags: return type list[tuple] — Any-shaped, no element schema
```

## What "purity" means here (heuristic, not proof)

The script flags a function **side-effecting** if its body contains, at any
nesting depth:
- a call to anything matching common I/O names (`execute`, `fetchone`,
  `fetchall`, `open`, `write`, `send`, `post`, `get` on a requests-like
  object, `subprocess.*`, `socket.*`, ORM `.save()`/`.delete()`/`.create()`)
- a `with` block (context managers are almost always guarding a resource)
- assignment, augmented assignment, or deletion through an attribute/subscript
  of something that isn't locally created (`self.x = ...`, `arg.attr += 1`,
  `items[0] = ...`, `del items[0]`), a `global`/`nonlocal` declaration, or a
  read from a free module/global name
- a call to `time.time`/`datetime.now`/`random.*`/`uuid.*` (ambient,
  non-deterministic state)

It flags **mixed** if the body has both at least one such call/statement
*and* at least one non-trivial pure expression/return not just passing
values through untouched. It flags **pure** only when none of the above or
unresolved calls appear in the function's directly executed body. Any call
that is not itself a recognized I/O/ambient-state marker is reported as
`unknown`; the helper does not inspect callees transitively. Bodies of nested
functions and lambdas are excluded because defining them does not execute
them.

## What this script does NOT do

- It does not resolve whether a called function's *own* purity is
  transitively pure. If `fetch_inventory()` were itself pure, the caller is
  still reported as unknown until you inspect that function separately
  (pass it explicitly as its own SYMBOL argument).
- It does not run a real type checker. Types shown come from source
  annotations only — always prefer mypy/pyright output over this when both
  are available, and treat this script's `Any`-shaped flags as a lower bound
  (the real checker may find worse).
- It does not detect purity violations hidden behind indirection
  (`getattr`, monkeypatching, decorators that wrap the function in
  something side-effecting). Read the source if a decorator is present —
  the script reports decorators by name but does not analyze what they do.
