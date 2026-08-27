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
    static_patch_targets,
    test_units,
)
from py_testmap import (  # noqa: E402
    classify,
    expected_test_path,
    scan_file_for_symbols,
)
from py_testtarget import (  # noqa: E402
    build_production_import_map,
    classify_test_unit,
    default_expected_source_path,
)


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
            {"target": {"imported": False, "called": False, "patched": False}},
        )
        self.assertEqual(
            references,
            {"target": {"imported": True, "called": True, "patched": False}},
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
            {"target": {"imported": True, "called": True, "patched": False}},
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
            {"target": {"imported": True, "called": True, "patched": False}},
        )

    def test_does_not_count_an_imported_name_read_as_a_call(self) -> None:
        tree = ast.parse(
            """
from package.direct import target
alias = target
"""
        )

        self.assertEqual(imported_calls_in_scope(tree), set())

    def test_nested_test_layout_and_module_alias_are_placed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "foo" / "module" / "blah.py"
            source.parent.mkdir(parents=True)
            source.write_text("def target(): pass\n")
            test_file = root / "foo" / "tests" / "module" / "test_blah.py"
            test_file.parent.mkdir(parents=True)
            test_file.write_text(
                "import foo.module.blah as quux\n"
                "\n"
                "def test_target():\n"
                "    quux.target()\n"
            )

            expected = expected_test_path(source, root)
            references = scan_file_for_symbols(test_file, root, source, {"target"})
            reversed_source = default_expected_source_path(test_file, root)

        self.assertEqual(expected, test_file)
        self.assertEqual(reversed_source, source)
        self.assertEqual(
            references,
            {"target": {"imported": True, "called": True, "patched": False}},
        )
        self.assertEqual(
            classify(str(expected), {str(test_file): references["target"]}),
            "placed",
        )

    def test_mirrored_test_path_wins_over_flattened_basename_collision(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "foo" / "bar.py"
            source.parent.mkdir()
            source.write_text("def target(): pass\n")
            flattened = root / "tests" / "test_bar.py"
            flattened.parent.mkdir()
            flattened.write_text("def test_flattened(): pass\n")
            mirrored = root / "tests" / "foo" / "test_bar.py"
            mirrored.parent.mkdir()
            mirrored.write_text("def test_mirrored(): pass\n")

            expected = expected_test_path(source, root)

        self.assertEqual(expected, mirrored)

    def test_flattened_test_for_sibling_is_not_selected_for_nested_source(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            sibling_source = root / "foo" / "blah.py"
            sibling_source.parent.mkdir()
            sibling_source.write_text("def sibling(): pass\n")
            nested_source = root / "foo" / "module" / "blah.py"
            nested_source.parent.mkdir()
            nested_source.write_text("def nested(): pass\n")
            flattened = root / "foo" / "tests" / "test_blah.py"
            flattened.parent.mkdir()
            flattened.write_text("def test_blah(): pass\n")

            expected = expected_test_path(nested_source, root)
            reversed_source = default_expected_source_path(flattened, root)

        self.assertNotEqual(expected, flattened)
        self.assertEqual(reversed_source, sibling_source)

    def test_unambiguous_flattened_test_still_maps_to_nested_source(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "foo" / "management" / "commands" / "blah.py"
            source.parent.mkdir(parents=True)
            source.write_text("def target(): pass\n")
            flattened = root / "foo" / "tests" / "test_blah.py"
            flattened.parent.mkdir()
            flattened.write_text("def test_blah(): pass\n")

            expected = expected_test_path(source, root)
            reversed_source = default_expected_source_path(flattened, root)

        self.assertEqual(expected, flattened)
        self.assertEqual(reversed_source, source)

    def test_relative_test_pattern_is_normalized_before_classification(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "foo" / "module" / "blah.py"
            source.parent.mkdir(parents=True)
            source.write_text("def target(): pass\n")
            test_file = root / "foo" / "tests" / "module" / "test_blah.py"
            test_file.parent.mkdir(parents=True)
            test_file.write_text(
                "from foo.module.blah import target\n"
                "\n"
                "def test_target():\n"
                "    target()\n"
            )

            expected = expected_test_path(
                source, root, "../tests/module/test_{module}.py"
            )
            references = scan_file_for_symbols(test_file, root, source, {"target"})

        self.assertEqual(expected, test_file)
        self.assertEqual(
            classify(str(expected), {str(test_file): references["target"]}),
            "placed",
        )

    def test_class_patch_target_uses_class_constant_not_module_constant(self) -> None:
        tree = ast.parse(
            """
from unittest.mock import patch

TESTED_MODULE = "foo.bar"

class SomeTests:
    TESTED_MODULE = "foo.other"

    @patch(f"{TESTED_MODULE}.target")
    def test_target(self, mock_target):
        pass
"""
        )

        targets = static_patch_targets(tree)

        self.assertEqual(
            [
                (target.dotted_module, target.symbol, target.class_name)
                for target in targets
            ],
            [("foo.other", "target", "SomeTests")],
        )

    def test_method_patch_target_does_not_apply_to_other_test_methods(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "foo" / "bar.py"
            source.parent.mkdir()
            source.write_text("def target(): pass\n")
            tree = ast.parse(
                """
from unittest.mock import patch

class TestBar:
    @patch("foo.bar.target")
    def test_first(self, mock_target):
        pass

    def test_second(self):
        pass
"""
            )

            units = test_units(tree)
            status = classify_test_unit(
                units[1],
                resolve_import_calls(tree),
                static_patch_targets(tree),
                {},
                root,
                source,
            )

        self.assertEqual(status, "no production symbols called (fixture-only / trivial?)")

    def test_class_patch_target_applies_to_each_test_method_in_reverse_mapping(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "foo" / "bar.py"
            source.parent.mkdir()
            source.write_text("def target(): pass\n")
            tree = ast.parse(
                """
from unittest.mock import patch

@patch("foo.bar.target")
class TestBar:
    def test_target(self, mock_target):
        pass
"""
            )

            status = classify_test_unit(
                test_units(tree)[0],
                resolve_import_calls(tree),
                static_patch_targets(tree),
                {},
                root,
                source,
            )

        self.assertEqual(status, "on-target (patched: target)")

    def test_static_patch_target_accepts_import_alias_but_not_arbitrary_patch_method(self) -> None:
        tree = ast.parse(
            """
from unittest.mock import patch as mock_patch

class Helper:
    def patch(self, target):
        return target

helper = Helper()

@mock_patch("foo.bar.target")
def test_alias(mock_target):
    pass

@helper.patch("foo.other.target")
def test_unrelated_method():
    pass
"""
        )

        targets = static_patch_targets(tree)

        self.assertEqual(
            [(target.dotted_module, target.symbol) for target in targets],
            [("foo.bar", "target")],
        )

    def test_static_fstring_patch_target_is_reported_without_counting_a_call(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "foo" / "bar.py"
            source.parent.mkdir()
            source.write_text("def target(): pass\n")
            test_file = root / "foo" / "tests" / "test_bar.py"
            test_file.parent.mkdir()
            test_file.write_text(
                "from unittest.mock import patch\n"
                "\n"
                "TESTED_MODULE = \"foo.bar\"\n"
                "\n"
                "@patch(f\"{TESTED_MODULE}.target\")\n"
                "def test_target(mock_target):\n"
                "    pass\n"
            )

            tree = ast.parse(test_file.read_text())
            expected = expected_test_path(source, root)
            references = scan_file_for_symbols(test_file, root, source, {"target"})
            reverse_status = classify_test_unit(
                test_units(tree)[0],
                resolve_import_calls(tree),
                static_patch_targets(tree),
                {},
                root,
                source,
            )

        self.assertEqual(
            references,
            {"target": {"imported": False, "called": False, "patched": True}},
        )
        self.assertEqual(
            classify(str(expected), {str(test_file): references["target"]}),
            "patched only (no direct call found)",
        )
        self.assertEqual(reverse_status, "on-target (patched: target)")


if __name__ == "__main__":
    unittest.main()
