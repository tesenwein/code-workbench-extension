import readline from "node:readline";

/**
 * Wire up a JSON-RPC 2.0 stdio transport.
 * @param {(req: object) => Promise<unknown>} handleFn
 * @param {(msg: object) => void} sendFn
 */
export function startStdioServer(handleFn, sendFn) {
  let inFlight = 0;
  let stdinEnded = false;

  function maybeExit() {
    if (stdinEnded && inFlight === 0) process.exit(0);
  }

  const rl = readline.createInterface({ input: process.stdin });
  rl.on("line", async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let req;
    try {
      req = JSON.parse(trimmed);
    } catch {
      return;
    }
    const isNotification = req.id === undefined || req.id === null;
    inFlight++;
    try {
      const result = await handleFn(req);
      if (!isNotification && result !== null) {
        if (result && result._error) {
          sendFn({ jsonrpc: "2.0", id: req.id, error: result._error });
        } else {
          sendFn({ jsonrpc: "2.0", id: req.id, result });
        }
      }
    } catch (err) {
      if (!isNotification) {
        sendFn({
          jsonrpc: "2.0",
          id: req.id,
          error: { code: -32603, message: String(err?.message ?? err) },
        });
      }
    } finally {
      inFlight--;
      maybeExit();
    }
  });
  process.stdin.on("end", () => {
    stdinEnded = true;
    maybeExit();
  });
}
