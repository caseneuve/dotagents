import ast
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS_DIR = Path(__file__).parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

from _common import (  # noqa: E402
    imported_calls_in_scope,
    resolve_import_calls,
    resolve_module_to_path,
)
from py_testmap import scan_file_for_symbols  # noqa: E402
from py_testtarget import build_production_import_map  # noqa: E402


class ImportedCallsTest(unittest.TestCase):
    def test_absolute_import_resolution_does_not_drop_package_prefixes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "models.py").write_text("class Q: pass\n")

            resolved = resolve_module_to_path(root, "django.db.models")

        self.assertIsNone(resolved)

    def test_resolves_direct_and_module_calls_without_counting_bare_reads(self) -> None:
        tree = ast.parse(
            """
from package.direct import target as direct_target
import package.module as module

bare_reference = direct_target
direct_target()
module.target()
client.target()
"""
        )

        calls = imported_calls_in_scope(tree)

        self.assertEqual(
            calls,
            {
                ("target", "package.direct"),
                ("target", "package.module"),
            },
        )

    def test_comprehension_target_scope_does_not_leak(self) -> None:
        tree = ast.parse(
            """
from package.expected import target
[target() for target in callbacks]
target()
"""
        )

        calls = resolve_import_calls(tree)
        self.assertEqual(
            [(call.lineno, call.symbol, call.dotted_module) for call in calls],
            [(4, "target", "package.expected")],
        )

    def test_comprehension_walrus_rebinds_in_the_containing_scope(self) -> None:
        tree = ast.parse(
            """
from package.expected import target
[(target := item) for item in items]
target()
"""
        )

        self.assertEqual(imported_calls_in_scope(tree), set())

    def test_function_definition_clears_import_alias_provenance(self) -> None:
        tree = ast.parse(
            """
from package.expected import target as helper

def helper():
    return None

helper()
"""
        )

        self.assertEqual(imported_calls_in_scope(tree), set())

    def test_rebinding_clears_import_provenance(self) -> None:
        tree = ast.parse(
            """
from package.expected import target
target = replacement
target()
"""
        )

        self.assertEqual(imported_calls_in_scope(tree), set())

    def test_sequential_reimports_keep_per_call_provenance(self) -> None:
        tree = ast.parse(
            """
from package.expected import target
target()
from package.other import target
target()
"""
        )

        self.assertEqual(
            imported_calls_in_scope(tree),
            {
                ("target", "package.expected"),
                ("target", "package.other"),
            },
        )

    def test_function_local_import_shadows_a_module_import(self) -> None:
        tree = ast.parse(
            """
from package.expected import target

def test_uses_other_target():
    from package.other import target
    target()
"""
        )

        self.assertEqual(
            imported_calls_in_scope(tree),
            {("target", "package.other")},
        )

    def test_forward_mapping_requires_the_expected_source_module(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            package = root / "package"
            package.mkdir()
            source = package / "source.py"
            source.write_text("def target(): pass\n")
            (package / "other.py").write_text("def target(): pass\n")
            test_file = root / "test_sample.py"
            test_file.write_text(
                "from package.other import target\n"
                "target()\n"
            )
            unrelated_references = scan_file_for_symbols(
                test_file, root, source, {"target"}
            )

            test_file.write_text(
                "import package.source as source_module\n"
                "source_module.target()\n"
            )
            references = scan_file_for_symbols(
                test_file, root, source, {"target"}
            )

        self.assertEqual(
            unrelated_references,
            {"target": {"imported": False, "called": False}},
        )
        self.assertEqual(
            references,
            {"target": {"imported": True, "called": True}},
        )

    def test_reverse_mapping_indexes_from_imported_submodules(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            package = root / "package"
            package.mkdir()
            (package / "__init__.py").write_text("")
            source = package / "module.py"
            source.write_text("def target(): pass\n")
            test_file = root / "test_module.py"
            tree = ast.parse(
                "from package import module\n"
                "module.target()\n"
            )

            _imports, paths = build_production_import_map(
                tree, root, test_file
            )

        self.assertEqual(paths["package.module"], source)

    def test_forward_mapping_resolves_from_imported_submodules(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            package = root / "package"
            package.mkdir()
            (package / "__init__.py").write_text("")
            source = package / "module.py"
            source.write_text("def target(): pass\n")
            test_file = root / "test_module.py"
            test_file.write_text(
                "from package import module\n"
                "module.target()\n"
            )

            references = scan_file_for_symbols(
                test_file, root, source, {"target"}
            )

        self.assertEqual(
            references,
            {"target": {"imported": True, "called": True}},
        )

    def test_forward_mapping_resolves_relative_imports(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            package = root / "package"
            package.mkdir()
            (package / "__init__.py").write_text("")
            source = package / "source.py"
            source.write_text("def target(): pass\n")
            test_file = package / "test_source.py"
            test_file.write_text(
                "from .source import target\n"
                "target()\n"
            )

            references = scan_file_for_symbols(
                test_file, root, source, {"target"}
            )

        self.assertEqual(
            references,
            {"target": {"imported": True, "called": True}},
        )

    def test_does_not_count_an_imported_name_read_as_a_call(self) -> None:
        tree = ast.parse(
            """
from package.direct import target
alias = target
"""
        )

        self.assertEqual(imported_calls_in_scope(tree), set())


if __name__ == "__main__":
    unittest.main()
