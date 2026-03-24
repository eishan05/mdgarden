import type { TreeNode } from "./types";

interface FileTreeProps {
  rootName: string;
  rootLabel: string;
  tree: TreeNode[];
  activePath: string | null;
  onOpen: (path: string) => void;
}

export function FileTree(props: FileTreeProps) {
  return (
    <div className="sidebar-panel">
      <div className="sidebar-header">
        <p className="eyebrow">Workspace</p>
        <h1>{props.rootName}</h1>
        <p className="sidebar-path">{props.rootLabel}</p>
      </div>

      <div className="tree-list" role="tree">
        {props.tree.length === 0 ? (
          <div className="sidebar-empty">
            <p>No markdown files found in this folder.</p>
          </div>
        ) : (
          props.tree.map((node) => (
            <TreeEntry
              key={node.path}
              node={node}
              depth={0}
              activePath={props.activePath}
              onOpen={props.onOpen}
            />
          ))
        )}
      </div>
    </div>
  );
}

interface TreeEntryProps {
  node: TreeNode;
  depth: number;
  activePath: string | null;
  onOpen: (path: string) => void;
}

function TreeEntry(props: TreeEntryProps) {
  if (props.node.type === "directory") {
    return (
      <details className="tree-directory">
        <summary style={{ paddingLeft: `${props.depth * 0.8 + 0.4}rem` }}>
          <span>{props.node.name}</span>
        </summary>

        <div className="tree-children">
          {props.node.children.map((childNode) => (
            <TreeEntry
              key={childNode.path}
              node={childNode}
              depth={props.depth + 1}
              activePath={props.activePath}
              onOpen={props.onOpen}
            />
          ))}
        </div>
      </details>
    );
  }

  const isActive = props.activePath === props.node.path;

  return (
    <div className={`tree-file ${isActive ? "is-active" : ""}`}>
      <button
        type="button"
        className="tree-file-button"
        aria-label={`Open ${props.node.path}`}
        style={{ paddingLeft: `${props.depth * 0.8 + 1.2}rem` }}
        onClick={() => props.onOpen(props.node.path)}
      >
        <span>{props.node.name}</span>
      </button>
    </div>
  );
}
