import { startTransition, useCallback, useDeferredValue, useEffect, useRef, useState } from "react";

import { FileTree } from "./FileTree";
import { MarkdownDocument } from "./MarkdownDocument";
import type { DocumentPayload, PaneState, TreePayload } from "./types";
import {
  clamp,
  createPane,
  getDocumentTitle,
  normalizePaneWidths,
  rebalancePanes
} from "./utils";

const STORAGE_KEY = "mdgarden:workspace:v1";

type DocumentState =
  | {
      status: "loading";
      data?: DocumentPayload;
    }
  | {
      status: "ready";
      data: DocumentPayload;
    }
  | {
      status: "error";
      error: string;
      data?: DocumentPayload;
    };

interface ServerEventPayload {
  type: "ready" | "add" | "change" | "remove";
  path?: string;
  isMarkdown?: boolean;
}

interface PersistedWorkspace {
  panes: PaneState[];
  activePaneId: string | null;
}

export function App() {
  const [{ panes: initialPanes, activePaneId: initialActivePaneId }] =
    useState<PersistedWorkspace>(() => loadWorkspace());
  const paneGroupReference = useRef<HTMLDivElement>(null);
  const [treePayload, setTreePayload] = useState<TreePayload | null>(null);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [panes, setPanes] = useState<PaneState[]>(initialPanes);
  const [activePaneId, setActivePaneId] = useState<string>(
    initialActivePaneId ?? initialPanes[0].id
  );
  const [documents, setDocuments] = useState<Record<string, DocumentState>>({});
  const [pendingHashes, setPendingHashes] = useState<Record<string, string>>({});
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    return (document.documentElement.getAttribute('data-theme') as 'light' | 'dark') || 'light';
  });
  const panesReference = useRef(panes);
  const documentsReference = useRef(documents);
  const deferredActivePaneId = useDeferredValue(activePaneId);
  const activePane = panes.find((pane) => pane.id === deferredActivePaneId) ?? panes[0];
  const openDocumentPaths = [...new Set(panes.map((pane) => pane.path).filter((panePath): panePath is string => Boolean(panePath)))];
  const openDocumentPathsKey = openDocumentPaths.join("\n");

  panesReference.current = panes;
  documentsReference.current = documents;

  useEffect(() => {
    saveWorkspace({
      panes,
      activePaneId
    });
  }, [activePaneId, panes]);

  const refreshTree = useCallback(async () => {
    try {
      const nextTree = await fetchJson<TreePayload>("/api/tree");
      setTreeError(null);
      startTransition(() => setTreePayload(nextTree));
    } catch (error) {
      setTreeError(getErrorMessage(error));
    }
  }, []);

  const loadDocument = useCallback(async (documentPath: string, force: boolean = false) => {
    const existingState = documentsReference.current[documentPath];

    if (!force && (existingState?.status === "ready" || existingState?.status === "loading")) {
      return;
    }

    setDocuments((previousDocuments) => ({
      ...previousDocuments,
      [documentPath]: {
        status: "loading",
        data: previousDocuments[documentPath]?.data
      }
    }));

    try {
      const nextDocument = await fetchJson<DocumentPayload>(
        `/api/doc?path=${encodeURIComponent(documentPath)}`
      );

      startTransition(() => {
        setDocuments((previousDocuments) => ({
          ...previousDocuments,
          [documentPath]: {
            status: "ready",
            data: nextDocument
          }
        }));
      });
    } catch (error) {
      setDocuments((previousDocuments) => ({
        ...previousDocuments,
        [documentPath]: {
          status: "error",
          error: getErrorMessage(error),
          data: previousDocuments[documentPath]?.data
        }
      }));
    }
  }, []);

  const handleServerEvent = useCallback(async (event: ServerEventPayload) => {
    if (event.type === "ready") {
      return;
    }

    if (!event.path) {
      return;
    }

    const openPaths = panesReference.current
      .map((pane) => pane.path)
      .filter((panePath): panePath is string => Boolean(panePath));

    if (event.type !== "change" || event.isMarkdown) {
      void refreshTree();
    }

    if (event.isMarkdown && openPaths.includes(event.path)) {
      void loadDocument(event.path, true);
    }
  }, [loadDocument, refreshTree]);

  useEffect(() => {
    void refreshTree();
  }, [refreshTree]);

  useEffect(() => {
    const seenDocumentPaths = new Set<string>();

    for (const pane of panesReference.current) {
      if (pane.path && !seenDocumentPaths.has(pane.path)) {
        seenDocumentPaths.add(pane.path);
        void loadDocument(pane.path);
      }
    }
  }, [loadDocument, openDocumentPathsKey]);

  useEffect(() => {
    const eventSource = new EventSource("/api/events");

    eventSource.onmessage = (event) => {
      const payload = JSON.parse(event.data) as ServerEventPayload;
      void handleServerEvent(payload);
    };

    eventSource.onerror = () => {};

    return () => {
      eventSource.close();
    };
  }, [handleServerEvent]);

  function openInPane(documentPath: string, paneId: string = activePane.id): void {
    setActivePaneId(paneId);
    setPanes((previousPanes) =>
      previousPanes.map((pane) =>
        pane.id === paneId
          ? {
              ...pane,
              path: documentPath
            }
          : pane
      )
    );
  }

  function openToSide(documentPath: string, sourcePaneId: string = activePane.id): void {
    const nextPane = createPane(documentPath);

    setPanes((previousPanes) => {
      const sourcePaneIndex = previousPanes.findIndex((pane) => pane.id === sourcePaneId);

      if (sourcePaneIndex === -1) {
        return normalizePaneWidths([...previousPanes, nextPane]);
      }

      const nextPanes = [...previousPanes];
      nextPanes.splice(sourcePaneIndex + 1, 0, nextPane);
      return rebalancePanes(nextPanes);
    });

    setActivePaneId(nextPane.id);
  }

  function closePane(paneId: string): void {
    setPanes((previousPanes) => {
      if (previousPanes.length === 1) {
        return [{ ...previousPanes[0], path: null, width: 1 }];
      }

      const remainingPanes = previousPanes.filter((pane) => pane.id !== paneId);
      const nextPanes = rebalancePanes(remainingPanes);

      if (activePaneId === paneId) {
        const fallbackPane = nextPanes[Math.max(0, previousPanes.findIndex((pane) => pane.id === paneId) - 1)];
        setActivePaneId(fallbackPane.id);
      }

      return nextPanes;
    });
  }

  function handleHashHandled(paneId: string): void {
    setPendingHashes((previousHashes) => {
      const nextHashes = { ...previousHashes };
      delete nextHashes[paneId];
      return nextHashes;
    });
  }

  function toggleTheme(): void {
    const next = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('mdgarden:theme', next);
  }

  function beginResize(paneIndex: number, startClientX: number): void {
    const groupElement = paneGroupReference.current;

    if (!groupElement || !panes[paneIndex + 1]) {
      return;
    }

    const totalWidth = groupElement.getBoundingClientRect().width;
    const leftStartingWidth = panes[paneIndex].width;
    const rightStartingWidth = panes[paneIndex + 1].width;
    const combinedWidth = leftStartingWidth + rightStartingWidth;
    const minimumWidth = 0.18;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";

    const handlePointerMove = (moveEvent: MouseEvent) => {
      moveEvent.preventDefault();
      const delta = (moveEvent.clientX - startClientX) / totalWidth;
      const nextLeftWidth = clamp(
        leftStartingWidth + delta,
        minimumWidth,
        combinedWidth - minimumWidth
      );
      const nextRightWidth = combinedWidth - nextLeftWidth;

      setPanes((previousPanes) =>
        previousPanes.map((pane, currentPaneIndex) => {
          if (currentPaneIndex === paneIndex) {
            return { ...pane, width: nextLeftWidth };
          }

          if (currentPaneIndex === paneIndex + 1) {
            return { ...pane, width: nextRightWidth };
          }

          return pane;
        })
      );
    };

    const handlePointerUp = () => {
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("mousemove", handlePointerMove);
      window.removeEventListener("mouseup", handlePointerUp);
    };

    window.addEventListener("mousemove", handlePointerMove);
    window.addEventListener("mouseup", handlePointerUp);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <FileTree
          rootName={treePayload?.rootName ?? "mdgarden"}
          rootLabel={treePayload?.rootLabel ?? "Loading workspace..."}
          tree={treePayload?.tree ?? []}
          activePath={activePane?.path ?? null}
          onOpen={(documentPath) => openInPane(documentPath)}
          onOpenToSide={(documentPath) => openToSide(documentPath)}
        />

        {treeError ? <p className="status-message error">{treeError}</p> : null}
      </aside>

      <main className="workspace">
        <header className="workspace-bar">
          <span className="workspace-brand">mdgarden</span>
          <button
            type="button"
            className="theme-toggle"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
          >
            {theme === 'light' ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" /></svg>
            )}
          </button>
        </header>

        <div className="pane-group" ref={paneGroupReference}>
          {panes.map((pane, paneIndex) => {
            const state = pane.path ? documents[pane.path] : undefined;

            return (
              <div
                key={pane.id}
                className={`pane ${pane.id === activePane.id ? "is-active" : ""}`}
                style={{ width: `${pane.width * 100}%` }}
                onClick={() => setActivePaneId(pane.id)}
              >
                <div className="pane-header">
                  <div>
                    <p className="eyebrow">Pane {paneIndex + 1}</p>
                    <h3>{getDocumentTitle(pane.path)}</h3>
                  </div>

                  <div className="pane-actions">
                    {pane.path ? (
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => openToSide(pane.path!, pane.id)}
                      >
                        Split
                      </button>
                    ) : null}

                    <button
                      type="button"
                      className="ghost-button"
                      aria-label={`Close pane ${paneIndex + 1}`}
                      onClick={() => closePane(pane.id)}
                    >
                      Close
                    </button>
                  </div>
                </div>

                <div className="pane-body">
                  {!pane.path ? (
                    <div className="empty-pane">
                      <div className="empty-pane-copy">
                        <p className="empty-pane-title">Open a markdown file</p>
                        <p>Expand the folders in the sidebar to get started.</p>
                      </div>
                    </div>
                  ) : state?.status === "error" && !state.data ? (
                    <div className="empty-pane error">
                      <p>{state.error}</p>
                    </div>
                  ) : state?.data ? (
                    <MarkdownDocument
                      document={state.data}
                      pendingHash={pendingHashes[pane.id] ?? null}
                      onHashHandled={() => handleHashHandled(pane.id)}
                      onOpenDocument={(documentPath, hash) => {
                        openInPane(documentPath, pane.id);

                        if (hash) {
                          setPendingHashes((previousHashes) => ({
                            ...previousHashes,
                            [pane.id]: hash
                          }));
                        }
                      }}
                    />
                  ) : (
                    <div className="empty-pane">
                      <p>Loading document…</p>
                    </div>
                  )}
                </div>

                {paneIndex < panes.length - 1 ? (
                  <button
                    type="button"
                    className="pane-resizer"
                    aria-label={`Resize panes ${paneIndex + 1} and ${paneIndex + 2}`}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      beginResize(paneIndex, event.clientX);
                    }}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? `Request failed with ${response.status}.`);
  }

  return (await response.json()) as T;
}

function loadWorkspace(): PersistedWorkspace {
  const fallbackPane = createPane();

  if (typeof window === "undefined") {
    return {
      panes: [fallbackPane],
      activePaneId: fallbackPane.id
    };
  }

  const rawValue = window.localStorage.getItem(STORAGE_KEY);

  if (!rawValue) {
    return {
      panes: [fallbackPane],
      activePaneId: fallbackPane.id
    };
  }

  try {
    const parsedValue = JSON.parse(rawValue) as PersistedWorkspace;

    if (!Array.isArray(parsedValue.panes) || parsedValue.panes.length === 0) {
      return {
        panes: [fallbackPane],
        activePaneId: fallbackPane.id
      };
    }

    return {
      panes: normalizePaneWidths(
        parsedValue.panes.map((pane) => ({
          id: pane.id || createPane().id,
          path: pane.path ?? null,
          width: typeof pane.width === "number" ? pane.width : 1
        }))
      ),
      activePaneId: parsedValue.activePaneId ?? parsedValue.panes[0].id
    };
  } catch {
    return {
      panes: [fallbackPane],
      activePaneId: fallbackPane.id
    };
  }
}

function saveWorkspace(workspace: PersistedWorkspace): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error.";
}
