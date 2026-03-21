import path from "node:path";

export interface ParsedCliArgs {
  command: "show";
  rootPath: string;
  rootLabel: string;
  port: number;
  openBrowser: boolean;
}

export function parseCliArgs(argv: string[], cwd: string = process.cwd()): ParsedCliArgs {
  if (argv[0] !== "show") {
    throw new Error(getUsageText());
  }

  let rootArgument: string | undefined;
  let port = 3210;
  let openBrowser = true;

  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--no-open") {
      openBrowser = false;
      continue;
    }

    if (argument === "--port") {
      const rawPort = argv[index + 1];

      if (!rawPort) {
        throw new Error("Missing value for --port.");
      }

      port = parsePort(rawPort);
      index += 1;
      continue;
    }

    if (argument.startsWith("--port=")) {
      port = parsePort(argument.slice("--port=".length));
      continue;
    }

    if (argument.startsWith("--")) {
      throw new Error(`Unknown flag: ${argument}`);
    }

    if (rootArgument) {
      throw new Error("Only one root path may be provided.");
    }

    rootArgument = argument;
  }

  return {
    command: "show",
    rootPath: path.resolve(cwd, rootArgument ?? "."),
    rootLabel: getRootLabel(rootArgument),
    port,
    openBrowser
  };
}

export function getUsageText(): string {
  return [
    "Usage: mdgarden show [root] [--port <number>] [--no-open]",
    "       mdgarden --help",
    "",
    "Commands:",
    "  show       Start the local markdown browser."
  ].join("\n");
}

function parsePort(rawPort: string): number {
  const parsedPort = Number.parseInt(rawPort, 10);

  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65_535) {
    throw new Error(`Invalid port: ${rawPort}`);
  }

  return parsedPort;
}

function getRootLabel(rootArgument: string | undefined): string {
  if (!rootArgument) {
    return ".";
  }

  const normalizedPath = path.normalize(rootArgument);

  if (path.isAbsolute(normalizedPath)) {
    return path.basename(normalizedPath) || normalizedPath;
  }

  return normalizedPath.split(path.sep).join(path.posix.sep);
}
