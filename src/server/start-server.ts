import { createServer } from "node:http";
import { watch } from "node:fs";
import { access, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";
import open from "open";

import { resolveAssetFile } from "../lib/assets.js";
import { readMarkdownDocument } from "../lib/documents.js";
import { listenOnAvailablePort } from "../lib/ports.js";
import {
  isIgnoredPath,
  isMarkdownPath,
  toRelativeWorkspacePath
} from "../lib/pathing.js";
import { scanMarkdownTree } from "../lib/tree.js";

export interface StartServerOptions {
  rootPath: string;
  rootLabel: string;
  requestedPort: number;
  openBrowser: boolean;
}

export interface RunningServer {
  port: number;
  url: string;
  close: () => Promise<void>;
}

interface ServerEvent {
  type: "ready" | "add" | "change" | "remove";
  path?: string;
  isMarkdown?: boolean;
}

export async function startServer(options: StartServerOptions): Promise<RunningServer> {
  const rootPath = path.resolve(options.rootPath);
  const clientDistPath = await resolveClientDistPath();
  const app = express();
  const server = createServer(app);
  const sseClients = new Set<express.Response>();

  app.disable("x-powered-by");

  app.get("/api/tree", async (_request, response) => {
    try {
      response.json(await scanMarkdownTree(rootPath, options.rootLabel));
    } catch (error) {
      response.status(500).json({ error: getErrorMessage(error) });
    }
  });

  app.get("/api/doc", async (request, response) => {
    const requestedPath = getRequestedPath(request.query.path);

    if (!requestedPath) {
      response.status(400).json({ error: "Missing document path." });
      return;
    }

    try {
      response.json(await readMarkdownDocument(rootPath, requestedPath));
    } catch (error) {
      const message = getErrorMessage(error);
      response.status(message.includes("workspace root") ? 400 : 404).json({ error: message });
    }
  });

  app.get("/api/asset", async (request, response) => {
    const requestedPath = getRequestedPath(request.query.path);

    if (!requestedPath) {
      response.status(400).json({ error: "Missing asset path." });
      return;
    }

    try {
      response.sendFile(await resolveAssetFile(rootPath, requestedPath));
    } catch (error) {
      const message = getErrorMessage(error);
      response.status(message.includes("workspace root") ? 400 : 404).json({ error: message });
    }
  });

  app.get("/api/events", (request, response) => {
    response.setHeader("Content-Type", "text/event-stream");
    response.setHeader("Cache-Control", "no-cache");
    response.setHeader("Connection", "keep-alive");
    response.flushHeaders();
    response.write(`data: ${JSON.stringify({ type: "ready" } satisfies ServerEvent)}\n\n`);

    sseClients.add(response);
    const heartbeat = setInterval(() => {
      response.write(": heartbeat\n\n");
    }, 25_000);

    request.on("close", () => {
      clearInterval(heartbeat);
      sseClients.delete(response);
      response.end();
    });
  });

  app.use(express.static(clientDistPath));

  app.use("/api", (_request, response) => {
    response.status(404).json({ error: "Not found." });
  });

  app.use((_request, response) => {
    response.sendFile(path.join(clientDistPath, "index.html"));
  });

  const pendingWatchEvents = new Map<string, NodeJS.Timeout>();
  const WATCH_DEBOUNCE_MS = 50;

  const fsWatcher = watch(
    rootPath,
    { recursive: true, persistent: true },
    (eventType, filename) => {
      if (!filename) {
        return;
      }

      const absolutePath = path.join(rootPath, filename.toString());

      if (isIgnoredPath(rootPath, absolutePath)) {
        return;
      }

      const relativePath = toRelativeWorkspacePath(rootPath, absolutePath);

      if (!relativePath || relativePath.startsWith("../")) {
        return;
      }

      const key = `${eventType}:${relativePath}`;
      const existing = pendingWatchEvents.get(key);

      if (existing) {
        clearTimeout(existing);
      }

      pendingWatchEvents.set(
        key,
        setTimeout(() => {
          pendingWatchEvents.delete(key);
          void classifyAndBroadcast(absolutePath, relativePath, eventType);
        }, WATCH_DEBOUNCE_MS)
      );
    }
  );

  fsWatcher.on("error", () => {});

  async function classifyAndBroadcast(
    absolutePath: string,
    relativePath: string,
    eventType: string
  ): Promise<void> {
    let exists = true;

    try {
      await stat(absolutePath);
    } catch {
      exists = false;
    }

    const type: ServerEvent["type"] = !exists
      ? "remove"
      : eventType === "rename"
        ? "add"
        : "change";

    broadcastEvent(sseClients, {
      type,
      path: relativePath,
      isMarkdown: isMarkdownPath(relativePath)
    });
  }

  const port = await listenOnAvailablePort(server, options.requestedPort);

  const url = `http://127.0.0.1:${port}`;

  if (options.openBrowser) {
    await open(url);
  }

  return {
    port,
    url,
    close: async () => {
      broadcastEvent(sseClients, { type: "remove" });

      for (const client of sseClients) {
        client.end();
      }

      for (const timer of pendingWatchEvents.values()) {
        clearTimeout(timer);
      }
      pendingWatchEvents.clear();
      fsWatcher.close();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    }
  };
}

async function resolveClientDistPath(): Promise<string> {
  const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
  const candidatePaths = [
    path.resolve(currentDirectory, "../client"),
    path.resolve(currentDirectory, "../../dist/client")
  ];

  for (const candidatePath of candidatePaths) {
    try {
      await access(path.join(candidatePath, "index.html"));
      return candidatePath;
    } catch {
      continue;
    }
  }

  throw new Error("Client build not found. Run `npm run build` before starting mdgarden.");
}

function getRequestedPath(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function broadcastEvent(clients: Set<express.Response>, event: ServerEvent): void {
  const payload = `data: ${JSON.stringify(event)}\n\n`;

  for (const client of clients) {
    client.write(payload);
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error.";
}
