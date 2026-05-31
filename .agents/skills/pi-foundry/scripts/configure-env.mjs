#!/usr/bin/env node
// configure-env.mjs — set azd env values for a pi-foundry deployment.
//
// Never prints secret values. Reads secrets only from process env or a dotenv file;
// never accepts secrets as command-line args. Knows the env contract from
// references/contract.json so additions to the contract automatically propagate.
//
// Usage:
//   configure-env.mjs --agent-name <name> [options]
//
// Options:
//   --env-name <name>                        Create/select azd env if needed.
//   --from-env-file <path>                   Whitelisted copy from a dotenv file (no AGENT_*, no source ARTIFACT_BLOB_PREFIX).
//   --agent-name <name>                      (required) Used as default ARTIFACT_BLOB_PREFIX.
//   --acr <registry.azurecr.io>
//   --foundry-project-endpoint <url>
//   --azure-ai-project-id <resource-id>
//   --azure-subscription-id <id>
//   --azure-tenant-id <id>
//   --azure-location <region>
//   --model <model>                          Sets PI_OPENAI_MODEL and reconstructs PI_ARGS.
//   --base-url <url>                         Sets PI_OPENAI_BASE_URL.
//   --api-key-env <ENV_VAR_NAME>             Reads PI_OPENAI_API_KEY from process env (never via flag).
//   --mock <0|1>                             Default 0.
//   --timeout-ms <ms>                        Default 600000.
//   --artifact-mode <disabled|static-web>
//   --artifact-storage-account <name>
//   --artifact-static-web-endpoint <url>
//   --artifact-blob-prefix <prefix>          Defaults to --agent-name when --artifact-mode=static-web.

import { installCrashHandlers, loadContract, parseArgs, parseDotenv, run, tryRun, isSecretName } from "./_lib.mjs";
import { readFileSync } from "node:fs";

installCrashHandlers();

const args = parseArgs(process.argv.slice(2));

if (args.help || !args["agent-name"]) {
  console.error(`Usage: configure-env.mjs --agent-name <name> [options]
See script header for the option list.`);
  process.exit(args.help ? 0 : 2);
}

const contract = await loadContract();
const fileValues = args["from-env-file"] ? parseDotenv(readFileSync(args["from-env-file"], "utf8")) : {};

if (args["env-name"]) {
  if (tryRun("azd", ["env", "select", args["env-name"]]) === undefined) {
    run("azd", ["env", "new", args["env-name"]]);
  }
}

// Validate --from-env-file does not carry over reserved or source-agent state.
if (args["from-env-file"]) {
  const blocked = Object.keys(fileValues).filter((name) =>
    contract.env.reservedPrefixes.some((prefix) => name.startsWith(prefix)) &&
    !contract.env.reservedAllowedExceptions.includes(name),
  );
  for (const name of blocked) {
    console.log(`skipping reserved variable from env file: ${name}`);
    delete fileValues[name];
  }
  if (fileValues.ARTIFACT_BLOB_PREFIX) {
    console.log(`overriding source ARTIFACT_BLOB_PREFIX=${fileValues.ARTIFACT_BLOB_PREFIX} -> ${args["agent-name"]}`);
    delete fileValues.ARTIFACT_BLOB_PREFIX;
  }
}

// azd-required infra values
azdSet("AZURE_SUBSCRIPTION_ID", prefer(args["azure-subscription-id"], fileValues.AZURE_SUBSCRIPTION_ID));
azdSet("AZURE_TENANT_ID", prefer(args["azure-tenant-id"], fileValues.AZURE_TENANT_ID));
azdSet("AZURE_LOCATION", prefer(args["azure-location"], fileValues.AZURE_LOCATION));
azdSet("FOUNDRY_PROJECT_ENDPOINT", prefer(args["foundry-project-endpoint"], fileValues.FOUNDRY_PROJECT_ENDPOINT));
azdSet("AZURE_AI_PROJECT_ID", prefer(args["azure-ai-project-id"], fileValues.AZURE_AI_PROJECT_ID));
azdSet("AZURE_CONTAINER_REGISTRY_ENDPOINT", prefer(args.acr, fileValues.AZURE_CONTAINER_REGISTRY_ENDPOINT));

// Runtime base
azdSet("PI_MOCK", prefer(args.mock, fileValues.PI_MOCK, "0"));
azdSet("REQUEST_TIMEOUT_MS", prefer(args["timeout-ms"], fileValues.REQUEST_TIMEOUT_MS, "600000"));
azdSet("ENABLE_DIAGNOSTICS", prefer(fileValues.ENABLE_DIAGNOSTICS, "0"));

// Model
const model = prefer(args.model, fileValues.PI_OPENAI_MODEL);
if (model) {
  azdSet("PI_OPENAI_MODEL", model);
  azdSet("PI_ARGS", prefer(fileValues.PI_ARGS, `--mode rpc --no-session --provider foundry --model ${model}`));
}
azdSet("PI_OPENAI_BASE_URL", prefer(args["base-url"], fileValues.PI_OPENAI_BASE_URL));

if (args["api-key-env"]) {
  const secret = process.env[args["api-key-env"]];
  if (!secret) throw new Error(`Environment variable ${args["api-key-env"]} is not set`);
  azdSet("PI_OPENAI_API_KEY", secret);
} else if (fileValues.PI_OPENAI_API_KEY) {
  azdSet("PI_OPENAI_API_KEY", fileValues.PI_OPENAI_API_KEY);
}

// Artifacts
const artifactMode = prefer(args["artifact-mode"], fileValues.ARTIFACT_PUBLISH_MODE);
if (artifactMode) {
  azdSet("ARTIFACT_PUBLISH_MODE", artifactMode);
  azdSet("ARTIFACT_STORAGE_ACCOUNT", prefer(args["artifact-storage-account"], fileValues.ARTIFACT_STORAGE_ACCOUNT));
  azdSet("ARTIFACT_STATIC_WEB_ENDPOINT", prefer(args["artifact-static-web-endpoint"], fileValues.ARTIFACT_STATIC_WEB_ENDPOINT));
  if (artifactMode === "static-web") {
    azdSet("ARTIFACT_STATIC_WEB_CONTAINER", "$web");
    azdSet("ARTIFACT_BLOB_PREFIX", prefer(args["artifact-blob-prefix"], args["agent-name"]));
  }
}

console.log("");
console.log("azd env configuration complete.");

// ---------------------------------------------------------------------------

function prefer(...values) {
  return values.find((value) => value !== undefined && value !== "");
}

function azdSet(name, value) {
  if (value === undefined || value === "") return;
  // KEY=value form prevents azd from parsing values that begin with -- (e.g. PI_ARGS)
  // or contain shell-sensitive characters (e.g. $web).
  run("azd", ["env", "set", `${name}=${String(value)}`], { quiet: true });
  console.log(`set ${name}${isSecretName(name) ? "=<redacted>" : `=${value}`}`);
}
