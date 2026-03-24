import { startTransition, useCallback, useEffect, useRef, useState } from "react";

import { FileTree } from "./FileTree";
import { MarkdownDocument } from "./MarkdownDocument";
import type { DocumentPayload, TreePayload } from "./types";

const STORAGE_KEY = "mdgarden:workspace:v2";

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

export function App() {
  const [treePayload, setTreePayload] = useState<TreePayload | null>(null);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [activePath, setActivePath] = useState<string | null>(() => loadActivePath());
  const [documents, setDocuments] = useState<Record<string, DocumentState>>({});
  const [pendingHash, setPendingHash] = useState<string | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    return (document.documentElement.getAttribute('data-theme') as 'light' | 'dark') || 'light';
  });
  const activePathRef = useRef(activePath);
  const documentsRef = useRef(documents);

  activePathRef.current = activePath;
  documentsRef.current = documents;

  useEffect(() => {
    saveActivePath(activePath);
  }, [activePath]);

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
    const existingState = documentsRef.current[documentPath];

    if (!force && (existingState?.status === "ready" || existingState?.status === "loading")) {
      return;
    }

    setDocuments((prev) => ({
      ...prev,
      [documentPath]: {
        status: "loading",
        data: prev[documentPath]?.data
      }
    }));

    try {
      const nextDocument = await fetchJson<DocumentPayload>(
        `/api/doc?path=${encodeURIComponent(documentPath)}`
      );

      startTransition(() => {
        setDocuments((prev) => ({
          ...prev,
          [documentPath]: {
            status: "ready",
            data: nextDocument
          }
        }));
      });
    } catch (error) {
      setDocuments((prev) => ({
        ...prev,
        [documentPath]: {
          status: "error",
          error: getErrorMessage(error),
          data: prev[documentPath]?.data
        }
      }));
    }
  }, []);

  const handleServerEvent = useCallback(async (event: ServerEventPayload) => {
    if (event.type === "ready" || !event.path) {
      return;
    }

    if (event.type !== "change" || event.isMarkdown) {
      void refreshTree();
    }

    if (event.isMarkdown && activePathRef.current === event.path) {
      void loadDocument(event.path, true);
    }
  }, [loadDocument, refreshTree]);

  useEffect(() => {
    void refreshTree();
  }, [refreshTree]);

  useEffect(() => {
    if (activePath) {
      void loadDocument(activePath);
    }
  }, [activePath, loadDocument]);

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

  function openDocument(documentPath: string): void {
    setActivePath(documentPath);
  }

  function toggleTheme(): void {
    const next = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('mdgarden:theme', next);
  }

  const state = activePath ? documents[activePath] : undefined;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <FileTree
          rootName={treePayload?.rootName ?? "mdgarden"}
          rootLabel={treePayload?.rootLabel ?? "Loading workspace..."}
          tree={treePayload?.tree ?? []}
          activePath={activePath}
          onOpen={openDocument}
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

        <div className="content-area">
          {!activePath ? (
            <div className="empty-state">
              <div className="empty-state-copy">
                <p className="empty-state-title">Open a markdown file</p>
                <p>Select a file from the sidebar to get started.</p>
              </div>
            </div>
          ) : state?.status === "error" && !state.data ? (
            <div className="empty-state error">
              <p>{state.error}</p>
            </div>
          ) : state?.data ? (
            <MarkdownDocument
              document={state.data}
              pendingHash={pendingHash}
              onHashHandled={() => setPendingHash(null)}
              onOpenDocument={(documentPath, hash) => {
                openDocument(documentPath);
                if (hash) {
                  setPendingHash(hash);
                }
              }}
            />
          ) : (
            <div className="empty-state">
              <p>Loading...</p>
            </div>
          )}
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

function loadActivePath(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveActivePath(path: string | null): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(path));
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error.";
}
