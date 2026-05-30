#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

function usage() {
  console.error(`Usage: configure-env.mjs [options]\n\nSets pi-foundry azd environment values. Secrets must come from environment variables or a local azd .env file; secrets are never printed.\n\nOptions:\n  --env-name <name>                 Create/select azd environment if needed.\n  --from-env-file <path>             Copy whitelisted values from a dotenv file.\n  --agent-name <name>                Agent name; used as default ARTIFACT_BLOB_PREFIX.\n  --acr <registry.azurecr.io>\n  --foundry-project-endpoint <url>\n  --azure-ai-project-id <resource-id>\n  --azure-subscription-id <id>\n  --azure-tenant-id <id>\n  --azure-location <region>\n  --model <model>\n  --base-url <url>\n  --api-key-env <ENV_VAR_NAME>       Reads secret from process env; never pass the key as an arg.\n  --mock <0|1>\n  --timeout-ms <ms>\n  --artifact-mode <disabled|static-web>\n  --artifact-storage-account <name>\n  --artifact-static-web-endpoint <url>\n  --artifact-blob-prefix <prefix>    Defaults to --agent-name when static-web is enabled.\n`);
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    }
    if (!arg.startsWith("--")) throw new Error(`Unexpected argument: ${arg}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
    values[arg.slice(2)] = value;
    index += 1;
  }
  return values;
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: options.quiet ? ["ignore", "pipe", "pipe"] : "inherit",
    timeout: 120000,
    env: process.env,
  })?.trim();
}

function tryRun(command, args) {
  try {
    return run(command, args, { quiet: true });
  } catch {
    return undefined;
  }
}

function parseDotenv(path) {
  const values = {};
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const index = line.indexOf("=");
    const key = line.slice(0, index);
    let value = line.slice(index + 1);
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[key] = value;
  }
  return values;
}

function isSecretName(name) {
  return /(KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)/i.test(name);
}

function azdSet(name, value, { secret = false } = {}) {
  if (value === undefined || value === "") return;
  // Use KEY=value form so values that begin with "--" (for example PI_ARGS)
  // or contain shell-sensitive characters (for example $web) are passed to azd
  // as values instead of being parsed as flags.
  run("azd", ["env", "set", `${name}=${String(value)}`]);
  console.log(`configured ${name}${secret || isSecretName(name) ? "=<redacted>" : ""}`);
}

function prefer(...values) {
  return values.find((value) => value !== undefined && value !== "");
}

const args = parseArgs(process.argv.slice(2));
const fileValues = args["from-env-file"] ? parseDotenv(args["from-env-file"]) : {};

if (args["env-name"]) {
  if (tryRun("azd", ["env", "select", args["env-name"]]) === undefined) {
    run("azd", ["env", "new", args["env-name"]]);
  }
}

azdSet("AZURE_SUBSCRIPTION_ID", prefer(args["azure-subscription-id"], fileValues.AZURE_SUBSCRIPTION_ID));
azdSet("AZURE_TENANT_ID", prefer(args["azure-tenant-id"], fileValues.AZURE_TENANT_ID));
azdSet("AZURE_LOCATION", prefer(args["azure-location"], fileValues.AZURE_LOCATION));
azdSet("FOUNDRY_PROJECT_ENDPOINT", prefer(args["foundry-project-endpoint"], fileValues.FOUNDRY_PROJECT_ENDPOINT));
azdSet("AZURE_AI_PROJECT_ID", prefer(args["azure-ai-project-id"], fileValues.AZURE_AI_PROJECT_ID));
azdSet("AZURE_CONTAINER_REGISTRY_ENDPOINT", prefer(args.acr, fileValues.AZURE_CONTAINER_REGISTRY_ENDPOINT));

azdSet("PI_MOCK", prefer(args.mock, fileValues.PI_MOCK, "0"));
azdSet("REQUEST_TIMEOUT_MS", prefer(args["timeout-ms"], fileValues.REQUEST_TIMEOUT_MS, "600000"));
azdSet("ENABLE_DIAGNOSTICS", prefer(fileValues.ENABLE_DIAGNOSTICS, "0"));

const model = prefer(args.model, fileValues.PI_OPENAI_MODEL);
if (model) {
  azdSet("PI_OPENAI_MODEL", model);
  azdSet("PI_ARGS", prefer(fileValues.PI_ARGS, `--mode rpc --no-session --provider foundry --model ${model}`));
}
azdSet("PI_OPENAI_BASE_URL", prefer(args["base-url"], fileValues.PI_OPENAI_BASE_URL));

if (args["api-key-env"]) {
  const secret = process.env[args["api-key-env"]];
  if (!secret) throw new Error(`Environment variable ${args["api-key-env"]} is not set`);
  azdSet("PI_OPENAI_API_KEY", secret, { secret: true });
} else {
  azdSet("PI_OPENAI_API_KEY", fileValues.PI_OPENAI_API_KEY, { secret: true });
}

const artifactMode = prefer(args["artifact-mode"], fileValues.ARTIFACT_PUBLISH_MODE);
azdSet("ARTIFACT_PUBLISH_MODE", artifactMode);
azdSet("ARTIFACT_STORAGE_ACCOUNT", prefer(args["artifact-storage-account"], fileValues.ARTIFACT_STORAGE_ACCOUNT));
azdSet("ARTIFACT_STATIC_WEB_ENDPOINT", prefer(args["artifact-static-web-endpoint"], fileValues.ARTIFACT_STATIC_WEB_ENDPOINT));
azdSet("ARTIFACT_STATIC_WEB_CONTAINER", artifactMode === "static-web" ? "$web" : undefined);

// Do not blindly copy ARTIFACT_BLOB_PREFIX from another environment; that would
// publish this agent's artifacts under the source agent's prefix. Default to the
// current agent name for skill-managed UX, while still allowing explicit override.
azdSet("ARTIFACT_BLOB_PREFIX", prefer(args["artifact-blob-prefix"], args["agent-name"]));

console.log("azd env configuration complete");
