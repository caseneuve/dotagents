import ast
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS_DIR = Path(__file__).parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

from py_typeflow import _format_params, classify_purity, find_functions  # noqa: E402


class PurityClassificationTest(unittest.TestCase):
    def test_formats_every_python_parameter_kind(self) -> None:
        tree = ast.parse(
            "def sample(a: int, /, b: str = 'x', *items: bytes, "
            "flag: bool = False, **options: object) -> None: pass"
        )
        function = tree.body[0]
        self.assertIsInstance(function, ast.FunctionDef)

        self.assertEqual(
            _format_params(function),
            [
                "a: int",
                "/",
                "b: str = 'x'",
                "*items: bytes",
                "flag: bool = False",
                "**options: object",
            ],
        )

    def test_does_not_treat_an_uncalled_nested_body_as_executed(self) -> None:
        source = """
def outer() -> int:
    def deferred_io() -> str:
        with open("later.txt") as handle:
            return handle.read()

    return 1
"""
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "sample.py").write_text(source)
            [info] = find_functions(root, {"outer"})

        self.assertEqual(classify_purity(info), "pure")
        self.assertFalse(info.has_io_call)
        self.assertFalse(info.has_with_block)

    def test_counts_nested_function_defaults_but_not_its_body(self) -> None:
        source = """
def outer() -> int:
    def deferred(handle=open("now.txt")) -> str:
        return handle.read()

    return 1
"""
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "sample.py").write_text(source)
            [info] = find_functions(root, {"outer"})

        self.assertEqual(classify_purity(info), "side-effecting")
        self.assertIn("open() (line 3)", info.io_evidence)

    def test_treats_parameter_attribute_mutation_as_side_effecting(self) -> None:
        source = """
def mutate(value: object) -> None:
    value.changed = True
"""
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "sample.py").write_text(source)
            [info] = find_functions(root, {"mutate"})

        self.assertEqual(classify_purity(info), "side-effecting")
        self.assertTrue(info.has_external_attr_assign)

    def test_detects_parameter_subscript_and_augmented_mutation(self) -> None:
        source = """
def replace_item(value: list[int]) -> None:
    value[0] = 1

def increment_attr(value: object) -> None:
    value.changed += 1
"""
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "sample.py").write_text(source)
            infos = {
                info.name: info
                for info in find_functions(root, {"replace_item", "increment_attr"})
            }

        self.assertEqual(classify_purity(infos["replace_item"]), "side-effecting")
        self.assertEqual(classify_purity(infos["increment_attr"]), "side-effecting")

    def test_detects_destructured_assignment_and_deletion_mutation(self) -> None:
        source = """
def mutate(value: object, items: list[int]) -> None:
    value.changed, other = (True, False)
    del items[0]
"""
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "sample.py").write_text(source)
            [info] = find_functions(root, {"mutate"})

        self.assertEqual(classify_purity(info), "side-effecting")
        self.assertEqual(len(info.attr_assign_evidence), 2)

    def test_aliasing_a_parameter_preserves_caller_ownership(self) -> None:
        source = """
def mutate(value: object) -> None:
    alias = value
    alias.changed = True
"""
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "sample.py").write_text(source)
            [info] = find_functions(root, {"mutate"})

        self.assertEqual(classify_purity(info), "side-effecting")

    def test_local_container_mutation_is_not_an_external_side_effect(self) -> None:
        source = """
def build() -> int:
    items = {}
    items["value"] = 1
    return items["value"]
"""
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "sample.py").write_text(source)
            [info] = find_functions(root, {"build"})

        self.assertEqual(classify_purity(info), "pure")
        self.assertFalse(info.has_external_attr_assign)

    def test_parameter_mutation_before_local_rebinding_stays_visible(self) -> None:
        source = """
def mutate(value: object) -> None:
    value.changed = True
    value = {}
    value["local"] = True
"""
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "sample.py").write_text(source)
            [info] = find_functions(root, {"mutate"})

        self.assertEqual(classify_purity(info), "side-effecting")
        self.assertEqual(len(info.attr_assign_evidence), 1)

    def test_conditional_rebinding_is_not_treated_as_definite_ownership(self) -> None:
        source = """
def mutate(value: dict[str, int], replace: bool) -> None:
    if replace:
        value = {}
    value["x"] = 1
"""
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "sample.py").write_text(source)
            [info] = find_functions(root, {"mutate"})

        self.assertEqual(classify_purity(info), "side-effecting")

    def test_non_linear_rebinding_is_not_treated_as_definite_ownership(self) -> None:
        source = """
def loop_case(value: dict[str, int], flags: list[bool]) -> None:
    for replace in flags:
        if replace:
            value = {}
    value["x"] = 1

def try_case(value: dict[str, int]) -> None:
    try:
        value = {}
    except Exception:
        pass
    value["x"] = 1

def match_case(value: dict[str, int], replace: bool) -> None:
    match replace:
        case True:
            value = {}
        case _:
            pass
    value["x"] = 1
"""
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "sample.py").write_text(source)
            infos = {
                info.name: info
                for info in find_functions(
                    root, {"loop_case", "try_case", "match_case"}
                )
            }

        for info in infos.values():
            self.assertEqual(classify_purity(info), "side-effecting")

    def test_nested_assignment_does_not_hide_parameter_mutation(self) -> None:
        source = """
def mutate(value: object) -> None:
    def deferred() -> None:
        value = object()

    value.changed = True
"""
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "sample.py").write_text(source)
            [info] = find_functions(root, {"mutate"})

        self.assertEqual(classify_purity(info), "side-effecting")

    def test_comprehension_local_reads_are_not_global_state(self) -> None:
        source = """
def double(items: list[int]) -> list[int]:
    return [item * 2 for item in items]
"""
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "sample.py").write_text(source)
            [info] = find_functions(root, {"double"})

        self.assertEqual(classify_purity(info), "pure")
        self.assertEqual(info.global_read_evidence, [])

    def test_comprehension_walrus_binds_in_the_containing_scope(self) -> None:
        source = """
def last(items: list[int]) -> int:
    [(result := item) for item in items]
    return result
"""
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "sample.py").write_text(source)
            [info] = find_functions(root, {"last"})

        self.assertEqual(classify_purity(info), "pure")
        self.assertEqual(info.global_read_evidence, [])

    def test_comprehension_targets_do_not_hide_later_global_reads(self) -> None:
        source = """
def enabled(items: list[bool]) -> bool:
    [CONFIG for CONFIG in items]
    return CONFIG["enabled"]
"""
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "sample.py").write_text(source)
            [info] = find_functions(root, {"enabled"})

        self.assertNotEqual(classify_purity(info), "pure")
        self.assertIn("CONFIG (line 4)", info.global_read_evidence)

    def test_reads_from_module_state_as_side_effecting(self) -> None:
        source = """
def enabled() -> bool:
    return CONFIG["enabled"]
"""
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "sample.py").write_text(source)
            [info] = find_functions(root, {"enabled"})

        self.assertEqual(classify_purity(info), "mixed")
        self.assertEqual(info.global_read_evidence, ["CONFIG (line 3)"])

    def test_reports_unresolved_calls_as_unknown(self) -> None:
        source = """
def wrapper(value: int) -> int:
    return transform(value)
"""
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "sample.py").write_text(source)
            [info] = find_functions(root, {"wrapper"})

        self.assertTrue(classify_purity(info).startswith("unknown"))
        self.assertIn("transform() (line 3)", info.unresolved_calls)


if __name__ == "__main__":
    unittest.main()
