#!/usr/bin/env python3
"""Scenario 2 (reverse): given a test file, does every test in it target
symbols from its own expected source module, or has it drifted to cover
something else?

Static, no-execution check. Computes the expected source module from the
test file's own path (reverse of py_testmap.py's convention: default
<pkg>/tests/test_<module>.py -> <pkg>/<module>.py, including nested mirrored
test directories). For every test function/method in --test-src, resolves
which in-repo, non-test production symbols it directly calls or names in a
static @patch decorator, and reports whether those references stay within the
expected module or reach into another one.

Only symbols resolvable to a real .py file under --root that is not itself
a test file are considered "production symbols" -- framework/stdlib/mock
imports are not in scope and won't be flagged.
"""

from __future__ import annotations

import argparse
import ast
import sys
from pathlib import Path

from _common import (
    ImportedName,
    ResolvedImportCall,
    StaticPatchTarget,
    TestUnit,
    resolve_import_calls,
    static_patch_targets,
    is_test_file,
    parse_imports,
    resolve_module_to_path,
    test_units,
)


def default_expected_source_path(test_src: Path, root: Path) -> Path | None:
    rel = test_src.relative_to(root)
    parts = list(rel.parts)
    name = parts[-1]
    if not name.startswith("test_"):
        return None
    try:
        tests_index = parts.index("tests")
    except ValueError:
        return None

    module_name = name[len("test_") :]
    package_parts = parts[:tests_index]
    nested_parts = parts[tests_index + 1 : -1]
    mirrored = root / Path(*package_parts, *nested_parts) / module_name
    if mirrored.is_file():
        return mirrored

    naive = root / Path(*package_parts) / module_name
    if naive.is_file():
        return naive
    # Django's `<app>/management/commands/<module>.py` (and similar nested
    # layouts) don't live directly beside `<app>/tests/`. Fall back to a
    # recursive search under the app dir for an unambiguous match before
    # giving up -- if more than one file has this name, refuse to guess.
    app_dir = root / Path(*package_parts)
    if app_dir.is_dir():
        matches = [
            p
            for p in app_dir.rglob(module_name)
            if not is_test_file(p) and "tests" not in p.relative_to(app_dir).parts[:-1]
        ]
        if len(matches) == 1:
            return matches[0]
    return naive


def build_production_import_map(
    tree: ast.AST, root: Path, source_path: Path
) -> tuple[list[ImportedName], dict[str, Path]]:
    """Return resolvable production imports and source paths by module."""
    imports: list[ImportedName] = []
    paths_by_module: dict[str, Path] = {}
    for imported in parse_imports(tree):
        resolved = resolve_module_to_path(
            root, imported.dotted_module, source_path
        )
        submodule_path = None
        imported_submodule = None
        if not imported.is_module:
            imported_submodule = (
                f"{imported.dotted_module}{imported.original_name}"
                if imported.dotted_module.endswith(".")
                else f"{imported.dotted_module}.{imported.original_name}"
            )
            submodule_path = resolve_module_to_path(
                root, imported_submodule, source_path
            )

        valid_module = resolved is not None and not is_test_file(resolved)
        valid_submodule = (
            submodule_path is not None and not is_test_file(submodule_path)
        )
        if not valid_module and not valid_submodule:
            continue
        imports.append(imported)
        if valid_module and resolved is not None:
            paths_by_module[imported.dotted_module] = resolved
        if (
            valid_submodule
            and imported_submodule is not None
            and submodule_path is not None
        ):
            paths_by_module[imported_submodule] = submodule_path
    return imports, paths_by_module


def classify_test_unit(
    unit: TestUnit,
    resolved_calls: list[ResolvedImportCall],
    patch_targets: list[StaticPatchTarget],
    paths_by_module: dict[str, Path],
    root: Path,
    expected_source: Path,
) -> str:
    """Classify one test's direct calls and static ``@patch`` references."""
    call_lines = {
        node.lineno for node in ast.walk(unit.node) if isinstance(node, ast.Call)
    }
    called_symbols = {
        (call.symbol, call.dotted_module)
        for call in resolved_calls
        if call.lineno in call_lines and call.dotted_module in paths_by_module
    }
    class_name, separator, _method_name = unit.qualname.partition(".")
    patched_symbols = {
        (target.symbol, resolved)
        for target in patch_targets
        if (
            target.lineno in call_lines
            or (
                separator
                and target.applies_to_class
                and target.class_name == class_name
            )
        )
        and (resolved := resolve_module_to_path(root, target.dotted_module)) is not None
        and not is_test_file(resolved)
    }

    on_target: set[str] = set()
    on_target_patches: set[str] = set()
    off_target: dict[str, Path] = {}
    off_target_patches: dict[str, Path] = {}
    for name, module in called_symbols:
        path = paths_by_module[module]
        if path == expected_source:
            on_target.add(name)
        else:
            off_target[name] = path
    for name, path in patched_symbols:
        if path == expected_source:
            on_target_patches.add(name)
        else:
            off_target_patches[name] = path

    if not called_symbols and not patched_symbols:
        return "no production symbols called (fixture-only / trivial?)"
    if off_target or off_target_patches:
        direct_items = [
            f"{name} ({path.relative_to(root)})" for name, path in off_target.items()
        ]
        patch_items = [
            f"{name} ({path.relative_to(root)}; patched)"
            for name, path in off_target_patches.items()
        ]
        return f"⚠ off-target: {', '.join([*direct_items, *patch_items])}"

    items = [
        *sorted(on_target),
        *(f"patched: {name}" for name in sorted(on_target_patches)),
    ]
    return f"on-target ({', '.join(items)})"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True, type=Path)
    parser.add_argument("--test-src", required=True, type=Path)
    parser.add_argument(
        "--expected-source",
        default=None,
        type=Path,
        help="Override the expected source module path (relative to --root)",
    )
    args = parser.parse_args()

    root = args.root.resolve()
    test_src = args.test_src.resolve()
    if not root.is_dir():
        print(f"--root {root} is not a directory", file=sys.stderr)
        sys.exit(1)
    if not test_src.is_file():
        print(f"--test-src {test_src} is not a file", file=sys.stderr)
        sys.exit(1)

    expected_source = (
        (root / args.expected_source).resolve()
        if args.expected_source
        else default_expected_source_path(test_src, root)
    )
    if expected_source is None:
        print(
            "Could not derive expected source module from --test-src path "
            "(expected a test_<module>.py below <pkg>/tests/) -- pass "
            "--expected-source explicitly.",
            file=sys.stderr,
        )
        sys.exit(1)

    tree = ast.parse(test_src.read_text(), filename=str(test_src))
    _production_imports, paths_by_module = build_production_import_map(
        tree, root, test_src
    )
    resolved_calls = resolve_import_calls(tree)

    units = test_units(tree)
    if not units:
        print(f"No test functions/methods found in {test_src}", file=sys.stderr)
        return

    expected_exists = expected_source.is_file()
    rel_expected = (
        expected_source.relative_to(root) if expected_exists else expected_source
    )
    print(
        f"expected source module: {rel_expected}"
        f"  ({'exists' if expected_exists else 'MISSING'})"
    )
    print()

    col1 = max(len(u.qualname) for u in units) + 2
    print(f"{'test'.ljust(col1)}line  status")
    print("-" * (col1 + 60))

    patch_targets = static_patch_targets(tree)
    any_off_target = False
    for unit in units:
        status = classify_test_unit(
            unit,
            resolved_calls,
            patch_targets,
            paths_by_module,
            root,
            expected_source,
        )
        if status.startswith("⚠ off-target:"):
            any_off_target = True

        print(f"{unit.qualname.ljust(col1)}{str(unit.lineno).ljust(6)}{status}")

    print(
        "\nNOTE: static reference check only, no tests executed. 'on-target' means every\n"
        "resolvable production-code call or static @patch target in that test body belongs\n"
        "to the expected source module; it does not mean the test is otherwise correct.\n"
        "Calls to symbols this script couldn't resolve under --root (dynamic dispatch,\n"
        "external packages) are silently excluded, not counted as on-target.",
        file=sys.stderr,
    )
    if any_off_target:
        print(
            "\nOff-target calls found: this may be a legitimate integration test that "
            "intentionally\nexercises another module too -- confirm before moving anything.",
            file=sys.stderr,
        )


if __name__ == "__main__":
    main()
