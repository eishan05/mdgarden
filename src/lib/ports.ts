import net from "node:net";

export async function listenOnAvailablePort(
  server: net.Server,
  startingPort: number,
  host: string = "127.0.0.1"
): Promise<number> {
  for (let port = startingPort; port <= 65_535; port += 1) {
    try {
      await listen(server, port, host);
      return port;
    } catch (error) {
      if (isAddressInUseError(error) && port < 65_535) {
        continue;
      }

      throw error;
    }
  }

  throw new Error(`No available port found starting at ${startingPort}.`);
}

async function listen(server: net.Server, port: number, host: string): Promise<void> {
  return await new Promise<void>((resolve, reject) => {
    const handleError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const handleListening = () => {
      cleanup();
      resolve();
    };

    const cleanup = () => {
      server.off("error", handleError);
      server.off("listening", handleListening);
    };

    server.once("error", handleError);
    server.once("listening", handleListening);
    server.listen(port, host);
  });
}

function isAddressInUseError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code === "EADDRINUSE"
  );
}
