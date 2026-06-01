#!/usr/bin/env node
// Keyless model auth helper for pi's `!command` apiKey resolution.
//
// pi resolves a models.json apiKey of the form "!<cmd>" by running <cmd> and using its
// trimmed stdout as the bearer token (cached for that pi process lifetime only). Because
// pi-rpc.mjs spawns a fresh pi process per invocation, this mints a fresh AAD token per
// invocation via DefaultAzureCredential (Managed Identity in Foundry, az login locally).
//
// Contract: print ONLY the raw token to stdout. Diagnostics go to stderr. Exit non-zero on
// failure so pi surfaces a clear "failed to resolve apiKey from shell command" error.
import { DefaultAzureCredential } from "@azure/identity";

const scope = process.env.FOUNDRY_TOKEN_SCOPE || "https://cognitiveservices.azure.com/.default";

try {
  const credential = new DefaultAzureCredential({
    managedIdentityClientId: process.env.AZURE_CLIENT_ID || undefined,
  });
  const token = await credential.getToken(scope);
  if (!token?.token) throw new Error("DefaultAzureCredential returned an empty token");
  process.stdout.write(token.token);
} catch (error) {
  process.stderr.write(`foundry-token: failed to acquire token for scope ${scope}: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
