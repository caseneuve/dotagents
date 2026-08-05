#!/usr/bin/env python3
"""Find real callers/definitions of given symbols across a Python repo.

Resolves imports (including aliases) so renamed or re-exported symbols are
matched correctly, and distinguishes a bare import from an actual call site.
This is a support tool for the callgraph skill's step 2 (build the real call
graph) — it does not replace step 4 (forward-tracing concrete scenarios).
"""

from __future__ import annotations

import argparse
import ast
import sys
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class FileFacts:
    path: Path
    # local_name -> original symbol name, for names imported into this file
    imported_as: dict[str, str] = field(default_factory=dict)
    # symbol -> list of (lineno, enclosing_function_name)
    calls: dict[str, list[tuple[int, str]]] = field(default_factory=dict)
    # symbol -> list of line numbers where only imported, never called
    import_only_lines: dict[str, list[int]] = field(default_factory=dict)
    # name -> lineno, for symbols defined in this file
    defined_at: dict[str, int] = field(default_factory=dict)


def _dotted_name(node: ast.AST) -> str | None:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        parent = _dotted_name(node.value)
        return f"{parent}.{node.attr}" if parent else None
    return None


def _enclosing_function_name(node_stack: list[ast.AST]) -> str:
    for n in reversed(node_stack):
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
            return n.name
    return "<module>"


@dataclass
class _Scope:
    bound_names: set[str] = field(default_factory=set)
    direct_imports: dict[str, str] = field(default_factory=dict)
    module_imports: dict[str, tuple[str, str]] = field(default_factory=dict)
    local_targets: set[str] = field(default_factory=set)


class _BindingCollector(ast.NodeVisitor):
    def __init__(self, targets: set[str], params: set[str] | None = None) -> None:
        self.targets = targets
        self.scope = _Scope(bound_names=set(params or ()))
        self.non_import_bindings = set(params or ())

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        self.scope.bound_names.add(node.name)
        self.non_import_bindings.add(node.name)
        if node.name in self.targets:
            self.scope.local_targets.add(node.name)

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
            self.scope.module_imports[expression] = (bound_name, alias.name)

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        for alias in node.names:
            local = alias.asname or alias.name
            self.scope.bound_names.add(local)
            if alias.name in self.targets:
                self.scope.direct_imports[local] = alias.name

    def visit_Name(self, node: ast.Name) -> None:
        if isinstance(node.ctx, ast.Store):
            self.scope.bound_names.add(node.id)
            self.non_import_bindings.add(node.id)


def _build_scope(
    body: list[ast.stmt], targets: set[str], params: set[str] | None = None
) -> _Scope:
    collector = _BindingCollector(targets, params)
    for statement in body:
        collector.visit(statement)

    for name in collector.non_import_bindings:
        collector.scope.direct_imports.pop(name, None)
        collector.scope.module_imports = {
            expression: binding
            for expression, binding in collector.scope.module_imports.items()
            if binding[0] != name
        }
    return collector.scope


class _Visitor(ast.NodeVisitor):
    def __init__(
        self,
        targets: set[str],
        tree: ast.Module,
        allowed_import_modules: dict[str, set[str]] | None = None,
        current_package: str = "",
    ) -> None:
        self.targets = targets
        self.allowed_import_modules = allowed_import_modules
        self.current_package = current_package
        static_scope = _build_scope(tree.body, targets)
        module_scope = _Scope(
            bound_names=static_scope.bound_names,
            local_targets=static_scope.local_targets,
        )
        self.imported_as: dict[str, str] = {}
        self.import_lines: dict[str, list[int]] = {}
        self.calls: dict[str, list[tuple[int, str]]] = {}
        self.defined_at: dict[str, int] = {}
        self._stack: list[ast.AST] = []
        self._scopes = [module_scope]
        self._comprehension_binding_scopes: list[_Scope] = []

    def _clear_binding(self, name: str, scope: _Scope | None = None) -> None:
        scope = scope or self._scopes[-1]
        scope.direct_imports.pop(name, None)
        scope.local_targets.discard(name)
        scope.module_imports = {
            expression: binding
            for expression, binding in scope.module_imports.items()
            if binding[0] != name
        }

    def visit_Import(self, node: ast.Import) -> None:
        scope = self._scopes[-1]
        for alias in node.names:
            expression = alias.asname or alias.name
            bound_name = alias.asname or alias.name.split(".")[0]
            self._clear_binding(bound_name)
            scope.module_imports[expression] = (bound_name, alias.name)

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        scope = self._scopes[-1]
        module = node.module or ""
        if node.level:
            package_parts = self.current_package.split(".") if self.current_package else []
            keep = max(0, len(package_parts) - (node.level - 1))
            module = ".".join([*package_parts[:keep], *module.split(".")])
            module = module.strip(".")
        for alias in node.names:
            local = alias.asname or alias.name
            self._clear_binding(local)
            imported_submodule = f"{module}.{alias.name}".strip(".")
            scope.module_imports[local] = (local, imported_submodule)
            allowed_modules = (
                self.allowed_import_modules.get(alias.name, set())
                if self.allowed_import_modules is not None
                else set()
            )
            module_matches = (
                not allowed_modules
                or module in allowed_modules
            )
            if alias.name in self.targets and module_matches:
                scope.direct_imports[local] = alias.name
                self.imported_as[local] = alias.name
                self.import_lines.setdefault(alias.name, []).append(node.lineno)

    def _clear_assignment_target(
        self, target: ast.AST, scope: _Scope | None = None
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
            self._comprehension_binding_scopes[-1]
            if self._comprehension_binding_scopes
            else None
        )
        self._clear_assignment_target(node.target, binding_scope)

    def _resolve_name(self, name: str) -> str | None:
        for scope in reversed(self._scopes):
            if name in scope.direct_imports:
                return scope.direct_imports[name]
            if name in scope.local_targets:
                return name
            if name in scope.bound_names:
                return None
        return None

    def _resolve_imported_module(self, receiver: str) -> str | None:
        root_name = receiver.split(".", 1)[0]
        for scope in reversed(self._scopes):
            if receiver in scope.module_imports:
                return scope.module_imports[receiver][1]
            if root_name in scope.bound_names:
                return None
        return None

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        if node.name in self.targets:
            self.defined_at[node.name] = node.lineno

        for decorator in node.decorator_list:
            self.visit(decorator)
        for default in [*node.args.defaults, *node.args.kw_defaults]:
            if default is not None:
                self.visit(default)

        self._clear_binding(node.name)
        if node.name in self.targets:
            self._scopes[-1].local_targets.add(node.name)

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

        static_scope = _build_scope(node.body, self.targets, params)
        scope = _Scope(
            bound_names=static_scope.bound_names,
            local_targets=static_scope.local_targets,
        )
        self._stack.append(node)
        self._scopes.append(scope)
        for statement in node.body:
            self.visit(statement)
        self._scopes.pop()
        self._stack.pop()

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
        collector = _BindingCollector(self.targets, params)
        collector.visit(node.body)
        self._scopes.append(collector.scope)
        self.visit(node.body)
        self._scopes.pop()

    def _visit_comprehension(
        self,
        generators: list[ast.comprehension],
        result_nodes: list[ast.AST],
    ) -> None:
        scope = _Scope()
        self._comprehension_binding_scopes.append(
            self._comprehension_binding_scopes[-1]
            if self._comprehension_binding_scopes
            else self._scopes[-1]
        )
        self._scopes.append(scope)
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
            self._scopes.pop()
            self._comprehension_binding_scopes.pop()

    def visit_ListComp(self, node: ast.ListComp) -> None:
        self._visit_comprehension(node.generators, [node.elt])

    visit_SetComp = visit_ListComp  # type: ignore[assignment]
    visit_GeneratorExp = visit_ListComp  # type: ignore[assignment]

    def visit_DictComp(self, node: ast.DictComp) -> None:
        self._visit_comprehension(node.generators, [node.key, node.value])

    def visit_Call(self, node: ast.Call) -> None:
        original = None
        if isinstance(node.func, ast.Name):
            original = self._resolve_name(node.func.id)
        elif isinstance(node.func, ast.Attribute) and node.func.attr in self.targets:
            receiver = _dotted_name(node.func.value)
            module = self._resolve_imported_module(receiver or "")
            allowed_modules = (
                self.allowed_import_modules.get(node.func.attr, set())
                if self.allowed_import_modules is not None
                else set()
            )
            if module and (not allowed_modules or module in allowed_modules):
                original = node.func.attr

        if original is not None:
            self.calls.setdefault(original, []).append(
                (node.lineno, _enclosing_function_name(self._stack))
            )
        self.generic_visit(node)


def analyze_file(
    path: Path,
    targets: set[str],
    allowed_import_modules: dict[str, set[str]] | None = None,
    current_package: str = "",
) -> FileFacts:
    try:
        tree = ast.parse(path.read_text(), filename=str(path))
    except (SyntaxError, UnicodeDecodeError):
        return FileFacts(path=path)
    visitor = _Visitor(
        targets, tree, allowed_import_modules, current_package
    )
    visitor.visit(tree)
    facts = FileFacts(
        path=path,
        imported_as=visitor.imported_as,
        calls=visitor.calls,
        defined_at=visitor.defined_at,
    )
    imported_originals = set(visitor.imported_as.values())
    called_originals = set(visitor.calls.keys())
    for original in imported_originals - called_originals:
        facts.import_only_lines[original] = visitor.import_lines.get(original, [])
    return facts


def _module_names(root: Path, path: Path) -> set[str]:
    relative = path.relative_to(root).with_suffix("")
    parts = list(relative.parts)
    if parts and parts[-1] == "__init__":
        parts.pop()
    names = {".".join(parts)} if parts else set()

    # Include the import name rooted at the nearest regular Python package.
    package_end = len(parts) if path.name == "__init__.py" else len(parts) - 1
    package_start = package_end
    while package_start > 0:
        package_dir = root.joinpath(*parts[:package_start])
        if not (package_dir / "__init__.py").is_file():
            break
        package_start -= 1
    if package_start < package_end:
        names.add(".".join(parts[package_start:]))

    # Conventional source roots are import-path containers, not package names.
    if len(parts) > 1 and parts[0] in {"src", "lib"}:
        names.add(".".join(parts[1:]))
    return names


def _package_name(root: Path, path: Path) -> str:
    relative = path.relative_to(root)
    parts = list(relative.parent.parts)
    if path.name == "__init__.py":
        parts = list(relative.parts[:-1])
    return ".".join(parts)


def scan_repo(root: Path, targets: set[str]) -> list[FileFacts]:
    paths = [
        path
        for path in root.rglob("*.py")
        if not any(part.startswith(".") for part in path.relative_to(root).parts)
    ]
    allowed_import_modules = {target: set() for target in targets}
    for path in paths:
        try:
            tree = ast.parse(path.read_text(), filename=str(path))
        except (SyntaxError, UnicodeDecodeError):
            continue
        defined_names = {
            node.name
            for node in ast.walk(tree)
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
            and node.name in targets
        }
        for name in defined_names:
            allowed_import_modules[name].update(_module_names(root, path))

    return [
        analyze_file(
            path,
            targets,
            allowed_import_modules,
            _package_name(root, path),
        )
        for path in paths
    ]


def report(root: Path, targets: list[str], all_facts: list[FileFacts]) -> None:
    for target in targets:
        print(f"{target}")
        defined_in = [f for f in all_facts if target in f.defined_at]
        for f in defined_in:
            rel = f.path.relative_to(root)
            print(f"  defined in: {rel}:{f.defined_at[target]}")
        if not defined_in:
            print("  defined in: (not found under --root; may be external)")

        call_sites = [(f, ln, fn) for f in all_facts for (ln, fn) in f.calls.get(target, [])]
        if call_sites:
            print("  called from:")
            for f, ln, fn in sorted(call_sites, key=lambda t: (str(t[0].path), t[1])):
                rel = f.path.relative_to(root)
                print(f"    {rel}:{ln}  in {fn}()")
        else:
            print("  called from: (no call sites found)")

        import_only = [
            (f, ln) for f in all_facts for ln in f.import_only_lines.get(target, [])
        ]
        if import_only:
            print("  imported (no call site found) in:")
            for f, ln in sorted(import_only, key=lambda t: (str(t[0].path), t[1])):
                rel = f.path.relative_to(root)
                print(f"    {rel}:{ln}")
        print()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True, type=Path)
    parser.add_argument("symbols", nargs="+")
    args = parser.parse_args()

    root = args.root.resolve()
    if not root.is_dir():
        print(f"--root {root} is not a directory", file=sys.stderr)
        sys.exit(1)

    targets = set(args.symbols)
    all_facts = scan_repo(root, targets)
    report(root, args.symbols, all_facts)

    print(
        "NOTE: this script resolves direct calls and imported-module attribute calls.\n"
        "It does not resolve runtime object methods or dynamic dispatch (getattr, decorators, DI).\n"
        "If a target is invoked indirectly, verify manually and note it in the report.",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
