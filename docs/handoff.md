# pi-foundry handoff

Last updated: 2026-05-29

## Summary

`pi-foundry` is now a **Bring Your Own Pi Agent to Foundry** template/runtime.

The recommended direction is:

```text
Official Invocations mode for Foundry deployment
Node direct mode for local development, backend validation, and fallback
```

## Current repos

| Repo | Remote | Status |
|---|---|---|
| `~/repos/pi-foundry` | `https://github.com/1openwindow/pi-foundry` | Main template/runtime, private, clean/pushed. |
| `~/repos/media-report-agent` | `https://github.com/1openwindow/media-report-agent` | Example existing Pi agent, private, clean/pushed. |
| `~/repos/media-report-foundry` | `https://github.com/1openwindow/media-report-foundry` | Imported wrapper example, private, clean/pushed. |
| `~/repos/pi-foundry-official-invocations` | `https://github.com/1openwindow/pi-foundry-official-invocations` | Official Invocations deployment reference, private, clean/pushed. |

## Known-good deployed agents

### `media-report-foundry`

```text
Version: 1
Protocol: invocations
Purpose: Demonstrates importing an existing Pi agent with edge-tts/hyperframes into the template.
```

Known-good commands:

```bash
cd ~/repos/media-report-foundry
azd ai agent invoke media-report-foundry \
  --protocol invocations \
  --version 1 \
  --new-session \
  --timeout 600 \
  'Say exactly: ok'

npm run demo:remote:artifact -- media-report-foundry 1
```

### `pi-foundry-official-invocations`

```text
Version: 3
Protocol: invocations
Purpose: Demonstrates official azure-ai-agentserver-invocations host as the public protocol layer.
```

Known-good commands:

```bash
cd ~/repos/pi-foundry-official-invocations
azd ai agent invoke pi-foundry-official-invocations \
  --protocol invocations \
  --version 3 \
  --new-session \
  --timeout 900 \
  'Say exactly: ok'

npm run demo:remote:artifact -- pi-foundry-official-invocations 3
```

## Runtime modes

### Official Invocations mode

Recommended for Foundry-facing deployments.

```text
Foundry /invocations
  -> official azure-ai-agentserver-invocations Python host
  -> Node backend on 127.0.0.1:18080
  -> pi --mode rpc
```

Files:

```text
Dockerfile.official
runtime/official-invocations/main.py
runtime/official-invocations/entrypoint.sh
runtime/official-invocations/requirements.txt
runtime/official-invocations/smoke-local.sh
```

Local smoke:

```bash
cd ~/repos/pi-foundry
npm run smoke:official
```

### Node direct mode

Recommended for local development, fast debugging, backend validation, and fallback deployments.

```bash
cd ~/repos/pi-foundry
PI_MOCK=1 npm start
npm run smoke
npm run smoke:sse
```

Files:

```text
Dockerfile
src/server.mjs
src/adapters/pi-rpc.mjs
src/runtime/artifacts.mjs
```

## Main user workflow

From a fresh wrapper project:

```bash
cp agent.config.example.yaml agent.config.yaml
npm run configure:agent -- <agent-name> --acr=<registry>.azurecr.io
npm run import:pi-agent -- <path-to-existing-pi-agent> --dry-run
npm run import:pi-agent -- <path-to-existing-pi-agent>
npm run doctor
azd env new <agent-name>
azd env set ...
azd deploy --no-prompt
npm run grant:artifact-rbac -- <agent-name> <storage-account>
npm run demo:remote:artifact -- <agent-name> <version>
```

Short checklist:

```text
docs/deploy-existing-pi-agent.md
```

Narrative walkthrough:

```text
docs/existing-pi-agent-journey.md
```

Demo script:

```text
docs/demo-checklist.md
```

## Current validation status

Last checked:

```text
pi-foundry:                         validate 0 failed, doctor 0 failed
pi-foundry-official-invocations:    validate 0 failed, doctor 0 failed
media-report-foundry:               validate 0 failed, doctor 0 failed
media-report-agent:                 git clean
```

Expected non-blocking warnings:

- Docker socket permission may be denied in this agent harness; `remoteBuild: true` avoids blocking remote deploys.
- Main template repo may not have `agent.config.yaml`; users create it from `agent.config.example.yaml`.
- Some wrapper repos may warn about missing optional `mcp.config.json` depending on imported assets.

## Important implementation notes

- The official Invocations wrapper supports both non-streaming JSON and streaming SSE.
- Non-streaming `azd ai agent invoke` through official mode now returns backend JSON, not raw SSE lines.
- Streaming clients still receive `token` and `done` SSE events.
- Artifact publishing uses Azure Storage Static Website and requires `Storage Blob Data Contributor` for agent identities.
- Use `npm run grant:artifact-rbac -- <agent-name> <storage-account>` after first deploy when artifact publishing is enabled.

## Things intentionally not done yet

- `/responses` protocol support is intentionally out of scope for now.
- Generic non-Pi BYO agent adapters are out of scope for this phase.
- Full official Invocations replacement of the Node backend is out of scope; official mode currently proxies to Node.
- Official mode is recommended, but Node direct mode remains supported.

## Suggested next phase

Only after this handoff is stable:

1. Verify `azd ai agent init -m <agent.manifest.yaml>` template experience.
2. Decide whether to make `Dockerfile.official` the default `Dockerfile` in a future breaking change.
3. Add contract smoke tests for request shapes: `message`, `input`, `input.message`, `text/plain`, SSE.
4. Harden official wrapper error/header propagation and process supervision.
