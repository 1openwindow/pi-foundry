#!/usr/bin/env node
// grant-artifact-rbac.mjs — grant Storage Blob Data Contributor to the deployed Hosted Agent
// identities on the artifact storage account. Idempotent; safe to re-run after deploys.
//
// Usage:
//   grant-artifact-rbac.mjs [<agent-name> [<storage-account>]] [--dry-run]
//
// Defaults: --agent-name from azd env AGENT_*_NAME outputs (or by matching agent.yaml),
//           --storage-account from azd env ARTIFACT_STORAGE_ACCOUNT.
//
// Requires:
//   - azd authenticated with permission to create role assignments
//   - AZURE_SUBSCRIPTION_ID and AZURE_TENANT_ID in azd env

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { azdEnvValues, commandResult, installCrashHandlers, parseArgs, run } from "./_lib.mjs";

installCrashHandlers();

const STORAGE_BLOB_DATA_CONTRIBUTOR_ROLE_ID = "ba92f5b4-2d11-453d-a403-e96b0029c9fe";

const args = parseArgs(process.argv.slice(2), { flags: ["dry-run"] });
if (args.help) {
  console.error("Usage: grant-artifact-rbac.mjs [<agent-name> [<storage-account>]] [--dry-run]");
  process.exit(0);
}

const env = azdEnvValues();
const expectedAgentName = readAgentNameFromYaml();
const outputs = findAgentOutputs(env, expectedAgentName);

const agentName = args._[0] ?? outputs.name ?? expectedAgentName;
const storageAccount = args._[1] ?? env.ARTIFACT_STORAGE_ACCOUNT;
const subscriptionId = env.AZURE_SUBSCRIPTION_ID ?? process.env.AZURE_SUBSCRIPTION_ID;
const tenantId = env.AZURE_TENANT_ID ?? process.env.AZURE_TENANT_ID;

if (!agentName) throw new Error("agent name not provided and no AGENT_*_NAME output found in azd env");
if (!storageAccount) throw new Error("storage account not provided and ARTIFACT_STORAGE_ACCOUNT not set in azd env");
if (!subscriptionId) throw new Error("AZURE_SUBSCRIPTION_ID is required in azd env");
if (!tenantId) throw new Error("AZURE_TENANT_ID is required in azd env");

console.log(`Agent:        ${agentName}`);
console.log(`Storage:      ${storageAccount}`);
console.log(`Subscription: ${subscriptionId}`);
if (args["dry-run"]) console.log("Mode:         dry-run");
console.log("");

const show = commandResult("azd", ["ai", "agent", "show", agentName, "--output", "json", "--no-prompt"]);
if (!show.ok) throw new Error(`failed to read agent: ${show.stderr || show.stdout || "azd ai agent show failed"}`);
const agent = JSON.parse(show.stdout);
const principals = collectAgentPrincipals(agent);
if (principals.length === 0) throw new Error(`no managed identities found for deployed agent: ${agentName}`);

console.log("Identities:");
for (const principal of principals) console.log(`- ${principal.label}: ${principal.principalId}`);
console.log("");

const token = parseToken(run("azd", ["auth", "token", "--scope", "https://management.azure.com/.default", "--tenant-id", tenantId], { stdio: ["ignore", "pipe", "pipe"] }));
const scope = await findStorageAccountResourceId({ token, subscriptionId, storageAccount });
console.log(`Storage scope: ${scope}`);
console.log("");

for (const principal of principals) {
  await grantRole({ token, scope, principalId: principal.principalId, label: principal.label, dryRun: args["dry-run"] });
}

console.log("");
console.log("Done. RBAC propagation can take ~1 min; retry artifact publishing if it still 403s immediately.");

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
  return { name: nameEntry[1], version: values[`${prefix}_VERSION`], endpoint: values[`${prefix}_INVOCATIONS_ENDPOINT`] };
}

function collectAgentPrincipals(agent) {
  const principals = [];
  if (agent.instance_identity?.principal_id) principals.push({ label: "instance_identity", principalId: agent.instance_identity.principal_id });
  if (agent.blueprint?.principal_id) principals.push({ label: "blueprint", principalId: agent.blueprint.principal_id });
  const seen = new Set();
  return principals.filter((entry) => seen.has(entry.principalId) ? false : (seen.add(entry.principalId), true));
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
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(options.headers ?? {}) },
  });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : undefined; } catch { body = text; }
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

  if (dryRun) {
    console.log(`→ would grant Storage Blob Data Contributor to ${label} (${principalId})`);
    return;
  }
  try {
    await armFetch(token, url, {
      method: "PUT",
      body: JSON.stringify({ properties: { roleDefinitionId, principalId, principalType: "ServicePrincipal" } }),
    });
    console.log(`✓ granted Storage Blob Data Contributor to ${label} (${principalId})`);
  } catch (error) {
    if (String(error.message).includes("RoleAssignmentExists")) {
      console.log(`✓ already granted to ${label} (${principalId})`);
      return;
    }
    throw error;
  }
}
