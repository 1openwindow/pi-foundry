#!/usr/bin/env node
// verify.mjs — smoke test a deployed Hosted Agent via azd ai agent invoke.
//
// Usage:
//   verify.mjs [--agent <name>] [--version <N>] [--timeout <seconds>] [--message <text>] [--session <id>]
//
// Defaults: agent + version come from azd env AGENT_*_NAME / AGENT_*_VERSION,
//           matched (when possible) against `name:` in agent.yaml.

import { readFileSync } from "node:fs";
import { azdEnvValues, installCrashHandlers, parseArgs, run } from "./_lib.mjs";

installCrashHandlers();

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.error("Usage: verify.mjs [--agent <name>] [--version <N>] [--timeout <seconds>] [--message <text>] [--session <id>]");
  process.exit(0);
}

const env = azdEnvValues();
const expectedName = readAgentNameFromYaml();
const outputs = findAgentOutputs(env, expectedName);

const agent = args.agent ?? outputs.name ?? expectedName;
const version = args.version ?? outputs.version;
const timeout = args.timeout ?? "900";
const message = args.message ?? "Say exactly: ok";

if (!agent) throw new Error("agent name not provided and no AGENT_*_NAME output found in azd env");

const invokeArgs = ["ai", "agent", "invoke", agent, "--protocol", "invocations", "--timeout", timeout];
if (version) invokeArgs.push("--version", version);
if (args.session) invokeArgs.push("--session-id", args.session);
else invokeArgs.push("--new-session");
invokeArgs.push(message);

console.error(`Invoking ${agent}${version ? ` v${version}` : ""}${args.session ? ` (session ${args.session})` : " (new session)"}...`);
console.log(run("azd", invokeArgs, { stdio: ["ignore", "pipe", "inherit"] }));

// ---------------------------------------------------------------------------

function readAgentNameFromYaml() {
  try {
    return readFileSync("agent.yaml", "utf8").match(/^\s*name:\s*["']?([^"'\s]+)["']?\s*$/m)?.[1];
  } catch {
    return undefined;
  }
}

function findAgentOutputs(values, expectedName) {
  const entries = Object.entries(values).filter(([key, value]) => key.startsWith("AGENT_") && key.endsWith("_NAME") && (!expectedName || value === expectedName));
  const nameEntry = entries[0] ?? Object.entries(values).find(([key]) => key.startsWith("AGENT_") && key.endsWith("_NAME"));
  if (!nameEntry) return {};
  const prefix = nameEntry[0].slice(0, -"_NAME".length);
  return { name: nameEntry[1], version: values[`${prefix}_VERSION`] };
}
