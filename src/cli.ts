#!/usr/bin/env node

import { stat } from "node:fs/promises";

import { getUsageText, parseCliArgs } from "./lib/cli.js";
import { startServer } from "./server/start-server.js";

async function main(): Promise<void> {
  try {
    const rawArgs = process.argv.slice(2);

    if (rawArgs.length === 0 || rawArgs.includes("--help") || rawArgs.includes("-h")) {
      process.stdout.write(`${getUsageText()}\n`);
      return;
    }

    const parsedArgs = parseCliArgs(rawArgs);
    const rootStats = await stat(parsedArgs.rootPath);

    if (!rootStats.isDirectory()) {
      throw new Error("The root path must be a directory.");
    }

    const server = await startServer({
      rootPath: parsedArgs.rootPath,
      rootLabel: parsedArgs.rootLabel,
      requestedPort: parsedArgs.port,
      openBrowser: parsedArgs.openBrowser
    });

    process.stdout.write(`mdgarden running at ${server.url}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

void main();
