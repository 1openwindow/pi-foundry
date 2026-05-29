#!/usr/bin/env node
import { execFileSync } from "node:child_process";

const args = parseArgs(process.argv.slice(2));

function usage() {
  return `Usage:
  npm run copy:azd-env -- --from <working-repo> --env <new-env-name> [--artifact-prefix <prefix>] [--subscription <id>] [--location <region>] [--dry-run]

Copies common pi-foundry azd environment values from a known-good repo into the current wrapper project.

Example:
  npm run copy:azd-env -- --from ~/repos/pi-foundry --env my-pi-agent --artifact-prefix my-pi-agent`;
}

function parseArgs(argv) {
  const result = { from: undefined, env: undefined, artifactPrefix: undefined, subscription: undefined, location: undefined, dryRun: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (!value) throw new Error(`Missing value for ${arg}`);
      return value;
    };
    if (arg === "--help" || arg === "-h") result.help = true;
    else if (arg === "--from") result.from = next();
    else if (arg.startsWith("--from=")) result.from = arg.slice("--from=".length);
    else if (arg === "--env") result.env = next();
    else if (arg.startsWith("--env=")) result.env = arg.slice("--env=".length);
    else if (arg === "--artifact-prefix") result.artifactPrefix = next();
    else if (arg.startsWith("--artifact-prefix=")) result.artifactPrefix = arg.slice("--artifact-prefix=".length);
    else if (arg === "--subscription") result.subscription = next();
    else if (arg.startsWith("--subscription=")) result.subscription = arg.slice("--subscription=".length);
    else if (arg === "--location") result.location = next();
    else if (arg.startsWith("--location=")) result.location = arg.slice("--location=".length);
    else if (arg === "--dry-run") result.dryRun = true;
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

function command(commandName, commandArgs, options = {}) {
  if (options.log !== false) console.log(`$ ${[commandName, ...commandArgs].join(" ")}`);
  if (args.dryRun && options.mutate) return "";
  return execFileSync(commandName, commandArgs, {
    cwd: options.cwd,
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

function requireValue(values, name) {
  const value = values[name];
  if (!value) throw new Error(`Source azd env is missing required value: ${name}`);
  return value;
}

function redactEnvValue(name, value) {
  if (/KEY|TOKEN|SECRET|PASSWORD/i.test(name)) return "<redacted>";
  return value;
}

function azdSet(name, value) {
  console.log(`$ azd env set ${name} ${redactEnvValue(name, value)}`);
  if (args.dryRun) return;
  execFileSync("azd", ["env", "set", name, value], {
    encoding: "utf8",
    stdio: "inherit",
    env: process.env,
  });
}

async function main() {
  if (args.help) {
    console.log(usage());
    return;
  }
  if (!args.from) throw new Error("--from is required\n\n" + usage());
  if (!args.env) throw new Error("--env is required\n\n" + usage());

  const from = expandHome(args.from);
  const sourceText = command("azd", ["env", "get-values"], { cwd: from, capture: true, log: false });
  const source = parseAzdEnvValues(sourceText);
  const subscription = args.subscription ?? requireValue(source, "AZURE_SUBSCRIPTION_ID");
  const location = args.location ?? requireValue(source, "AZURE_LOCATION");
  const artifactPrefix = args.artifactPrefix ?? args.env;

  console.log(`${args.dryRun ? "Would copy" : "Copying"} azd env`);
  console.log(`From:      ${from}`);
  console.log(`Env:       ${args.env}`);
  console.log(`Location:  ${location}`);
  console.log(`Prefix:    ${artifactPrefix}`);
  console.log("");

  command("azd", ["env", "new", args.env, "--subscription", subscription, "--location", location, "--no-prompt"], { mutate: true });

  const copyNames = [
    "AZURE_TENANT_ID",
    "FOUNDRY_PROJECT_ENDPOINT",
    "AZURE_AI_PROJECT_ID",
    "AZURE_CONTAINER_REGISTRY_ENDPOINT",
    "PI_OPENAI_BASE_URL",
    "PI_OPENAI_MODEL",
    "PI_OPENAI_API_KEY",
    "ARTIFACT_STORAGE_ACCOUNT",
    "ARTIFACT_STATIC_WEB_ENDPOINT",
    "ARTIFACT_STATIC_WEB_CONTAINER",
  ];

  for (const name of copyNames) {
    if (source[name]) azdSet(name, source[name]);
  }

  const model = source.PI_OPENAI_MODEL ?? "<foundry-model-or-deployment>";
  azdSet("PI_MOCK", "0");
  azdSet("REQUEST_TIMEOUT_MS", "600000");
  azdSet("ENABLE_DIAGNOSTICS", "0");
  azdSet("PI_ARGS", `--mode rpc --no-session --provider foundry --model ${model}`);
  azdSet("ARTIFACT_PUBLISH_MODE", source.ARTIFACT_PUBLISH_MODE ?? "static-web");
  azdSet("ARTIFACT_BLOB_PREFIX", artifactPrefix);

  console.log("");
  console.log("azd env copied. Next steps:");
  console.log("  npm run doctor");
  console.log("  npm run deploy:foundry");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
