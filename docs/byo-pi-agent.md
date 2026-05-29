# Bring Your Own Pi Agent to Foundry

`pi-foundry` is a template for running your own Pi-based agent on Microsoft Foundry Hosted Agents.

You bring Pi skills, MCP servers, tools, prompts, model configuration, and environment variables. The template provides the Foundry Invocations bridge, Pi RPC lifecycle, session mapping, streaming, Docker packaging, deployment files, and artifact delivery.

## Mental model

```text
Developer-owned Pi layer
  - .agents/skills/
  - MCP servers
  - prompts and instructions
  - model/provider choices
  - tool credentials and env vars
  - artifact behavior
        |
        v
Template-owned runtime layer
  - /invocations HTTP endpoint
  - pi --mode rpc bridge
  - Foundry agent_session_id -> Pi session dir
  - SSE streaming
  - artifact collection/publishing
  - health/readiness
  - Docker and azd deployment
        |
        v
Microsoft Foundry platform layer
  - Hosted Agent container
  - endpoint, identity, deployment, versions
  - model endpoint access
  - logs and monitoring
```

## What you should customize

A typical Pi agent owner customizes:

- `.agents/skills/` for Pi skills.
- MCP configuration, if your Pi setup uses MCP servers.
- `PI_ARGS`, `PI_OPENAI_*`, and model/provider environment values.
- Third-party credentials such as `GITHUB_TOKEN`, `JIRA_TOKEN`, or service-specific tokens.
- Demo prompts and workspace content.
- Artifact conventions such as `artifact-manifest.json`.

## What the template owns

You should not need to edit these for the common path:

- `src/server.mjs` — Foundry Invocations server and Pi RPC bridge.
- `Dockerfile` — container shape for Foundry Hosted Agent.
- `agent.yaml` and `agent.manifest.yaml` — Hosted Agent definitions.
- `azure.yaml` — azd service configuration.
- `scripts/` smoke and deployment helper scripts.

Advanced users can still modify them, but the goal is that most Pi agent developers configure the agent layer instead of rewriting the runtime bridge.

## Configuration files

Start with:

```bash
cp .env.example .env
cp agent.config.example.yaml agent.config.yaml
```

`agent.config.example.yaml` documents the intended high-level contract. Today, runtime deployment still reads lower-level environment variables and YAML files directly. Future work can use `agent.config.yaml` to generate and validate those files.

Important runtime variables:

| Variable | Purpose |
|---|---|
| `PI_ARGS` | Pi command arguments. Should include `--mode rpc`; the wrapper handles per-session `--session-dir`. |
| `PI_MOCK` | Set to `1` for local wrapper testing without model credentials. |
| `PI_OPENAI_API_KEY` | API key used to generate the Pi `foundry` provider. |
| `PI_OPENAI_BASE_URL` | OpenAI-compatible Foundry/account endpoint. |
| `PI_OPENAI_MODEL` | Foundry deployment/model name. |
| `ARTIFACT_PUBLISH_MODE` | Set to `static-web` to publish generated artifacts to Azure Storage Static Website. |

Avoid custom environment variables starting with `FOUNDRY_` or `AGENT_`; those prefixes are reserved by Foundry Hosted Agents.

## Add your Pi skills

Place skills under:

```text
.agents/skills/<skill-name>/SKILL.md
```

If you already have a local Pi agent project, import common assets with:

```bash
npm run import:pi-agent -- ../my-existing-pi-agent
```

Preview first with:

```bash
npm run import:pi-agent -- ../my-existing-pi-agent --dry-run
```

See [existing-pi-agent-journey.md](./existing-pi-agent-journey.md) for the full story of bringing an existing Pi agent with skills such as `edge-tts` and `hyperframes` to Foundry.

Demo skills such as `edge-tts`, `hyperframes`, and `gpt-image-2` are examples of what can run remotely. They are not required by the Foundry runtime bridge.

## Artifacts

For downloadable outputs, ask Pi skills or prompts to write files under the artifact directory injected by the wrapper. When useful, write an `artifact-manifest.json` next to generated files:

```json
{
  "artifacts": [
    {
      "path": "index.html",
      "name": "Report",
      "description": "Main HTML report",
      "contentType": "text/html; charset=utf-8"
    }
  ]
}
```

See [artifacts.md](./artifacts.md) for publishing details.

## Local validation and environment doctor

Run static template validation:

```bash
npm run validate
```

Run the BYO Pi/Foundry environment doctor:

```bash
npm run doctor
```

`doctor` checks local tools, Docker access, azd environment values, Foundry resource tiers, reserved environment variable prefixes, Pi runtime settings, and artifact publishing configuration. It redacts secrets and reports actionable warnings before deployment.

Then test the wrapper without model credentials:

```bash
PI_MOCK=1 npm start
npm run smoke
```

For a real local Pi setup:

```bash
npm start
npm run smoke
npm run smoke:sse
npm run smoke:session
```

## Deploy to Foundry

Typical flow:

```bash
azd env new <your-agent-env>
azd env set PI_MOCK 0
azd env set 'PI_ARGS=--mode rpc --no-session --provider foundry --model <model>'
azd env set PI_OPENAI_API_KEY '<key>'
azd env set PI_OPENAI_BASE_URL '<openai-compatible-endpoint>'
azd env set PI_OPENAI_MODEL '<model>'
azd deploy --no-prompt
```

Then invoke:

```bash
azd ai agent invoke pi-foundry \
  --protocol invocations \
  --new-session \
  --timeout 600 \
  'Say exactly: ok'
```

See [../DEPLOY.md](../DEPLOY.md) for the current deployment workflow and troubleshooting notes.

## Common migration pitfalls

- **Reserved env vars**: do not define custom `AGENT_*` or `FOUNDRY_*` variables.
- **Resource tiers**: use valid Hosted Agent CPU/memory pairs such as `1/2Gi` or `2/4Gi`.
- **Local vs container paths**: runtime code, workspace files, generated artifacts, and session state live in different directories.
- **Artifacts**: local `/artifacts/<path>` is not exposed through the Foundry front door; use static website publishing for remote clickable links.
- **Secrets**: `.azure/` and local `.env` files must not be committed.
