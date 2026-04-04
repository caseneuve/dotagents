import { PYTHON_FIND_MODES, type PythonFindMode } from "../contracts";
import type { TreesitterLanguageAdapter } from "./types";

export const pythonAdapter: TreesitterLanguageAdapter<PythonFindMode> = {
  languageId: "python",
  fileExtensions: [".py"],
  supportedFindModes: [...PYTHON_FIND_MODES],
};
