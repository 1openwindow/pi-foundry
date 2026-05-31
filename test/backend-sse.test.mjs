// Backend SSE contract regression: token events MUST carry only model deltas;
// `done` events carry the structured artifacts array and the model-only `full_text`.
// This locks the fix for the prior bug where server-side trailers (artifact
// markdown links, publish errors) were emitted as `token` events.

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { once } from "node:events";

const repoRoot = new URL("..", import.meta.url).pathname;

function spawnBackend(env) {
  const child = spawn(process.execPath, [join(repoRoot, "src/backend.mjs")], {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  return child;
}

async function waitForListening(child, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let buffer = "";
  while (Date.now() < deadline) {
    const [chunk] = await Promise.race([
      once(child.stdout, "data"),
      sleep(timeoutMs).then(() => [""]),
    ]);
    buffer += chunk;
    for (const line of buffer.split("\n")) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        if (event.message === "server_listening" && typeof event.url === "string") {
          const url = new URL(event.url);
          // The backend logs the configured host:port. When PORT=0 was requested it
          // logs `:0`; we'd need to read the actual listening port differently. For
          // tests we always pick a real port.
          return Number.parseInt(url.port, 10);
        }
      } catch {}
    }
  }
  throw new Error("backend did not become ready in time");
}

async function readSseEvents(response) {
  const events = [];
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep = buffer.indexOf("\n\n");
    while (sep !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      for (const line of frame.split(/\r?\n/)) {
        if (!line.startsWith("data:")) continue;
        const raw = line.slice("data:".length).trim();
        if (!raw) continue;
        events.push(JSON.parse(raw));
      }
      sep = buffer.indexOf("\n\n");
    }
  }
  return events;
}

describe("backend SSE contract", () => {
  let child;
  let port;
  let tempHome;

  before(async () => {
    // Pick an unlikely-collide port; OS will reject if taken and we'll see it in test logs.
    port = 30000 + Math.floor(Math.random() * 5000);
    tempHome = mkdtempSync(join(tmpdir(), "pi-foundry-sse-"));
    child = spawnBackend({
      PORT: String(port),
      HOST: "127.0.0.1",
      PI_MOCK: "1",
      HOME: tempHome,
      WORKSPACE_DIR: tempHome,
      FILES_DIR: join(tempHome, "files"),
      STATE_DIR: join(tempHome, "state"),
    });
    await waitForListening(child);
  });

  after(async () => {
    if (child && !child.killed) {
      child.kill("SIGTERM");
      try { await once(child, "exit"); } catch {}
    }
    if (tempHome) rmSync(tempHome, { recursive: true, force: true });
  });

  it("emits zero token events in mock mode (mock adapter does not stream)", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/invocations`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({ message: "hello" }),
    });
    assert.equal(response.status, 200);
    const events = await readSseEvents(response);
    const tokens = events.filter((e) => e.type === "token");
    const done = events.find((e) => e.type === "done");
    assert.equal(tokens.length, 0, `expected no token events in mock mode, got ${tokens.length}`);
    assert.ok(done, "missing done event");
    assert.equal(done.full_text, "mock response: hello");
    assert.deepEqual(done.artifacts, []);
    assert.equal(typeof done.session_id, "string");
    assert.equal(typeof done.request_id, "string");
  });

  it("done.full_text is model text only; no Artifacts: trailer leaks into SSE", async () => {
    // Even without publishing configured, regression: the prior code would diff
    // streamed-vs-final text and emit the difference as a token event. We assert
    // there is no token carrying the literal model text.
    const response = await fetch(`http://127.0.0.1:${port}/invocations`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({ message: "Create an HTML report" }),
    });
    const events = await readSseEvents(response);
    const tokens = events.filter((e) => e.type === "token");
    assert.equal(tokens.length, 0);
    const done = events.find((e) => e.type === "done");
    assert.ok(done.full_text.startsWith("mock response:"));
    assert.ok(!done.full_text.includes("Artifacts:"), "SSE full_text must not include the markdown Artifacts: trailer");
  });

  it("non-stream JSON response keeps backwards-compatible shape (output + artifacts, no modelText)", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/invocations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "hello" }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.output, "mock response: hello");
    assert.deepEqual(body.artifacts, []);
    assert.equal(body.mock, true);
    assert.equal(typeof body.sessionId, "string");
    assert.equal(typeof body.requestId, "string");
    assert.ok(!("modelText" in body), "non-stream JSON must not leak the internal modelText field");
  });
});
