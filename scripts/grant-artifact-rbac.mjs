#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const STORAGE_BLOB_DATA_CONTRIBUTOR_ROLE_ID = "ba92f5b4-2d11-453d-a403-e96b0029c9fe";

const args = parseArgs(process.argv.slice(2));

function usage() {
  return `Usage:
  npm run grant:artifact-rbac -- <agent-name> <storage-account> [--dry-run]

Environment fallback:
  AGENT_NAME=<agent-name> ARTIFACT_STORAGE_ACCOUNT=<storage-account> npm run grant:artifact-rbac

What it does:
  1. Reads the deployed Hosted Agent identities with azd ai agent show.
  2. Resolves the Azure Storage account resource id.
  3. Grants Storage Blob Data Contributor to the agent instance and blueprint identities.

Requires:
  - azd authenticated with permission to create role assignments
  - AZURE_SUBSCRIPTION_ID in azd env
  - AZURE_TENANT_ID in azd env or environment`;
}

function parseArgs(argv) {
  const result = {
    agentName: process.env.AGENT_NAME,
    storageAccount: process.env.ARTIFACT_STORAGE_ACCOUNT,
    dryRun: false,
    help: false,
  };

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") result.help = true;
    else if (arg === "--dry-run") result.dryRun = true;
    else if (!result.agentName) result.agentName = arg;
    else if (!result.storageAccount) result.storageAccount = arg;
    else throw new Error(`Unexpected argument: ${arg}`);
  }

  return result;
}

function command(commandName, commandArgs, options = {}) {
  try {
    return execFileSync(commandName, commandArgs, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: options.timeout ?? 120000,
      env: process.env,
    }).trim();
  } catch (error) {
    const stderr = typeof error.stderr === "string" ? error.stderr.trim() : "";
    const stdout = typeof error.stdout === "string" ? error.stdout.trim() : "";
    throw new Error(`${commandName} ${commandArgs.join(" ")} failed${stderr ? `: ${stderr}` : stdout ? `: ${stdout}` : ""}`);
  }
}

function parseAzdEnvValues(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}

function parseToken(raw) {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) return trimmed;
  const json = JSON.parse(trimmed);
  return json.token ?? json.accessToken;
}

async function armFetch(token, url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  if (!response.ok) {
    const message = body?.error?.message ?? body?.message ?? text ?? response.statusText;
    const code = body?.error?.code ? `${body.error.code}: ` : "";
    throw new Error(`ARM ${response.status} ${response.statusText}: ${code}${message}`);
  }
  return body;
}

function roleAssignmentGuid(scope, roleDefinitionId, principalId) {
  const hash = createHash("sha256").update(`${scope}|${roleDefinitionId}|${principalId}`).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function collectAgentPrincipals(agent) {
  const principals = [];
  if (agent.instance_identity?.principal_id) {
    principals.push({ label: "instance_identity", principalId: agent.instance_identity.principal_id });
  }
  if (agent.blueprint?.principal_id) {
    principals.push({ label: "blueprint", principalId: agent.blueprint.principal_id });
  }
  const seen = new Set();
  return principals.filter((entry) => {
    if (seen.has(entry.principalId)) return false;
    seen.add(entry.principalId);
    return true;
  });
}

async function findStorageAccountResourceId({ token, subscriptionId, storageAccount }) {
  const filter = encodeURIComponent("resourceType eq 'Microsoft.Storage/storageAccounts'");
  const url = `https://management.azure.com/subscriptions/${subscriptionId}/resources?api-version=2021-04-01&$filter=${filter}`;
  const resources = await armFetch(token, url);
  const match = resources.value?.find((resource) => resource.name === storageAccount);
  if (!match?.id) throw new Error(`Storage account not found in subscription ${subscriptionId}: ${storageAccount}`);
  return match.id;
}

async function grantRole({ token, scope, principalId, label, dryRun }) {
  const roleDefinitionId = `${scope}/providers/Microsoft.Authorization/roleDefinitions/${STORAGE_BLOB_DATA_CONTRIBUTOR_ROLE_ID}`;
  const assignmentId = roleAssignmentGuid(scope, roleDefinitionId, principalId);
  const url = `https://management.azure.com${scope}/providers/Microsoft.Authorization/roleAssignments/${assignmentId}?api-version=2022-04-01`;
  const body = {
    properties: {
      roleDefinitionId,
      principalId,
      principalType: "ServicePrincipal",
    },
  };

  if (dryRun) {
    console.log(`→ would grant Storage Blob Data Contributor to ${label} (${principalId})`);
    console.log(`  scope: ${scope}`);
    return;
  }

  try {
    const result = await armFetch(token, url, {
      method: "PUT",
      body: JSON.stringify(body),
    });
    console.log(`✓ granted Storage Blob Data Contributor to ${label} (${principalId})`);
    console.log(`  assignment: ${result.id ?? assignmentId}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("RoleAssignmentExists")) {
      console.log(`✓ Storage Blob Data Contributor already exists for ${label} (${principalId})`);
      return;
    }
    throw error;
  }
}

async function main() {
  if (args.help) {
    console.log(usage());
    return;
  }
  if (!args.agentName || !args.storageAccount) {
    console.error(usage());
    process.exitCode = 2;
    return;
  }

  const azdEnv = parseAzdEnvValues(command("azd", ["env", "get-values"]));
  const subscriptionId = azdEnv.AZURE_SUBSCRIPTION_ID ?? process.env.AZURE_SUBSCRIPTION_ID;
  const tenantId = azdEnv.AZURE_TENANT_ID ?? process.env.AZURE_TENANT_ID;
  if (!subscriptionId) throw new Error("AZURE_SUBSCRIPTION_ID is required in azd env or environment");
  if (!tenantId) throw new Error("AZURE_TENANT_ID is required in azd env or environment");

  console.log(`Agent:          ${args.agentName}`);
  console.log(`Storage:        ${args.storageAccount}`);
  console.log(`Subscription:   ${subscriptionId}`);
  console.log(`Tenant:         ${tenantId}`);
  if (args.dryRun) console.log("Mode:           dry run");
  console.log("");

  const agent = JSON.parse(command("azd", ["ai", "agent", "show", args.agentName, "--output", "json", "--no-prompt"]));
  const principals = collectAgentPrincipals(agent);
  if (principals.length === 0) throw new Error(`No managed identities found for deployed agent: ${args.agentName}`);

  console.log("Found agent identities:");
  for (const principal of principals) console.log(`- ${principal.label}: ${principal.principalId}`);
  console.log("");

  const token = parseToken(command("azd", ["auth", "token", "--scope", "https://management.azure.com/.default", "--tenant-id", tenantId]));
  const scope = await findStorageAccountResourceId({ token, subscriptionId, storageAccount: args.storageAccount });
  console.log(`Storage scope:  ${scope}`);
  console.log("");

  for (const principal of principals) {
    await grantRole({ token, scope, principalId: principal.principalId, label: principal.label, dryRun: args.dryRun });
  }

  console.log("");
  console.log("Done. RBAC propagation can take a minute. Retry artifact publishing after propagation if it still fails immediately.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
