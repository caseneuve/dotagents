export type OutlineNode = {
  id: string;
  title: string;
  level: number;
  startLine: number;
  endLine: number;
  children: OutlineNode[];
};

export type OutlineRow = {
  node: OutlineNode;
  depth: number;
};

export type ParsedAssistantOutline = {
  messageEntryId: string;
  text: string;
  lines: string[];
  root: OutlineNode;
  nodesById: Map<string, OutlineNode>;
};

export type AssistantResponseSelection = {
  messageEntryId: string;
  text: string;
  timestamp?: number;
};

export type SectionComments = Record<string, string>;

export type AssistantOutlineCommentState = {
  messageEntryId: string;
  comments: SectionComments;
};

export type ExportedSectionsPayload = {
  count: number;
  text: string;
};
