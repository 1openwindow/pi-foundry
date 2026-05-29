#!/usr/bin/env node
import { constants } from "node:fs";
import { access, cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const args = parseArgs(process.argv.slice(2));

function usage() {
  return `Usage:
  npm run create:wrapper -- --name <agent-name> --target <path> [--from <existing-pi-agent>] [--mode node-direct|official] [--acr <registry>] [--dry-run] [--overwrite]

Example:
  npm run create:wrapper -- \
    --name my-pi-agent \
    --target ~/repos/my-pi-agent \
    --from ~/repos/media-report-agent \
    --mode official \
    --acr crce6hg4ngzj3as.azurecr.io

What it does:
  1. Copies this template to --target.
  2. Removes template-local .git/.azure/.files/node_modules.
  3. Initializes a new git repo.
  4. Creates agent.config.yaml.
  5. Runs configure:agent.
  6. Imports existing Pi agent assets, if --from is provided.
  7. Switches to official mode, if --mode official.
  8. Runs npm install --package-lock-only and npm run validate.`;
}

function parseArgs(argv) {
  const result = {
    name: undefined,
    target: undefined,
    from: undefined,
    mode: "node-direct",
    acr: undefined,
    dryRun: false,
    overwrite: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (!value) throw new Error(`Missing value for ${arg}`);
      return value;
    };
    if (arg === "--help" || arg === "-h") result.help = true;
    else if (arg === "--name") result.name = next();
    else if (arg.startsWith("--name=")) result.name = arg.slice("--name=".length);
    else if (arg === "--target") result.target = next();
    else if (arg.startsWith("--target=")) result.target = arg.slice("--target=".length);
    else if (arg === "--from") result.from = next();
    else if (arg.startsWith("--from=")) result.from = arg.slice("--from=".length);
    else if (arg === "--mode") result.mode = next();
    else if (arg.startsWith("--mode=")) result.mode = arg.slice("--mode=".length);
    else if (arg === "--acr") result.acr = next();
    else if (arg.startsWith("--acr=")) result.acr = arg.slice("--acr=".length);
    else if (arg === "--dry-run") result.dryRun = true;
    else if (arg === "--overwrite") result.overwrite = true;
    else throw new Error(`Unexpected argument: ${arg}`);
  }

  return result;
}

function expandHome(path) {
  if (!path) return path;
  if (path === "~") return process.env.HOME;
  if (path.startsWith("~/")) return `${process.env.HOME}${path.slice(1)}`;
  return path;
}

function validateAgentName(name) {
  if (!name) throw new Error("--name is required\n\n" + usage());
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name)) {
    throw new Error("agent name must be 1-128 characters, start with a letter/number, and contain only letters, numbers, dots, underscores, or hyphens");
  }
}

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function run(command, commandArgs, options = {}) {
  console.log(`$ ${[command, ...commandArgs].join(" ")}`);
  if (args.dryRun) return "";
  return execFileSync(command, commandArgs, {
    cwd: options.cwd,
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: "utf8",
    env: process.env,
  });
}

async function removeLocalState(target) {
  for (const name of [".git", ".azure", ".files", "node_modules"]) {
    await rm(resolve(target, name), { recursive: true, force: true });
  }
}

async function switchOfficialMode(target) {
  const dockerOfficial = resolve(target, "Dockerfile.official");
  if (!(await exists(dockerOfficial))) throw new Error("Dockerfile.official not found; cannot switch to official mode");
  await cp(dockerOfficial, resolve(target, "Dockerfile"), { force: true });

  const azurePath = resolve(target, "azure.yaml");
  const fs = await import("node:fs/promises");
  let azure = await fs.readFile(azurePath, "utf8");
  azure = azure.replace(/startupCommand:\s*node src\/server\.mjs/, "startupCommand: runtime/official-invocations/entrypoint.sh");
  await fs.writeFile(azurePath, azure, "utf8");
}

async function main() {
  if (args.help) {
    console.log(usage());
    return;
  }
  validateAgentName(args.name);
  if (!args.target) throw new Error("--target is required\n\n" + usage());
  if (!["node-direct", "official"].includes(args.mode)) throw new Error("--mode must be node-direct or official");

  const source = process.cwd();
  const target = resolve(expandHome(args.target));
  const from = args.from ? resolve(expandHome(args.from)) : undefined;

  if (!(await exists(resolve(source, "package.json"))) || !(await exists(resolve(source, "src/server.mjs")))) {
    throw new Error("Run create:wrapper from the pi-foundry template root");
  }
  if ((await exists(target)) && !args.overwrite) {
    throw new Error(`Target already exists: ${target}\nUse --overwrite to replace it.`);
  }

  console.log(`${args.dryRun ? "Would create" : "Creating"} wrapper project`);
  console.log(`Template: ${source}`);
  console.log(`Target:   ${target}`);
  console.log(`Name:     ${args.name}`);
  console.log(`Mode:     ${args.mode}`);
  if (from) console.log(`Import:   ${from}`);
  if (args.acr) console.log(`ACR:      ${args.acr}`);
  console.log("");

  if (args.dryRun) {
    console.log("Dry run only; no files written.");
    return;
  }

  if (args.overwrite) await rm(target, { recursive: true, force: true });
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target, {
    recursive: true,
    filter: (src) => {
      const rel = src.slice(source.length).replace(/^\/+/, "");
      return ![".git", ".azure", ".files", "node_modules"].some((prefix) => rel === prefix || rel.startsWith(`${prefix}/`));
    },
  });
  await removeLocalState(target);
  await cp(resolve(target, "agent.config.example.yaml"), resolve(target, "agent.config.yaml"), { force: true });

  run("git", ["init"], { cwd: target });
  const configureArgs = ["run", "configure:agent", "--", args.name];
  if (args.acr) configureArgs.push(`--acr=${args.acr}`);
  run("npm", configureArgs, { cwd: target });

  if (from) run("npm", ["run", "import:pi-agent", "--", from], { cwd: target });
  if (args.mode === "official") await switchOfficialMode(target);

  run("npm", ["install", "--package-lock-only"], { cwd: target });
  run("npm", ["run", "validate"], { cwd: target });

  await writeFile(resolve(target, ".wrapper-created-from"), `${source}\n`, "utf8");

  console.log("");
  console.log("Wrapper created successfully.");
  console.log("Next steps:");
  console.log(`  cd ${target}`);
  console.log("  npm run copy:azd-env -- --from <working-repo> --env <agent-name>");
  console.log("  npm run deploy:foundry");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
