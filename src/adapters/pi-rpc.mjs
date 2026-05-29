import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export function createPiRpcAdapter({
  piBin,
  piArgs,
  piAgentDir,
  requestTimeoutMs,
  mock,
  HttpError,
  log,
  foundryOpenAIBaseUrl,
  foundryOpenAIModel,
}) {
  function removeArgWithValue(args, name) {
    const result = [];
    for (let index = 0; index < args.length; index += 1) {
      if (args[index] === name) {
        index += 1;
        continue;
      }
      result.push(args[index]);
    }
    return result;
  }

  function buildPiArgs(sessionDir) {
    let args = piArgs.filter((arg) => arg !== "--no-session" && arg !== "--continue" && arg !== "-c");
    args = removeArgWithValue(args, "--session-dir");
    return [...args, "--continue", "--session-dir", sessionDir];
  }

  function extractTextContent(content) {
    if (!Array.isArray(content)) return "";
    return content
      .filter((item) => item && item.type === "text" && typeof item.text === "string")
      .map((item) => item.text)
      .join("\n");
  }

  function extractFallbackTextFromAgentEnd(event) {
    if (!Array.isArray(event.messages)) return "";

    for (let index = event.messages.length - 1; index >= 0; index -= 1) {
      const message = event.messages[index];
      if (message?.role !== "assistant") continue;
      const text = extractTextContent(message.content).trim();
      if (text.length > 0) return text;
    }

    for (let index = event.messages.length - 1; index >= 0; index -= 1) {
      const message = event.messages[index];
      if (message?.role !== "toolResult") continue;
      const text = extractTextContent(message.content).trim();
      if (text.length > 0) return text;
    }

    return "";
  }

  function extractAgentEndError(event) {
    if (!Array.isArray(event.messages)) return undefined;
    for (let index = event.messages.length - 1; index >= 0; index -= 1) {
      const message = event.messages[index];
      if (message?.role !== "assistant") continue;
      if (message.stopReason === "error" && typeof message.errorMessage === "string") {
        return message.errorMessage;
      }
    }
    return undefined;
  }

  async function invoke(prompt, options) {
    if (mock) {
      return {
        text: `mock response: ${prompt}`,
        events: [],
        sessionId: options.sessionId,
        mock: true,
        piExitCode: undefined,
      };
    }

    const id = randomUUID();
    const args = buildPiArgs(options.piSessionDir);
    const child = spawn(piBin, args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        PI_CODING_AGENT_DIR: piAgentDir,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdoutBuffer = "";
    let stderr = "";
    let text = "";
    const events = [];
    let promptAccepted = false;
    let settled = false;
    let piExitCode;

    return new Promise((resolveResult, reject) => {
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (!child.killed) child.kill("SIGTERM");
        if (error) reject(error);
        else resolveResult(result);
      };

      const timer = setTimeout(() => {
        finish(new HttpError(504, `pi request timed out after ${requestTimeoutMs}ms`, { stderr }));
      }, requestTimeoutMs);

      child.on("error", (error) => {
        finish(new HttpError(502, `failed to start pi: ${error.message}`));
      });

      child.on("close", (code) => {
        piExitCode = code ?? undefined;
        if (!settled && code !== 0) {
          finish(new HttpError(502, `pi exited with code ${code}`, { stderr }));
        }
      });

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString("utf8");
      });

      child.stdout.on("data", (chunk) => {
        stdoutBuffer += chunk.toString("utf8");
        let newlineIndex = stdoutBuffer.indexOf("\n");
        while (newlineIndex !== -1) {
          const line = stdoutBuffer.slice(0, newlineIndex).replace(/\r$/, "");
          stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
          handleRpcLine(line);
          newlineIndex = stdoutBuffer.indexOf("\n");
        }
      });

      function writeRpc(payload) {
        child.stdin.write(`${JSON.stringify(payload)}\n`);
      }

      function handleRpcLine(line) {
        if (line.trim().length === 0) return;

        let event;
        try {
          event = JSON.parse(line);
        } catch (error) {
          finish(new HttpError(502, `Failed to parse pi RPC output: ${error.message}`, { line, stderr }));
          return;
        }

        events.push(event);

        if (event.type === "response" && event.id === id) {
          promptAccepted = event.success === true;
          if (!event.success) {
            finish(new HttpError(502, event.error ?? "pi rejected prompt", { stderr }));
          }
          return;
        }

        if (event.type === "message_update") {
          const update = event.assistantMessageEvent;
          if (update?.type === "text_delta" && typeof update.delta === "string") {
            text += update.delta;
            options.onTextDelta?.(update.delta);
          }
          if (update?.type === "error") {
            finish(new HttpError(502, update.error ?? update.reason ?? "pi stream error", { stderr }));
          }
          return;
        }

        if (event.type === "extension_ui_request" && event.id) {
          writeRpc({ type: "extension_ui_response", id: event.id, cancelled: true });
          return;
        }

        if (event.type === "agent_end") {
          const agentError = extractAgentEndError(event);
          if (agentError) {
            finish(new HttpError(502, agentError, { stderr }));
            return;
          }

          finish(undefined, {
            text: text.length > 0 ? text : extractFallbackTextFromAgentEnd(event),
            events,
            promptAccepted,
            sessionId: options.sessionId,
            mock: false,
            piExitCode,
          });
        }
      }

      writeRpc({ id, type: "prompt", message: prompt });
    });
  }

  async function loadJsonFile(path) {
    try {
      return JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return {};
      throw error;
    }
  }

  async function configureFoundryOpenAIProvider() {
    if (!process.env.PI_OPENAI_API_KEY && !process.env.FOUNDRY_OPENAI_API_KEY) return;

    const modelsPath = resolve(piAgentDir, "models.json");
    const config = await loadJsonFile(modelsPath);
    const providers = config.providers && typeof config.providers === "object" ? config.providers : {};
    providers.foundry = {
      baseUrl: foundryOpenAIBaseUrl,
      api: "openai-responses",
      apiKey: process.env.PI_OPENAI_API_KEY ? "PI_OPENAI_API_KEY" : "FOUNDRY_OPENAI_API_KEY",
      models: [
        {
          id: foundryOpenAIModel,
          name: `Foundry ${foundryOpenAIModel}`,
          reasoning: false,
          input: ["text"],
          contextWindow: 128000,
          maxTokens: 16384,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        },
      ],
    };
    config.providers = providers;

    await writeFile(modelsPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    log("info", "foundry_openai_provider_configured", {
      provider: "foundry",
      model: foundryOpenAIModel,
      baseUrl: foundryOpenAIBaseUrl,
      modelsPath,
    });
  }

  return {
    invoke,
    configureFoundryOpenAIProvider,
  };
}
