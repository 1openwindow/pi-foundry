# Demo checklist

This checklist demonstrates the end-to-end **Bring Your Own Pi Agent to Foundry** story.

## Repos

| Repo | Purpose |
|---|---|
| `~/repos/media-report-agent` | Example existing user-owned Pi agent with `edge-tts`, `hyperframes`, prompts, and MCP config. |
| `~/repos/media-report-foundry` | Wrapper created from `pi-foundry`, importing `media-report-agent`; deployed as `media-report-foundry`. |
| `~/repos/pi-foundry` | Main BYO Pi Agent template/runtime. |
| `~/repos/pi-foundry-official-invocations` | Official Invocations runtime deployment experiment; current recommended deployment architecture reference. |

## Demo 1: show the existing Pi agent assets

```bash
cd ~/repos/media-report-agent
find . -path './.git' -prune -o -maxdepth 4 -type f -print | sort
```

Expected highlights:

```text
.agents/skills/edge-tts/SKILL.md
.agents/skills/hyperframes/SKILL.md
mcp.config.json
prompts/narrated-product-update.zh.md
demo-workspace/sources/q2-product-brief.md
```

## Demo 2: show wrapper creation workflow from the template

Use dry-run from the template repo:

```bash
cd ~/repos/pi-foundry
npm run create:wrapper -- \
  --name demo-pi-agent \
  --target ~/repos/demo-pi-agent \
  --from ~/repos/media-report-agent \
  --mode official \
  --acr crce6hg4ngzj3as.azurecr.io \
  --dry-run
npm run validate
```

This demonstrates that a user can create a wrapper, configure the agent, switch to official mode, and import common Pi-owned assets with one command.

## Demo 3: validate the imported wrapper project

```bash
cd ~/repos/media-report-foundry
npm run validate
npm run doctor
```

Expected:

```text
Validation summary: ... 0 failed
Doctor summary: ... 0 failed
```

Docker socket warnings are not blocking when `remoteBuild: true` is enabled.

## Demo 4: invoke the imported wrapper remotely

Known-good remote agent:

```text
media-report-foundry v1
```

Invoke:

```bash
cd ~/repos/media-report-foundry
azd ai agent invoke media-report-foundry \
  --protocol invocations \
  --version 1 \
  --new-session \
  --timeout 600 \
  'Say exactly: ok'
```

Expected:

```json
{
  "output": "ok",
  "mock": false
}
```

## Demo 5: run artifact demo on imported wrapper

```bash
cd ~/repos/media-report-foundry
npm run demo:remote:artifact -- media-report-foundry 1
```

Expected:

- response contains `Artifacts:` markdown links
- response contains structured `artifacts` array
- `index.html` URL returns HTTP 200

Verify a returned URL:

```bash
curl --noproxy '*' -I '<index-html-url>'
```

## Demo 6: validate official Invocations runtime mode

Known-good remote agent:

```text
pi-foundry-official-invocations v3
```

Invoke:

```bash
cd ~/repos/pi-foundry-official-invocations
azd ai agent invoke pi-foundry-official-invocations \
  --protocol invocations \
  --version 3 \
  --new-session \
  --timeout 900 \
  'Say exactly: ok'
```

Expected JSON output:

```json
{
  "output": "ok",
  "mock": false,
  "artifacts": []
}
```

## Demo 7: artifact demo through official Invocations runtime

```bash
cd ~/repos/pi-foundry-official-invocations
npm run demo:remote:artifact -- pi-foundry-official-invocations 3
```

Expected:

- JSON output, not raw SSE lines
- `index.html` and `script.md` artifacts
- static website URLs under `pi-foundry-official-invocations/<date>/<request-id>/...`

## Demo 8: local official runtime smoke

```bash
cd ~/repos/pi-foundry
npm run smoke:official
```

Expected:

```text
--- wrapper readiness ---
{"status":"healthy"}
--- invocation json ---
{"output":"mock response: Say exactly: ok", ...}
--- invocation stream ---
data: {"type":"token", ...}
```

## Recommended story to tell

1. Start with an existing local Pi agent (`media-report-agent`).
2. Use `pi-foundry` to configure and import that agent's skills/MCP/prompts.
3. Deploy the wrapper to Foundry.
4. Use official Invocations mode for the Foundry-facing protocol host.
5. Keep Node direct mode for local development/backend/fallback.
6. Show remote invocation and artifact URLs.
