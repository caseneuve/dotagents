"""Shared AST utilities for testmap's two directions (forward: does a
function have a test; reverse: does a test target its own module).

No test execution, no import execution -- pure `ast` parsing.
"""

from __future__ import annotations

import ast
from dataclasses import dataclass, field
from pathlib import Path


def is_test_file(path: Path) -> bool:
    name = path.name
    return name.startswith("test_") or name.endswith("_test.py")


@dataclass
class ImportedName:
    local_name: str
    original_name: str
    dotted_module: str  # e.g. "billing.locks"
    is_module: bool


def parse_imports(tree: ast.AST) -> list[ImportedName]:
    out: list[ImportedName] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            dotted_module = f"{'.' * node.level}{node.module or ''}"
            for alias in node.names:
                out.append(
                    ImportedName(
                        local_name=alias.asname or alias.name,
                        original_name=alias.name,
                        dotted_module=dotted_module,
                        is_module=False,
                    )
                )
        elif isinstance(node, ast.Import):
            for alias in node.names:
                out.append(
                    ImportedName(
                        local_name=alias.asname or alias.name,
                        original_name=alias.name.split(".")[-1],
                        dotted_module=alias.name,
                        is_module=True,
                    )
                )
    return out


def resolve_module_to_path(
    root: Path, dotted_module: str, from_path: Path | None = None
) -> Path | None:
    """Best-effort import module to source path resolution."""
    if dotted_module.startswith("."):
        if from_path is None:
            return None
        level = len(dotted_module) - len(dotted_module.lstrip("."))
        module = dotted_module[level:]
        base = from_path.parent
        for _ in range(level - 1):
            base = base.parent
        if not module:
            package_init = base / "__init__.py"
            return package_init if package_init.is_file() else None
        candidate = base / Path(*module.split(".")).with_suffix(".py")
        if candidate.is_file():
            return candidate
        package = base / Path(*module.split(".")) / "__init__.py"
        return package if package.is_file() else None

    parts = dotted_module.split(".")
    candidate = root / Path(*parts).with_suffix(".py")
    if candidate.is_file():
        return candidate
    package = root / Path(*parts) / "__init__.py"
    return package if package.is_file() else None


def _dotted_name(node: ast.AST) -> str | None:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        parent = _dotted_name(node.value)
        return f"{parent}.{node.attr}" if parent else None
    return None


@dataclass
class ResolvedImportCall:
    lineno: int
    symbol: str
    dotted_module: str


@dataclass
class _ImportScope:
    bound_names: set[str] = field(default_factory=set)
    direct: dict[str, tuple[str, str]] = field(default_factory=dict)
    modules: dict[str, tuple[str, str]] = field(default_factory=dict)


class _ImportBindingCollector(ast.NodeVisitor):
    def __init__(self, params: set[str] | None = None) -> None:
        self.scope = _ImportScope(bound_names=set(params or ()))
        self.non_import_bindings = set(params or ())

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        self.scope.bound_names.add(node.name)
        self.non_import_bindings.add(node.name)

    visit_AsyncFunctionDef = visit_FunctionDef  # type: ignore[assignment]

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        self.scope.bound_names.add(node.name)
        self.non_import_bindings.add(node.name)

    def visit_Lambda(self, node: ast.Lambda) -> None:
        return

    def _collect_comprehension_bindings(self, node: ast.AST) -> None:
        for child in ast.walk(node):
            if isinstance(child, ast.NamedExpr):
                self.visit(child.target)

    def visit_ListComp(self, node: ast.ListComp) -> None:
        self._collect_comprehension_bindings(node)

    visit_SetComp = visit_ListComp  # type: ignore[assignment]
    visit_DictComp = visit_ListComp  # type: ignore[assignment]
    visit_GeneratorExp = visit_ListComp  # type: ignore[assignment]

    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            expression = alias.asname or alias.name
            bound_name = alias.asname or alias.name.split(".")[0]
            self.scope.bound_names.add(bound_name)
            self.scope.modules[expression] = (bound_name, alias.name)

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        dotted_module = f"{'.' * node.level}{node.module or ''}"
        for alias in node.names:
            local = alias.asname or alias.name
            imported_submodule = (
                f"{dotted_module}{alias.name}"
                if dotted_module.endswith(".")
                else f"{dotted_module}.{alias.name}"
            )
            self.scope.bound_names.add(local)
            self.scope.direct[local] = (alias.name, dotted_module)
            self.scope.modules[local] = (local, imported_submodule)

    def visit_Name(self, node: ast.Name) -> None:
        if isinstance(node.ctx, ast.Store):
            self.scope.bound_names.add(node.id)
            self.non_import_bindings.add(node.id)


def _build_import_scope(
    body: list[ast.stmt], params: set[str] | None = None
) -> _ImportScope:
    collector = _ImportBindingCollector(params)
    for statement in body:
        collector.visit(statement)
    for name in collector.non_import_bindings:
        collector.scope.direct.pop(name, None)
        collector.scope.modules = {
            expression: value
            for expression, value in collector.scope.modules.items()
            if value[0] != name
        }
    return collector.scope


class _ImportCallVisitor(ast.NodeVisitor):
    def __init__(self, tree: ast.Module) -> None:
        static_scope = _build_import_scope(tree.body)
        self.scopes = [_ImportScope(bound_names=static_scope.bound_names)]
        self.calls: list[ResolvedImportCall] = []
        self.comprehension_binding_scopes: list[_ImportScope] = []

    def _clear_binding(
        self, name: str, scope: _ImportScope | None = None
    ) -> None:
        scope = scope or self.scopes[-1]
        scope.direct.pop(name, None)
        scope.modules = {
            expression: value
            for expression, value in scope.modules.items()
            if value[0] != name
        }

    def visit_Import(self, node: ast.Import) -> None:
        scope = self.scopes[-1]
        for alias in node.names:
            expression = alias.asname or alias.name
            bound_name = alias.asname or alias.name.split(".")[0]
            self._clear_binding(bound_name)
            scope.modules[expression] = (bound_name, alias.name)

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        dotted_module = f"{'.' * node.level}{node.module or ''}"
        scope = self.scopes[-1]
        for alias in node.names:
            local = alias.asname or alias.name
            imported_submodule = (
                f"{dotted_module}{alias.name}"
                if dotted_module.endswith(".")
                else f"{dotted_module}.{alias.name}"
            )
            self._clear_binding(local)
            scope.direct[local] = (alias.name, dotted_module)
            scope.modules[local] = (local, imported_submodule)

    def _clear_assignment_target(
        self, target: ast.AST, scope: _ImportScope | None = None
    ) -> None:
        if isinstance(target, ast.Name):
            self._clear_binding(target.id, scope)
        elif isinstance(target, (ast.Tuple, ast.List)):
            for element in target.elts:
                self._clear_assignment_target(element, scope)

    def visit_Assign(self, node: ast.Assign) -> None:
        self.visit(node.value)
        for target in node.targets:
            self._clear_assignment_target(target)
            self.visit(target)

    def visit_AnnAssign(self, node: ast.AnnAssign) -> None:
        if node.value is not None:
            self.visit(node.value)
        self._clear_assignment_target(node.target)
        self.visit(node.target)

    def visit_AugAssign(self, node: ast.AugAssign) -> None:
        self.visit(node.target)
        self.visit(node.value)
        self._clear_assignment_target(node.target)

    def visit_NamedExpr(self, node: ast.NamedExpr) -> None:
        self.visit(node.value)
        binding_scope = (
            self.comprehension_binding_scopes[-1]
            if self.comprehension_binding_scopes
            else None
        )
        self._clear_assignment_target(node.target, binding_scope)

    def _resolve_direct(self, name: str) -> tuple[str, str] | None:
        for scope in reversed(self.scopes):
            if name in scope.direct:
                return scope.direct[name]
            if name in scope.bound_names:
                return None
        return None

    def _resolve_module(self, receiver: str) -> str | None:
        root_name = receiver.split(".", 1)[0]
        for scope in reversed(self.scopes):
            if receiver in scope.modules:
                return scope.modules[receiver][1]
            if root_name in scope.bound_names:
                return None
        return None

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        for decorator in node.decorator_list:
            self.visit(decorator)
        for default in [*node.args.defaults, *node.args.kw_defaults]:
            if default is not None:
                self.visit(default)
        self._clear_binding(node.name)
        params = {
            argument.arg
            for argument in [
                *node.args.posonlyargs,
                *node.args.args,
                *node.args.kwonlyargs,
            ]
        }
        if node.args.vararg:
            params.add(node.args.vararg.arg)
        if node.args.kwarg:
            params.add(node.args.kwarg.arg)
        static_scope = _build_import_scope(node.body, params)
        self.scopes.append(_ImportScope(bound_names=static_scope.bound_names))
        for statement in node.body:
            self.visit(statement)
        self.scopes.pop()

    visit_AsyncFunctionDef = visit_FunctionDef  # type: ignore[assignment]

    def visit_Lambda(self, node: ast.Lambda) -> None:
        params = {
            argument.arg
            for argument in [
                *node.args.posonlyargs,
                *node.args.args,
                *node.args.kwonlyargs,
            ]
        }
        if node.args.vararg:
            params.add(node.args.vararg.arg)
        if node.args.kwarg:
            params.add(node.args.kwarg.arg)
        collector = _ImportBindingCollector(params)
        collector.visit(node.body)
        self.scopes.append(_ImportScope(bound_names=collector.scope.bound_names))
        self.visit(node.body)
        self.scopes.pop()

    def _visit_comprehension(
        self,
        generators: list[ast.comprehension],
        result_nodes: list[ast.AST],
    ) -> None:
        scope = _ImportScope()
        self.comprehension_binding_scopes.append(
            self.comprehension_binding_scopes[-1]
            if self.comprehension_binding_scopes
            else self.scopes[-1]
        )
        self.scopes.append(scope)
        try:
            for generator in generators:
                self.visit(generator.iter)
                scope.bound_names.update(
                    child.id
                    for child in ast.walk(generator.target)
                    if isinstance(child, ast.Name)
                )
                for condition in generator.ifs:
                    self.visit(condition)
            for result in result_nodes:
                self.visit(result)
        finally:
            self.scopes.pop()
            self.comprehension_binding_scopes.pop()

    def visit_ListComp(self, node: ast.ListComp) -> None:
        self._visit_comprehension(node.generators, [node.elt])

    visit_SetComp = visit_ListComp  # type: ignore[assignment]
    visit_GeneratorExp = visit_ListComp  # type: ignore[assignment]

    def visit_DictComp(self, node: ast.DictComp) -> None:
        self._visit_comprehension(node.generators, [node.key, node.value])

    def visit_Call(self, node: ast.Call) -> None:
        resolved = None
        if isinstance(node.func, ast.Name):
            resolved = self._resolve_direct(node.func.id)
        elif isinstance(node.func, ast.Attribute):
            receiver = _dotted_name(node.func.value)
            module = self._resolve_module(receiver or "")
            if module:
                resolved = (node.func.attr, module)
        if resolved:
            self.calls.append(ResolvedImportCall(node.lineno, *resolved))
        self.generic_visit(node)


def resolve_import_calls(tree: ast.Module) -> list[ResolvedImportCall]:
    visitor = _ImportCallVisitor(tree)
    visitor.visit(tree)
    return visitor.calls


def imported_calls_in_scope(scope_node: ast.Module) -> set[tuple[str, str]]:
    """Return (called symbol, source module) for resolved literal calls."""
    return {
        (call.symbol, call.dotted_module) for call in resolve_import_calls(scope_node)
    }


def top_level_defs(src: Path, include_private: bool) -> list[tuple[str, int]]:
    tree = ast.parse(src.read_text(), filename=str(src))
    out = []
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            if not include_private and node.name.startswith("_"):
                continue
            out.append((node.name, node.lineno))
    return out


@dataclass
class TestUnit:
    """A single test function, or a test method inside a TestCase class."""

    qualname: str  # "test_foo" or "SomeTestCase.test_foo"
    lineno: int
    node: ast.AST = field(repr=False)


def test_units(tree: ast.Module) -> list[TestUnit]:
    units: list[TestUnit] = []
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name.startswith(
            "test"
        ):
            units.append(TestUnit(qualname=node.name, lineno=node.lineno, node=node))
        elif isinstance(node, ast.ClassDef):
            for sub in node.body:
                if isinstance(sub, (ast.FunctionDef, ast.AsyncFunctionDef)) and sub.name.startswith(
                    "test"
                ):
                    units.append(
                        TestUnit(
                            qualname=f"{node.name}.{sub.name}", lineno=sub.lineno, node=sub
                        )
                    )
    return units
