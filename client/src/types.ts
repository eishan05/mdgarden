export interface TreeDirectoryNode {
  type: "directory";
  name: string;
  path: string;
  children: TreeNode[];
}

export interface TreeFileNode {
  type: "file";
  name: string;
  path: string;
}

export type TreeNode = TreeDirectoryNode | TreeFileNode;

export interface TreePayload {
  rootName: string;
  rootLabel: string;
  tree: TreeNode[];
}

export interface DocumentPayload {
  path: string;
  name: string;
  content: string;
  updatedAt: string;
}

export interface PaneState {
  id: string;
  path: string | null;
  width: number;
}
