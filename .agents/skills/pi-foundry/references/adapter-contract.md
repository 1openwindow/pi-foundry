# pi-foundry adapter bundle contract

The skill owns the canonical adapter bundle. The user repo receives a materialized deploy-time copy.

## Canonical skill assets

```text
.agents/skills/pi-foundry/assets/adapter/README.md
.agents/skills/pi-foundry/assets/adapter/render.mjs
.agents/skills/pi-foundry/assets/adapter/doctor.mjs
.agents/skills/pi-foundry/assets/adapter/postdeploy.mjs
.agents/skills/pi-foundry/assets/adapter/dockerignore.block
.agents/skills/pi-foundry/assets/adapter/adapter-manifest.json
```

## Installed user repo files

The skill installs/copies:

```text
.dockerignore                         # merged managed block
.azd/pi-foundry/README.md
.azd/pi-foundry/render.mjs
.azd/pi-foundry/doctor.mjs
.azd/pi-foundry/postdeploy.mjs
```

The skill creates from user/repo intent:

```text
.azd/pi-foundry/pi-foundry.yaml
```

`render.mjs` materializes:

```text
azure.yaml                              # only when absent or already pi-foundry-managed, unless overwrite is explicitly allowed
agent.yaml                              # generated compatibility file for current azd azure.ai.agents package/deploy behavior
agent.manifest.yaml                     # generated compatibility file for current azd azure.ai.agents package/deploy behavior
.azd/pi-foundry/Dockerfile
.azd/pi-foundry/pi-foundry.lock.yaml
.azd/pi-foundry/generated/agent.yaml
.azd/pi-foundry/generated/agent.manifest.yaml
```

`.azd/pi-foundry/pi-foundry.yaml` remains the human-facing source of truth. Root `agent.yaml` and `agent.manifest.yaml` are generated mirrors because current `azd azure.ai.agents` package/deploy paths still read them from the service root.

## Adapter bundle must not include user-specific files

The canonical adapter bundle must not contain:

```text
pi-foundry.yaml
Dockerfile
pi-foundry.lock.yaml
generated/
# hand-authored agent.yaml
# hand-authored agent.manifest.yaml
```

## Why

- `pi-foundry.yaml` is specific to one user's agent and must be created by the skill.
- `Dockerfile`, lock, and generated agent specs are render outputs.
- Hand-authored root `agent.yaml` and `agent.manifest.yaml` make the repo feel invaded and create source-of-truth confusion; generated root mirrors are allowed only for azd extension compatibility and must match `.azd/pi-foundry/generated/*`.

## Direct azd behavior

After skill installation and configuration, `azd up` is self-contained from the user repo:

```text
render.mjs
render.mjs --check
doctor.mjs
azd package --all
azd deploy --all
postdeploy.mjs
```
