import { createServer } from "node:http";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import chokidar from "chokidar";
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

  const watcher = chokidar.watch(rootPath, {
    ignoreInitial: true,
    ignored: (watchedPath) => isIgnoredPath(rootPath, watchedPath)
  });

  watcher.on("all", (eventName, changedPath) => {
    if (!changedPath || isIgnoredPath(rootPath, changedPath)) {
      return;
    }

    const relativePath = toRelativeWorkspacePath(rootPath, changedPath);

    if (!relativePath || relativePath.startsWith("../")) {
      return;
    }

    broadcastEvent(sseClients, {
      type: mapWatcherEvent(eventName),
      path: relativePath,
      isMarkdown: isMarkdownPath(relativePath)
    });
  });

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

      await watcher.close();
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

function mapWatcherEvent(eventName: string): ServerEvent["type"] {
  if (eventName === "add" || eventName === "addDir") {
    return "add";
  }

  if (eventName === "unlink" || eventName === "unlinkDir") {
    return "remove";
  }

  return "change";
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
