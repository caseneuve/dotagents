#!/usr/bin/env python3
"""Extract signatures and a first-pass purity classification for given
Python functions, to support the dataflow skill's steps 2 and 3a.

This is a heuristic, not a type checker or a proof of purity. Always prefer
mypy/pyright output for real types, and confirm borderline purity calls by
reading the function body yourself.
"""

from __future__ import annotations

import argparse
import ast
import builtins
import sys
from dataclasses import dataclass, field
from pathlib import Path

IO_CALL_NAMES = {
    "execute",
    "executemany",
    "fetchone",
    "fetchall",
    "fetchmany",
    "open",
    "write",
    "writelines",
    "read",
    "send",
    "sendall",
    "recv",
    "post",
    "put",
    "patch",
    "delete",
    "save",
    "create",
    "update",
    "connect",
    "close",
}
AMBIENT_STATE_CALLS = {
    ("time", "time"),
    ("datetime", "now"),
    ("datetime", "utcnow"),
    ("random", "random"),
    ("random", "choice"),
    ("random", "randint"),
    ("uuid", "uuid4"),
}


@dataclass
class FunctionInfo:
    name: str
    path: Path
    lineno: int
    params: list[str] = field(default_factory=list)
    return_type: str | None = None
    decorators: list[str] = field(default_factory=list)
    has_io_call: bool = False
    io_evidence: list[str] = field(default_factory=list)
    has_with_block: bool = False
    has_external_attr_assign: bool = False
    attr_assign_evidence: list[str] = field(default_factory=list)
    has_global_nonlocal: bool = False
    has_global_read: bool = False
    global_read_evidence: list[str] = field(default_factory=list)
    has_ambient_state_call: bool = False
    ambient_evidence: list[str] = field(default_factory=list)
    has_pure_expression: bool = False
    unresolved_calls: list[str] = field(default_factory=list)


def _unparse(node: ast.AST | None) -> str | None:
    if node is None:
        return None
    try:
        return ast.unparse(node)
    except Exception:
        return "?"


def _format_arg(argument: ast.arg, prefix: str = "") -> str:
    piece = f"{prefix}{argument.arg}"
    annotation = _unparse(argument.annotation)
    if annotation:
        piece += f": {annotation}"
    return piece


def _format_params(node: ast.FunctionDef | ast.AsyncFunctionDef) -> list[str]:
    params: list[str] = []
    args = node.args
    positional = [*args.posonlyargs, *args.args]
    defaults_offset = len(positional) - len(args.defaults)
    for index, argument in enumerate(positional):
        piece = _format_arg(argument)
        if index >= defaults_offset:
            piece += f" = {_unparse(args.defaults[index - defaults_offset])}"
        params.append(piece)
        if args.posonlyargs and index + 1 == len(args.posonlyargs):
            params.append("/")

    if args.vararg:
        params.append(_format_arg(args.vararg, "*"))
    elif args.kwonlyargs:
        params.append("*")

    for argument, default in zip(args.kwonlyargs, args.kw_defaults):
        piece = _format_arg(argument)
        if default is not None:
            piece += f" = {_unparse(default)}"
        params.append(piece)

    if args.kwarg:
        params.append(_format_arg(args.kwarg, "**"))
    return params


class _LexicalBindingCollector(ast.NodeVisitor):
    def __init__(self, params: set[str]) -> None:
        self.names = set(params)
        self.external_names: set[str] = set()

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        self.names.add(node.name)

    visit_AsyncFunctionDef = visit_FunctionDef  # type: ignore[assignment]

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        self.names.add(node.name)

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
            self.names.add(alias.asname or alias.name.split(".")[0])

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        for alias in node.names:
            self.names.add(alias.asname or alias.name)

    def visit_Global(self, node: ast.Global) -> None:
        self.external_names.update(node.names)

    def visit_Nonlocal(self, node: ast.Nonlocal) -> None:
        self.external_names.update(node.names)

    def visit_Name(self, node: ast.Name) -> None:
        if isinstance(node.ctx, ast.Store):
            self.names.add(node.id)


class _BodyVisitor(ast.NodeVisitor):
    def __init__(self, lexical_local_names: set[str]) -> None:
        self.local_names: set[str] = set()
        self.lexical_local_names = lexical_local_names
        self.io_evidence: list[str] = []
        self.attr_assign_evidence: list[str] = []
        self.ambient_evidence: list[str] = []
        self.has_with_block = False
        self.has_global_nonlocal = False
        self.global_read_evidence: list[str] = []
        self.has_pure_expression = False
        self.unresolved_calls: list[str] = []

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        # Defaults and decorators execute when the nested function is defined;
        # its body does not.
        for decorator in node.decorator_list:
            self.visit(decorator)
        for default in [*node.args.defaults, *node.args.kw_defaults]:
            if default is not None:
                self.visit(default)

    visit_AsyncFunctionDef = visit_FunctionDef  # type: ignore[assignment]

    def visit_Lambda(self, node: ast.Lambda) -> None:
        # Lambda defaults execute when the lambda is created; its body does not.
        for default in [*node.args.defaults, *node.args.kw_defaults]:
            if default is not None:
                self.visit(default)

    def _visit_comprehension(
        self,
        generators: list[ast.comprehension],
        result_nodes: list[ast.AST],
    ) -> None:
        outer_locals = set(self.lexical_local_names)
        try:
            for generator in generators:
                self.visit(generator.iter)
                self.lexical_local_names.update(
                    child.id
                    for child in ast.walk(generator.target)
                    if isinstance(child, ast.Name)
                )
                for condition in generator.ifs:
                    self.visit(condition)
            for result in result_nodes:
                self.visit(result)
        finally:
            self.lexical_local_names = outer_locals

    def visit_ListComp(self, node: ast.ListComp) -> None:
        self._visit_comprehension(node.generators, [node.elt])

    visit_SetComp = visit_ListComp  # type: ignore[assignment]
    visit_GeneratorExp = visit_ListComp  # type: ignore[assignment]

    def visit_DictComp(self, node: ast.DictComp) -> None:
        self._visit_comprehension(node.generators, [node.key, node.value])

    def visit_If(self, node: ast.If) -> None:
        self.visit(node.test)
        before = set(self.local_names)

        self.local_names = set(before)
        for statement in node.body:
            self.visit(statement)
        body_owned = set(self.local_names)

        self.local_names = set(before)
        for statement in node.orelse:
            self.visit(statement)
        else_owned = set(self.local_names)

        # A binding is definitely local after the conditional only when every
        # possible branch leaves it locally owned.
        self.local_names = body_owned & else_owned

    def visit_For(self, node: ast.For) -> None:
        self.visit(node.iter)
        before = set(self.local_names)

        self.local_names = set(before)
        self._update_name_ownership(node.target, False)
        for statement in node.body:
            self.visit(statement)

        self.local_names = set(before)
        for statement in node.orelse:
            self.visit(statement)

        # The loop may execute zero times, so branch-local ownership cannot
        # become definite afterward.
        self.local_names = before

    visit_AsyncFor = visit_For  # type: ignore[assignment]

    def visit_While(self, node: ast.While) -> None:
        self.visit(node.test)
        before = set(self.local_names)
        self.local_names = set(before)
        for statement in node.body:
            self.visit(statement)
        self.local_names = set(before)
        for statement in node.orelse:
            self.visit(statement)
        self.local_names = before

    def visit_Try(self, node: ast.Try) -> None:
        before = set(self.local_names)
        self.local_names = set(before)
        for statement in node.body:
            self.visit(statement)
        self.local_names = set(before)
        for statement in node.orelse:
            self.visit(statement)
        for handler in node.handlers:
            self.local_names = set(before)
            if handler.type:
                self.visit(handler.type)
            if handler.name:
                self.local_names.discard(handler.name)
            for statement in handler.body:
                self.visit(statement)
        self.local_names = set(before)
        for statement in node.finalbody:
            self.visit(statement)
        self.local_names = before

    visit_TryStar = visit_Try  # type: ignore[assignment]

    def visit_Match(self, node: ast.Match) -> None:
        self.visit(node.subject)
        before = set(self.local_names)
        for case in node.cases:
            self.local_names = set(before)
            if case.guard:
                self.visit(case.guard)
            for statement in case.body:
                self.visit(statement)
        self.local_names = before

    def visit_With(self, node: ast.With) -> None:
        self.has_with_block = True
        self.generic_visit(node)

    visit_AsyncWith = visit_With  # type: ignore[assignment]

    def visit_Global(self, node: ast.Global) -> None:
        self.has_global_nonlocal = True
        self.generic_visit(node)

    def visit_Nonlocal(self, node: ast.Nonlocal) -> None:
        self.has_global_nonlocal = True
        self.generic_visit(node)

    def visit_Name(self, node: ast.Name) -> None:
        if (
            isinstance(node.ctx, ast.Load)
            and node.id not in self.lexical_local_names
            and node.id not in vars(builtins)
        ):
            self.global_read_evidence.append(
                f"{node.id} (line {node.lineno})"
            )

    def _mutation_owner(self, target: ast.AST) -> str | None:
        current = target
        while isinstance(current, (ast.Attribute, ast.Subscript)):
            current = current.value
        return current.id if isinstance(current, ast.Name) else None

    def _record_external_mutation(self, target: ast.AST, lineno: int) -> None:
        if isinstance(target, (ast.Tuple, ast.List)):
            for element in target.elts:
                self._record_external_mutation(element, lineno)
            return
        if not isinstance(target, (ast.Attribute, ast.Subscript)):
            return
        owner = self._mutation_owner(target)
        if owner is not None and (owner == "self" or owner not in self.local_names):
            self.attr_assign_evidence.append(
                f"{ast.unparse(target)} (line {lineno})"
            )

    def _is_local_creation(self, value: ast.AST | None) -> bool:
        return isinstance(
            value,
            (
                ast.List,
                ast.Dict,
                ast.Set,
                ast.ListComp,
                ast.DictComp,
                ast.SetComp,
                ast.GeneratorExp,
            ),
        )

    def _update_name_ownership(self, target: ast.AST, owned: bool) -> None:
        if isinstance(target, ast.Name):
            if owned:
                self.local_names.add(target.id)
            else:
                self.local_names.discard(target.id)
        elif isinstance(target, (ast.Tuple, ast.List)):
            for element in target.elts:
                self._update_name_ownership(element, False)

    def visit_Assign(self, node: ast.Assign) -> None:
        self.visit(node.value)
        owned = self._is_local_creation(node.value)
        for target in node.targets:
            self._record_external_mutation(target, node.lineno)
            self._update_name_ownership(target, owned)
            self.visit(target)

    def visit_AnnAssign(self, node: ast.AnnAssign) -> None:
        if node.value is not None:
            self.visit(node.value)
        self._record_external_mutation(node.target, node.lineno)
        self._update_name_ownership(
            node.target, self._is_local_creation(node.value)
        )
        self.visit(node.target)

    def visit_AugAssign(self, node: ast.AugAssign) -> None:
        self._record_external_mutation(node.target, node.lineno)
        self.generic_visit(node)

    def visit_Delete(self, node: ast.Delete) -> None:
        for target in node.targets:
            self._record_external_mutation(target, node.lineno)
            self._update_name_ownership(target, False)
            self.visit(target)

    def visit_NamedExpr(self, node: ast.NamedExpr) -> None:
        self.visit(node.value)
        self._update_name_ownership(
            node.target, self._is_local_creation(node.value)
        )

    def visit_Call(self, node: ast.Call) -> None:
        func = node.func
        if isinstance(func, ast.Attribute):
            attr = func.attr
            base = func.value
            base_name = base.id if isinstance(base, ast.Name) else _unparse(base)
            if (base_name, attr) in AMBIENT_STATE_CALLS or attr in {
                "now",
                "utcnow",
            } and base_name in {"time", "datetime"}:
                self.ambient_evidence.append(f"{base_name}.{attr}() (line {node.lineno})")
            elif attr in IO_CALL_NAMES:
                self.io_evidence.append(f"{base_name}.{attr}() (line {node.lineno})")
            else:
                self.unresolved_calls.append(f"{base_name}.{attr}() (line {node.lineno})")
        elif isinstance(func, ast.Name):
            if func.id in {"open"}:
                self.io_evidence.append(f"{func.id}() (line {node.lineno})")
            else:
                self.unresolved_calls.append(f"{func.id}() (line {node.lineno})")
        for argument in node.args:
            self.visit(argument)
        for keyword in node.keywords:
            self.visit(keyword.value)

    def visit_Return(self, node: ast.Return) -> None:
        if node.value is not None and not isinstance(node.value, ast.Constant):
            self.has_pure_expression = True
        self.generic_visit(node)


def analyze_function(
    node: ast.FunctionDef | ast.AsyncFunctionDef, path: Path
) -> FunctionInfo:
    # Parameters and aliases remain caller-owned. The visitor only marks
    # bindings from definite local container creation as locally owned.
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
    lexical_collector = _LexicalBindingCollector(params)
    for statement in node.body:
        lexical_collector.visit(statement)
    lexical_locals = lexical_collector.names - lexical_collector.external_names

    visitor = _BodyVisitor(lexical_locals)
    for stmt in node.body:
        visitor.visit(stmt)

    info = FunctionInfo(
        name=node.name,
        path=path,
        lineno=node.lineno,
        params=_format_params(node),
        return_type=_unparse(node.returns),
        decorators=[_unparse(d) or "?" for d in node.decorator_list],
        has_io_call=bool(visitor.io_evidence),
        io_evidence=visitor.io_evidence,
        has_with_block=visitor.has_with_block,
        has_external_attr_assign=bool(visitor.attr_assign_evidence),
        attr_assign_evidence=visitor.attr_assign_evidence,
        has_global_nonlocal=visitor.has_global_nonlocal,
        has_global_read=bool(visitor.global_read_evidence),
        global_read_evidence=visitor.global_read_evidence,
        has_ambient_state_call=bool(visitor.ambient_evidence),
        ambient_evidence=visitor.ambient_evidence,
        has_pure_expression=visitor.has_pure_expression,
        unresolved_calls=visitor.unresolved_calls,
    )
    return info


def classify_purity(info: FunctionInfo) -> str:
    side_effect_markers = (
        info.has_io_call
        or info.has_with_block
        or info.has_external_attr_assign
        or info.has_global_nonlocal
        or info.has_global_read
        or info.has_ambient_state_call
    )
    if side_effect_markers:
        return "mixed" if info.has_pure_expression else "side-effecting"
    if info.unresolved_calls:
        return "unknown \u2014 has unresolved call(s), purity not provable from this body alone"
    return "pure"


def find_functions(root: Path, targets: set[str]) -> list[FunctionInfo]:
    results = []
    for path in root.rglob("*.py"):
        if any(part.startswith(".") for part in path.relative_to(root).parts):
            continue
        try:
            tree = ast.parse(path.read_text(), filename=str(path))
        except (SyntaxError, UnicodeDecodeError):
            continue
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in targets:
                results.append(analyze_function(node, path))
    return results


def report(root: Path, targets: list[str], infos: list[FunctionInfo]) -> None:
    by_name: dict[str, list[FunctionInfo]] = {}
    for info in infos:
        by_name.setdefault(info.name, []).append(info)

    for target in targets:
        matches = by_name.get(target, [])
        if not matches:
            print(f"{target}\n  not found under --root\n")
            continue
        for info in matches:
            rel = info.path.relative_to(root)
            sig = ", ".join(info.params)
            ret = f" -> {info.return_type}" if info.return_type else " -> (unannotated)"
            deco = f"  decorators: {', '.join(info.decorators)}" if info.decorators else ""
            print(f"{info.name}({sig}){ret}")
            print(f"  defined in: {rel}:{info.lineno}")
            if deco:
                print(deco)
            purity = classify_purity(info)
            evidence_bits = []
            if info.io_evidence:
                evidence_bits.append(f"I/O: {', '.join(info.io_evidence)}")
            if info.has_with_block:
                evidence_bits.append("with-block (resource context manager)")
            if info.attr_assign_evidence:
                evidence_bits.append(f"external mutation: {', '.join(info.attr_assign_evidence)}")
            if info.has_global_nonlocal:
                evidence_bits.append("global/nonlocal")
            if info.global_read_evidence:
                evidence_bits.append(
                    f"global read: {', '.join(info.global_read_evidence)}"
                )
            if info.ambient_evidence:
                evidence_bits.append(f"ambient state: {', '.join(info.ambient_evidence)}")
            evidence = f" ({'; '.join(evidence_bits)})" if evidence_bits else ""
            print(f"  purity: {purity}{evidence}")
            if not info.return_type:
                print("  flags: ⚠ untyped — no return annotation")
            elif info.return_type in {"Any", "dict", "list", "tuple"}:
                print(f"  flags: ⚠ Any-shaped return type ({info.return_type})")
            if info.unresolved_calls:
                print(
                    "  unknown calls (purity not inferred, read manually or pass as its own"
                    f" SYMBOL): {', '.join(info.unresolved_calls[:5])}"
                    + (" ..." if len(info.unresolved_calls) > 5 else "")
                )
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
    infos = find_functions(root, targets)
    report(root, args.symbols, infos)

    print(
        "NOTE: purity classification is a heuristic (I/O-name matching, with-blocks,\n"
        "external attr assignment, global/nonlocal, ambient-state calls). It does not\n"
        "resolve transitive purity of unresolved calls, decorators, or indirection.\n"
        "Confirm borderline cases by reading the body. Prefer mypy/pyright for real types.",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
