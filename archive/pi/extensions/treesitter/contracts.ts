export const TREE_SITTER_EXTENSION_NAME = "treesitter";

export const TREE_SITTER_TOOL_NAMES = {
  outline: "treesitter_outline",
  context: "treesitter_context",
  find: "treesitter_find",
} as const;

export const PYTHON_FIND_MODES = [
  "imports",
  "classes",
  "functions",
  "async_functions",
  "decorated_functions",
  "tests",
] as const;

export type PythonFindMode = (typeof PYTHON_FIND_MODES)[number];
export type TreesitterFindMode = PythonFindMode;

export type TreesitterRange = {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
};

export type TreesitterNodeSummary = {
  kind: string;
  name?: string;
  range: TreesitterRange;
};

export type TreesitterOutlineInput = {
  path: string;
};

export type TreesitterOutlineOutput = {
  language: string;
  path: string;
  nodes: TreesitterNodeSummary[];
};

export type TreesitterContextInput = {
  path: string;
  line: number;
  column: number;
};

export type TreesitterContextOutput = {
  language: string;
  path: string;
  position: { line: number; column: number };
  // Ordered from inner-most scope to outer-most scope.
  enclosing: TreesitterNodeSummary[];
  nearestDeclaration?: TreesitterNodeSummary;
};

export type TreesitterFindInput = {
  path: string;
  mode: TreesitterFindMode;
};

export type TreesitterFindMatch = TreesitterNodeSummary & {
  preview?: string;
};

export type TreesitterFindOutput = {
  language: string;
  path: string;
  mode: TreesitterFindMode;
  matches: TreesitterFindMatch[];
};
