#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";

const args = parseArgs(process.argv.slice(2));

function usage() {
  return `Usage:
  npm run configure:agent -- <agent-name> [--display-name=<name>] [--description=<text>] [--acr=<registry>] [--dry-run]

Examples:
  npm run configure:agent -- media-report-foundry
  npm run configure:agent -- media-report-foundry --display-name="Media Report Agent" --acr=crce6hg4ngzj3as.azurecr.io

Updates template identity across:
  - package.json
  - azure.yaml
  - agent.yaml
  - agent.manifest.yaml
  - agent.config.yaml, if present

The script avoids changing runtime code. Use --dry-run to preview changes.`;
}

function parseArgs(argv) {
  const result = {
    name: undefined,
    displayName: undefined,
    description: undefined,
    acr: undefined,
    dryRun: false,
    help: false,
  };

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") result.help = true;
    else if (arg === "--dry-run") result.dryRun = true;
    else if (arg.startsWith("--display-name=")) result.displayName = arg.slice("--display-name=".length);
    else if (arg.startsWith("--description=")) result.description = arg.slice("--description=".length);
    else if (arg.startsWith("--acr=")) result.acr = arg.slice("--acr=".length).replace(/^https?:\/\//, "").replace(/\/+$/, "");
    else if (!result.name) result.name = arg;
    else throw new Error(`Unexpected argument: ${arg}`);
  }

  return result;
}

function validateAgentName(name) {
  if (!name) throw new Error("agent name is required\n\n" + usage());
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name)) {
    throw new Error("agent name must be 1-128 characters, start with a letter/number, and contain only letters, numbers, dots, underscores, or hyphens");
  }
}

async function readOptional(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

function replaceRequired(text, regex, replacement, label) {
  if (!regex.test(text)) throw new Error(`Could not find ${label}`);
  return text.replace(regex, replacement);
}

function yamlQuote(value) {
  return JSON.stringify(value);
}

function blockDescription(text) {
  return text
    .split(/\r?\n/)
    .map((line) => `  ${line}`)
    .join("\n");
}

async function updateFile(path, updater) {
  const before = await readOptional(path);
  if (before === undefined) return { path, exists: false, changed: false };
  const after = updater(before);
  const changed = before !== after;
  if (changed && !args.dryRun) await writeFile(path, after, "utf8");
  return { path, exists: true, changed };
}

function updatePackageJson(text, agentName) {
  const json = JSON.parse(text);
  json.name = agentName;
  return `${JSON.stringify(json, null, 2)}\n`;
}

function updateAzureYaml(text, agentName) {
  let next = replaceRequired(text, /^name:\s*.*$/m, `name: ${agentName}`, "azure.yaml top-level name");
  next = replaceRequired(next, /(^services:\n)(\s+)[^\s:]+:/m, `$1$2${agentName}:`, "azure.yaml service name");
  return next;
}

function updateAgentYaml(text, agentName, acr) {
  let next = replaceRequired(text, /^name:\s*.*$/m, `name: ${agentName}`, "agent.yaml name");
  if (acr) {
    next = replaceRequired(next, /^image:\s*.*$/m, `image: ${acr}/${agentName}:latest`, "agent.yaml image");
  }
  return next;
}

function updateAgentManifest(text, agentName, displayName, description) {
  let next = replaceRequired(text, /^name:\s*.*$/m, `name: ${agentName}`, "agent.manifest.yaml name");
  next = replaceRequired(next, /^displayName:\s*.*$/m, `displayName: ${yamlQuote(displayName)}`, "agent.manifest.yaml displayName");
  next = replaceRequired(
    next,
    /^description:\s*>\n(?:^[ \t].*\n?)+/m,
    `description: >\n${blockDescription(description)}\n`,
    "agent.manifest.yaml description",
  );
  next = replaceRequired(next, /(^template:\n\s+name:\s*).+$/m, `$1${agentName}`, "agent.manifest.yaml template name");
  return next;
}

function updateAgentConfig(text, agentName, displayName, description) {
  let next = replaceRequired(text, /^name:\s*.*$/m, `name: ${agentName}`, "agent.config.yaml name");
  next = replaceRequired(next, /^displayName:\s*.*$/m, `displayName: ${displayName}`, "agent.config.yaml displayName");
  next = replaceRequired(next, /^description:\s*.*$/m, `description: ${description}`, "agent.config.yaml description");
  return next;
}

async function main() {
  if (args.help) {
    console.log(usage());
    return;
  }

  validateAgentName(args.name);
  const agentName = args.name;
  const displayName = args.displayName ?? agentName
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
  const description = args.description ?? `Foundry Hosted Agent wrapper for ${displayName}.`;

  const results = [];
  results.push(await updateFile("package.json", (text) => updatePackageJson(text, agentName)));
  results.push(await updateFile("azure.yaml", (text) => updateAzureYaml(text, agentName)));
  results.push(await updateFile("agent.yaml", (text) => updateAgentYaml(text, agentName, args.acr)));
  results.push(await updateFile("agent.manifest.yaml", (text) => updateAgentManifest(text, agentName, displayName, description)));
  results.push(await updateFile("agent.config.yaml", (text) => updateAgentConfig(text, agentName, displayName, description)));

  console.log(`${args.dryRun ? "Would configure" : "Configured"} agent: ${agentName}`);
  console.log(`Display name: ${displayName}`);
  console.log(`Description:  ${description}`);
  if (args.acr) console.log(`ACR image:    ${args.acr}/${agentName}:latest`);
  else console.log("ACR image:    unchanged; pass --acr=<registry> to update agent.yaml image");
  console.log("");

  for (const result of results) {
    if (!result.exists) console.log(`- missing optional ${result.path}`);
    else if (result.changed) console.log(`${args.dryRun ? "→" : "✓"} ${result.path}`);
    else console.log(`- unchanged ${result.path}`);
  }

  console.log("");
  console.log("Next steps:");
  console.log("  1. Review the modified YAML files.");
  console.log("  2. npm run doctor");
  console.log("  3. azd env new <env-name> or azd env select <env-name>");
  console.log("  4. Configure PI_* and artifact env values.");
  console.log("  5. azd deploy --no-prompt");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
