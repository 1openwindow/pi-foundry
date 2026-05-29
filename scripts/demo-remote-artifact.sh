#!/usr/bin/env bash
set -euo pipefail

AGENT_NAME="${AGENT_NAME:-${1:-}}"
AGENT_VERSION="${AGENT_VERSION:-${2:-}}"
TIMEOUT="${TIMEOUT:-900}"

if [[ -z "$AGENT_NAME" ]]; then
  echo "AGENT_NAME is required" >&2
  echo "Usage: AGENT_NAME=<name> AGENT_VERSION=<version> npm run demo:remote:artifact" >&2
  echo "   or: npm run demo:remote:artifact -- <name> <version>" >&2
  exit 2
fi

version_args=()
if [[ -n "$AGENT_VERSION" ]]; then
  version_args=(--version "$AGENT_VERSION")
fi

prompt="Create a small downloadable static HTML artifact named index.html for a media report demo. The page should include the title 'Media Report Agent on Foundry' and mention edge-tts and hyperframes. Save it under the artifact directory you were instructed to use. Write artifact-manifest.json listing index.html and script.md. Reply concisely."

azd ai agent invoke "$AGENT_NAME" \
  --protocol invocations \
  "${version_args[@]}" \
  --new-session \
  --timeout "$TIMEOUT" \
  "$prompt"
