import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS_DIR = Path(__file__).parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

from py_callers import analyze_file, scan_repo  # noqa: E402


class AnalyzeFileTest(unittest.TestCase):
    def test_counts_only_proven_direct_and_imported_module_calls(self) -> None:
        source = """
from library import target as imported_target
import package.module as module

def target():
    return None

def direct_caller():
    target()

def imported_caller():
    imported_target()

def module_caller():
    module.target()

def unrelated_receiver(client):
    client.target()

def shadowed_module(module):
    module.target()

def shadowed_callable(target):
    target()

def rebound_callable():
    imported_target = replacement
    imported_target()

def comprehension_caller(items):
    [imported_target() for imported_target in items]
    imported_target()

shadowed_lambda = lambda target: target()
shadowed_walrus = lambda: ((target := replacement), target())[1]
"""
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "sample.py"
            path.write_text(source)
            facts = analyze_file(path, {"target"})

        callers = {function for _line, function in facts.calls["target"]}
        self.assertEqual(
            callers,
            {
                "direct_caller",
                "imported_caller",
                "module_caller",
                "comprehension_caller",
            },
        )
        self.assertNotIn("unrelated_receiver", callers)
        self.assertNotIn("shadowed_module", callers)
        self.assertNotIn("shadowed_callable", callers)
        self.assertNotIn("rebound_callable", callers)
        self.assertNotIn("<module>", callers)

    def test_comprehension_walrus_rebinds_in_the_containing_scope(self) -> None:
        source = """
from library import target
[(target := item) for item in items]
target()
"""
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "sample.py"
            path.write_text(source)
            facts = analyze_file(path, {"target"})

        self.assertNotIn("target", facts.calls)

    def test_repo_scan_matches_imports_to_the_defining_module(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "local.py").write_text("def target(): pass\n")
            (root / "external_use.py").write_text(
                "from thirdparty import target\n"
                "target()\n"
            )
            (root / "local_use.py").write_text(
                "from local import target\n"
                "target()\n"
            )

            facts = {item.path.name: item for item in scan_repo(root, {"target"})}

        self.assertNotIn("target", facts["external_use.py"].calls)
        self.assertEqual(
            facts["local_use.py"].calls["target"],
            [(2, "<module>")],
        )

    def test_repo_scan_resolves_src_layout_imports_from_repo_root(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            package = root / "src" / "package"
            package.mkdir(parents=True)
            (package / "__init__.py").write_text("")
            (package / "impl.py").write_text("def target(): pass\n")
            tests = root / "tests"
            tests.mkdir()
            (tests / "test_use.py").write_text(
                "from package.impl import target\n"
                "target()\n"
            )

            facts = {item.path.name: item for item in scan_repo(root, {"target"})}

        self.assertEqual(
            facts["test_use.py"].calls["target"],
            [(2, "<module>")],
        )

    def test_repo_scan_resolves_nested_package_init_definitions(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            package = root / "backend" / "package"
            package.mkdir(parents=True)
            (package / "__init__.py").write_text("def target(): pass\n")
            (root / "use.py").write_text(
                "from package import target\n"
                "target()\n"
            )

            facts = {item.path.name: item for item in scan_repo(root, {"target"})}

        self.assertEqual(facts["use.py"].calls["target"], [(2, "<module>")])

    def test_repo_scan_resolves_from_imported_submodules(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            package = root / "package"
            package.mkdir()
            (package / "__init__.py").write_text("")
            (package / "module.py").write_text("def target(): pass\n")
            (root / "use.py").write_text(
                "from package import module\n"
                "module.target()\n"
            )

            facts = {item.path.name: item for item in scan_repo(root, {"target"})}

        self.assertEqual(facts["use.py"].calls["target"], [(2, "<module>")])

    def test_repo_scan_resolves_relative_imports(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            package = root / "package"
            package.mkdir()
            (package / "__init__.py").write_text("")
            (package / "impl.py").write_text("def target(): pass\n")
            (package / "use.py").write_text(
                "from .impl import target\n"
                "target()\n"
            )

            facts = {item.path.name: item for item in scan_repo(root, {"target"})}

        self.assertEqual(facts["use.py"].calls["target"], [(2, "<module>")])

    def test_function_definition_clears_import_alias_provenance(self) -> None:
        source = """
from library import target as helper

def helper():
    return None

helper()
"""
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "sample.py"
            path.write_text(source)
            facts = analyze_file(path, {"target"})

        self.assertNotIn("target", facts.calls)

    def test_rebinding_clears_a_local_target_definition(self) -> None:
        source = """
def target():
    return None

target = replacement
target()
"""
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "sample.py"
            path.write_text(source)
            facts = analyze_file(path, {"target"})

        self.assertNotIn("target", facts.calls)

    def test_tracks_calls_across_sequential_reimports(self) -> None:
        source = """
from first import target
target()
from second import target
target()
"""
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "sample.py"
            path.write_text(source)
            facts = analyze_file(path, {"target"})

        self.assertEqual(
            [line for line, _function in facts.calls["target"]],
            [3, 5],
        )

    def test_import_only_lines_respect_module_identity(self) -> None:
        source = """
from local import target
from thirdparty import target as external_target
"""
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "sample.py"
            path.write_text(source)
            facts = analyze_file(
                path,
                {"target"},
                {"target": {"local"}},
            )

        self.assertEqual(facts.import_only_lines["target"], [2])

    def test_reports_only_the_import_line_for_an_uncalled_target(self) -> None:
        source = """
from library import target
import os
"""
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "sample.py"
            path.write_text(source)
            facts = analyze_file(path, {"target"})

        self.assertEqual(facts.import_only_lines["target"], [2])


if __name__ == "__main__":
    unittest.main()
