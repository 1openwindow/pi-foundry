#!/usr/bin/env node
import { execFileSync } from "node:child_process";

const args = parseArgs(process.argv.slice(2));

function usage() {
  return `Usage:
  npm run deploy:foundry -- [--skip-doctor] [--skip-rbac]

Runs doctor, deploys with azd, grants artifact RBAC when configured, and prints next commands.`;
}

function parseArgs(argv) {
  const result = { skipDoctor: false, skipRbac: false, help: false };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") result.help = true;
    else if (arg === "--skip-doctor") result.skipDoctor = true;
    else if (arg === "--skip-rbac") result.skipRbac = true;
    else throw new Error(`Unexpected argument: ${arg}`);
  }
  return result;
}

function command(commandName, commandArgs, options = {}) {
  console.log(`$ ${[commandName, ...commandArgs].join(" ")}`);
  return execFileSync(commandName, commandArgs, {
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    env: process.env,
  }).trim();
}

function parseAzdEnvValues(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}

function findAgentOutputs(values) {
  const nameEntry = Object.entries(values).find(([key]) => key.startsWith("AGENT_") && key.endsWith("_NAME"));
  if (!nameEntry) return {};
  const prefix = nameEntry[0].slice(0, -"_NAME".length);
  return {
    name: nameEntry[1],
    version: values[`${prefix}_VERSION`],
    endpoint: values[`${prefix}_INVOCATIONS_ENDPOINT`],
  };
}

async function main() {
  if (args.help) {
    console.log(usage());
    return;
  }

  if (!args.skipDoctor) command("npm", ["run", "doctor"]);
  command("azd", ["deploy", "--no-prompt"]);

  const values = parseAzdEnvValues(command("azd", ["env", "get-values"], { capture: true }));
  const outputs = findAgentOutputs(values);
  const artifactMode = values.ARTIFACT_PUBLISH_MODE;
  const storageAccount = values.ARTIFACT_STORAGE_ACCOUNT;

  if (!args.skipRbac && outputs.name && artifactMode === "static-web" && storageAccount) {
    command("npm", ["run", "grant:artifact-rbac", "--", outputs.name, storageAccount]);
  }

  console.log("");
  console.log("Deploy complete.");
  if (outputs.name) console.log(`Agent:   ${outputs.name}`);
  if (outputs.version) console.log(`Version: ${outputs.version}`);
  if (outputs.endpoint) console.log(`Endpoint: ${outputs.endpoint}`);
  console.log("");
  if (outputs.name && outputs.version) {
    console.log("Try:");
    console.log(`  azd ai agent invoke ${outputs.name} --protocol invocations --version ${outputs.version} --new-session --timeout 900 'Say exactly: ok'`);
    console.log(`  npm run demo:remote:artifact -- ${outputs.name} ${outputs.version}`);
  } else {
    console.log("Could not infer agent output variables. Run: azd env get-values | grep AGENT_");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
