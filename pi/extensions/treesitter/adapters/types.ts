import type {
  TreesitterContextOutput,
  TreesitterFindMode,
  TreesitterFindOutput,
  TreesitterOutlineOutput,
} from "../contracts";

export type TreesitterParsedFile = {
  path: string;
  source: string;
  languageId: string;
  tree: unknown;
};

export type TreesitterLanguageAdapter<
  FindMode extends string = TreesitterFindMode,
> = {
  languageId: string;
  fileExtensions: string[];
  supportedFindModes: readonly FindMode[];

  // Implementations are added in later tasks once parser loading lands.
  // The generic core owns parser lifecycle and passes parsed file data here.
  outline?: (parsed: TreesitterParsedFile) => TreesitterOutlineOutput;
  context?: (
    parsed: TreesitterParsedFile,
    line: number,
    column: number,
  ) => TreesitterContextOutput;
  find?: (parsed: TreesitterParsedFile, mode: FindMode) => TreesitterFindOutput;
};
