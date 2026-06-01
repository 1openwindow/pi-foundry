#!/usr/bin/env node
// pi-foundry CLI shipped inside the runtime image.
// Lets users introspect the contract without running the full backend.
//
//   pi-foundry contract              prints contract.json (single source of truth)
//   pi-foundry doctor                checks env vars and prints redacted summary
//   pi-foundry version               prints the runtime image's pi-foundry version

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { contract, validateRuntimeEnv } from "./contract.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const cmd = process.argv[2];

switch (cmd) {
  case "contract":
    process.stdout.write(`${JSON.stringify(contract, null, 2)}\n`);
    break;

  case "doctor": {
    const mock = isTruthy(process.env.PI_MOCK);
    const issues = validateRuntimeEnv(process.env, { mock });
    const inspected = [
      "PI_MOCK",
      "PI_ARGS",
      "PI_MODEL_AUTH",
      "PI_OPENAI_BASE_URL",
      "PI_OPENAI_MODEL",
      "PI_OPENAI_API_KEY",
      "WORKSPACE_DIR",
      "STATE_DIR",
      "PI_CODING_AGENT_DIR",
      "FOUNDRY_PROJECT_ENDPOINT",
    ];
    const env = {};
    for (const name of inspected) env[name] = redactIfSecret(name, process.env[name]);
    const report = { mock, env, issues };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exit(issues.some((issue) => issue.severity === "error") ? 1 : 0);
    break;
  }

  case "version": {
    try {
      const pkg = JSON.parse(readFileSync(resolve(here, "../package.json"), "utf8"));
      process.stdout.write(`${pkg.name}@${pkg.version}\n`);
    } catch {
      process.stdout.write("pi-foundry@unknown\n");
    }
    break;
  }

  case undefined:
  case "--help":
  case "-h":
    process.stdout.write("Usage: pi-foundry <contract|doctor|version>\n");
    process.exit(cmd === undefined ? 2 : 0);
    break;

  default:
    process.stderr.write(`Unknown command: ${cmd}\n`);
    process.stderr.write("Usage: pi-foundry <contract|doctor|version>\n");
    process.exit(2);
}

function isTruthy(value) {
  return value === "1" || value === "true";
}

function redactIfSecret(name, value) {
  if (value === undefined || value === "") return null;
  if (/(KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)/i.test(name)) {
    if (value.length <= 8) return "<set>";
    return `${value.slice(0, 4)}…${value.slice(-4)}`;
  }
  return value;
}
