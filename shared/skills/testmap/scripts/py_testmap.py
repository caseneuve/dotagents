#!/usr/bin/env python3
"""Scenario 1 (forward): does each function/class in --src have a test in
its expected test module?

Static, no-execution check. For every top-level function/class in --src,
computes the expected test file path (default: <pkg>/<module>.py ->
<pkg>/tests/test_<module>.py, including mirrored nested test directories),
checks whether that file exists, and whether each symbol is referenced
(imported, called, and/or named in a static @patch target) there. Falls back
to a repo-wide scan of test_*.py / *_test.py files to catch tests that exist but
live in the "wrong" file per the convention.

This proves "referenced by name in test code somewhere", not "meaningfully
tested" or "behaviorally covered" -- see the testmap skill's SKILL.md for
the limitations that must stay attached to any report this produces.

See py_testtarget.py for the reverse direction: given a test file, does
every test in it target its own module's symbols, or has it drifted to
cover something else?
"""

from __future__ import annotations

import argparse
import ast
import sys
from pathlib import Path

from _common import (
    resolve_import_calls,
    static_patch_targets,
    is_test_file,
    parse_imports,
    resolve_module_to_path,
    top_level_defs,
)


def _flattened_candidate_targets_source(src: Path, app_dir: Path) -> bool:
    """Whether the reverse convention maps an app-level test back to ``src``."""
    naive = app_dir / src.name
    if naive.is_file():
        return naive == src

    matches = [
        path
        for path in app_dir.rglob(src.name)
        if not is_test_file(path)
        and "tests" not in path.relative_to(app_dir).parts[:-1]
    ]
    return matches == [src]


def default_expected_test_path(src: Path, root: Path) -> Path:
    """Find a flattened or mirrored test path below a source ancestor.

    Supports both `<app>/tests/test_<module>.py` and
    `<app>/tests/<source-subdirectories>/test_<module>.py`. The flattened
    form preserves Django's `management/commands` convention.
    """
    module_name = src.stem
    naive = src.parent / "tests" / f"test_{module_name}.py"
    if naive.is_file():
        return naive
    current = src.parent
    while True:
        relative_parent = src.parent.relative_to(current)
        mirrored = current / "tests" / relative_parent / f"test_{module_name}.py"
        candidate = current / "tests" / f"test_{module_name}.py"
        # A mirrored path is more specific than the flattened fallback when
        # both exist under the same app directory.
        if mirrored.is_file():
            return mirrored
        if candidate.is_file() and _flattened_candidate_targets_source(src, current):
            return candidate

        if current == root or current.parent == current:
            break
        current = current.parent
    return naive


def expected_test_path(
    src: Path, root: Path, test_pattern: str | None = None
) -> Path:
    """Return the normalized expected test path for the selected convention."""
    if test_pattern:
        return (src.parent / test_pattern.format(module=src.stem)).resolve()
    return default_expected_test_path(src, root).resolve()


def scan_file_for_symbols(
    path: Path, root: Path, source: Path, targets: set[str]
) -> dict[str, dict[str, bool]]:
    """Return references that resolve to the specific source module."""
    result = {
        t: {"imported": False, "called": False, "patched": False}
        for t in targets
    }
    try:
        tree = ast.parse(path.read_text(), filename=str(path))
    except (SyntaxError, UnicodeDecodeError):
        return result

    imports = [
        imported
        for imported in parse_imports(tree)
        if resolve_module_to_path(root, imported.dotted_module, path) == source
    ]
    for imported in imports:
        if not imported.is_module and imported.original_name in targets:
            result[imported.original_name]["imported"] = True

    for call in resolve_import_calls(tree):
        if (
            call.symbol in targets
            and resolve_module_to_path(root, call.dotted_module, path) == source
        ):
            result[call.symbol]["imported"] = True
            result[call.symbol]["called"] = True

    for target in static_patch_targets(tree):
        if (
            target.symbol in targets
            and resolve_module_to_path(root, target.dotted_module, path) == source
        ):
            result[target.symbol]["patched"] = True
    return result


def scan_repo_for_symbols(
    root: Path, source: Path, targets: set[str]
) -> dict[str, dict[str, dict[str, bool]]]:
    combined: dict[str, dict[str, dict[str, bool]]] = {t: {} for t in targets}
    for path in root.rglob("*.py"):
        rel = path.relative_to(root)
        if any(part.startswith(".") for part in rel.parts):
            continue
        if not is_test_file(path):
            continue
        refs = scan_file_for_symbols(path, root, source, targets)
        for symbol, flags in refs.items():
            if flags["imported"] or flags["called"] or flags["patched"]:
                combined[symbol][str(path)] = flags
    return combined


def classify(expected_key: str, refs_by_file: dict[str, dict[str, bool]]) -> str:
    expected_refs = refs_by_file.get(expected_key)
    if expected_refs and expected_refs["called"]:
        return "placed"

    other_called = [
        file
        for file, flags in refs_by_file.items()
        if file != expected_key and flags["called"]
    ]
    if other_called:
        extra = f" (+{len(other_called) - 1} more)" if len(other_called) > 1 else ""
        return f"misplaced: {other_called[0]}{extra}"

    if expected_refs and expected_refs["patched"]:
        return "patched only (no direct call found)"

    other_patched = [
        file
        for file, flags in refs_by_file.items()
        if file != expected_key and flags["patched"]
    ]
    if other_patched:
        return f"patched only, elsewhere: {other_patched[0]}"

    if expected_refs and expected_refs["imported"]:
        return "imported only (no direct call found)"

    other_imported = [
        file
        for file, flags in refs_by_file.items()
        if file != expected_key and flags["imported"]
    ]
    if other_imported:
        return f"imported only, elsewhere: {other_imported[0]}"

    return "no reference found"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True, type=Path)
    parser.add_argument("--src", required=True, type=Path)
    parser.add_argument(
        "--test-pattern",
        default=None,
        help="Override expected test path, e.g. 'tests/test_{module}.py' relative to --src's dir",
    )
    parser.add_argument("--include-private", action="store_true")
    args = parser.parse_args()

    root = args.root.resolve()
    src = args.src.resolve()
    if not root.is_dir():
        print(f"--root {root} is not a directory", file=sys.stderr)
        sys.exit(1)
    if not src.is_file():
        print(f"--src {src} is not a file", file=sys.stderr)
        sys.exit(1)

    expected = expected_test_path(src, root, args.test_pattern)

    symbols = top_level_defs(src, args.include_private)
    if not symbols:
        print(f"No top-level function/class definitions found in {src}", file=sys.stderr)
        return

    names = {name for name, _ in symbols}
    combined = scan_repo_for_symbols(root, src, names)

    expected_exists = expected.is_file()
    rel_expected = expected.relative_to(root) if expected_exists else expected

    print(f"expected test file: {rel_expected}  ({'exists' if expected_exists else 'MISSING'})")
    print()
    col1 = max(len(n) for n, _ in symbols) + 2
    print(f"{'symbol'.ljust(col1)}line  status")
    print("-" * (col1 + 60))
    for name, lineno in symbols:
        status = classify(str(expected), combined.get(name, {}))
        print(f"{name.ljust(col1)}{str(lineno).ljust(6)}{status}")

    print(
        "\nNOTE: static reference check only, no tests executed. 'placed'/'patched only'/\n"
        "'no reference found' mean 'statically referenced/not referenced in test code' --\n"
        "not proof of behavioral coverage or its absence (indirect/integration-test\n"
        "coverage is a known false negative here). Run the real suite for that.",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
