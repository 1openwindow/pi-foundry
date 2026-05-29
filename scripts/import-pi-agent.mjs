#!/usr/bin/env node
import { constants } from "node:fs";
import { access, cp, mkdir, readdir, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";

const args = process.argv.slice(2);
const options = parseArgs(args);

const planned = [];
let copied = 0;
let skipped = 0;
let warned = 0;

function parseArgs(argv) {
  const result = {
    source: undefined,
    dryRun: false,
    overwrite: false,
    help: false,
  };

  for (const arg of argv) {
    if (arg === "--dry-run") result.dryRun = true;
    else if (arg === "--overwrite") result.overwrite = true;
    else if (arg === "--help" || arg === "-h") result.help = true;
    else if (!result.source) result.source = arg;
    else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  return result;
}

function usage() {
  return `Usage:
  npm run import:pi-agent -- <path-to-existing-pi-agent> [--dry-run] [--overwrite]

Copies common Pi agent assets into this pi-foundry template:
  - .agents/skills/*
  - mcp.config.json
  - prompts/
  - demo-workspace/

Default behavior is safe: existing destination files/directories are skipped.
Use --overwrite to replace existing destinations.
Use --dry-run to preview planned actions.`;
}

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

function logAction(symbol, message) {
  console.log(`${symbol} ${message}`);
}

function warn(message) {
  warned += 1;
  logAction("⚠", message);
}

async function copyPath(source, destination, label) {
  const sourceExists = await exists(source);
  if (!sourceExists) {
    skipped += 1;
    logAction("-", `skip ${label}; source not found: ${source}`);
    return;
  }

  const destinationExists = await exists(destination);
  if (destinationExists && !options.overwrite) {
    skipped += 1;
    logAction("-", `skip ${label}; destination exists: ${destination}`);
    return;
  }

  planned.push({ source, destination, label });
  if (options.dryRun) {
    logAction("→", `would copy ${label}: ${source} -> ${destination}`);
    return;
  }

  await mkdir(resolve(destination, ".."), { recursive: true });
  await cp(source, destination, { recursive: true, force: options.overwrite, errorOnExist: !options.overwrite });
  copied += 1;
  logAction("✓", `copied ${label}: ${source} -> ${destination}`);
}

async function copySkills(sourceRoot, destinationRoot) {
  const sourceSkillsDir = resolve(sourceRoot, ".agents/skills");
  if (!(await isDirectory(sourceSkillsDir))) {
    skipped += 1;
    logAction("-", `skip skills; source not found: ${sourceSkillsDir}`);
    return;
  }

  await mkdir(resolve(destinationRoot, ".agents/skills"), { recursive: true });
  const entries = await readdir(sourceSkillsDir, { withFileTypes: true });
  const skillDirs = entries.filter((entry) => entry.isDirectory());
  if (skillDirs.length === 0) {
    skipped += 1;
    logAction("-", `skip skills; no skill directories found in ${sourceSkillsDir}`);
    return;
  }

  for (const entry of skillDirs) {
    const sourceSkill = resolve(sourceSkillsDir, entry.name);
    const destinationSkill = resolve(destinationRoot, ".agents/skills", entry.name);
    await copyPath(sourceSkill, destinationSkill, `skill ${entry.name}`);
  }

  const skillNames = skillDirs.map((entry) => entry.name);
  const demoSkills = skillNames.filter((name) => ["edge-tts", "hyperframes", "gpt-image-2"].includes(name));
  if (demoSkills.length > 0) {
    logAction("ℹ", `detected demo-capable skills: ${demoSkills.join(", ")}`);
  }
}

async function main() {
  if (options.help) {
    console.log(usage());
    return;
  }

  if (!options.source) {
    console.error(usage());
    process.exitCode = 2;
    return;
  }

  const sourceRoot = resolve(options.source);
  const destinationRoot = process.cwd();

  if (!(await isDirectory(sourceRoot))) {
    console.error(`Source path is not a directory: ${sourceRoot}`);
    process.exitCode = 2;
    return;
  }

  if (!(await exists(resolve(destinationRoot, "package.json"))) || !(await exists(resolve(destinationRoot, "src/server.mjs")))) {
    warn("current directory does not look like the pi-foundry template root; run this command from the pi-foundry project directory");
  }

  console.log(`Importing Pi agent assets from: ${sourceRoot}`);
  console.log(`Destination template root:      ${destinationRoot}`);
  if (options.dryRun) console.log("Mode: dry run");
  if (options.overwrite) console.log("Mode: overwrite existing destinations");
  console.log("");

  await copySkills(sourceRoot, destinationRoot);

  const singleFiles = [
    "mcp.config.json",
    "mcp.json",
    ".mcp.json",
  ];
  for (const file of singleFiles) {
    await copyPath(resolve(sourceRoot, file), resolve(destinationRoot, file), file);
  }

  const directories = [
    "prompts",
    "demo-workspace",
  ];
  for (const directory of directories) {
    await copyPath(resolve(sourceRoot, directory), resolve(destinationRoot, directory), `${directory}/`);
  }

  console.log("");
  console.log(`Import summary: ${options.dryRun ? planned.length : copied} copied/planned, ${skipped} skipped, ${warned} warned`);
  console.log("");
  console.log("Next steps:");
  console.log("  1. Review imported skills, prompts, MCP config, and demo workspace files.");
  console.log("  2. cp agent.config.example.yaml agent.config.yaml  # if you have not already done so");
  console.log("  3. Configure azd env values for PI_ARGS, PI_OPENAI_*, and artifacts.");
  console.log("  4. npm run doctor");
  console.log("  5. azd deploy --no-prompt");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
