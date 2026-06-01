# pi-foundry skill troubleshooting

The LLM consults this file when `azd up` or `azd ai agent invoke` fails. Match the error symptom in the left column, give the user the one-line cause and the one command in the right column.

## Bootstrap / template

| Symptom | Cause + action |
|---|---|
| `bootstrap.mjs` refuses to write because `azure.yaml` exists | User repo already has a non-pi-foundry `azure.yaml`. Ask before replacing; rerun `bootstrap.mjs --force` only after explicit confirmation, and back up the old file first. |
| `Dockerfile` contains `<runtime-image>` literal at deploy time | bootstrap was run without `--runtime-image`. Rerun: `bootstrap.mjs --runtime-image <acr>/pi-foundry-runtime:<tag>` |
| `agent.yaml` / `agent.manifest.yaml` contains `<agent-name>` literal | Same root cause: bootstrap not run, or run with wrong arg. Rerun with `--agent-name <name>`. |

## azd env

| Symptom | Cause + action |
|---|---|
| `azd env get-values` is empty | No environment selected. `azd env new <name>` or `azd env select <name>`. |
| Deploy fails with "image pull unauthorized" | Foundry identities lack ACR pull. Run `azd ai agent doctor --no-prompt` and assign AcrPull on the registry. |
| Invoke returns "configuration: no foundry provider" or model 401 | `PI_OPENAI_*` not set in azd env, or `PI_ARGS` missing `--provider foundry --model <model>`. Reconfigure via `configure-env.mjs`. |
| Container fails readiness | `PI_MOCK` not set and `PI_OPENAI_API_KEY` missing → runtime rejects start. Set `PI_MOCK=1` for smoke, set the API key, or use `PI_MODEL_AUTH=managed-identity` for keyless auth. |
| azd env contains custom `AGENT_*` or `FOUNDRY_*` variables (other than `FOUNDRY_PROJECT_ENDPOINT`) | Foundry reserves these prefixes. Remove them with `azd env set <NAME>=` to clear, or rename. |

## Deploy

| Symptom | Cause + action |
|---|---|
| `azd up` succeeds but `azd ai agent invoke` returns nothing or times out | Pass the deployed version explicitly: `azd ai agent invoke <name> --protocol invocations --version <N> --new-session --timeout 900 'Say exactly: ok'`. Find `<N>` in `azd ai agent show <name> --output json --no-prompt`. |
| `agent.yaml is missing` during deploy | Foundry deploy currently reads `agent.yaml` from repo root. The skill puts it there by design. If it was deleted, rerun `bootstrap.mjs`. |
| Resource tier rejected | Hosted Agent only allows cpu/memory pairs `0.25/0.5Gi, 0.5/1Gi, 1/2Gi, 2/4Gi`. Edit `azure.yaml` and `agent.yaml` to match. |
| Container exceeds reserved env restriction | Some `environment_variables` entry uses `AGENT_*` or `FOUNDRY_*` (other than `FOUNDRY_PROJECT_ENDPOINT`). Remove it from `agent.yaml` / `agent.manifest.yaml`. |

## Invoke

| Symptom | Cause + action |
|---|---|
| Response includes `"mock": true` when user expected real model | `PI_MOCK=1` is still set. `azd env set PI_MOCK=0` and `azd up` to roll a new revision. |
| Session continuity not working | Pass the same `agent_session_id`. `verify.mjs --session <id>` reuses sessions. |

## Runtime image

| Symptom | Cause + action |
|---|---|
| `FROM <runtime-image>` fails at build time | Either bootstrap wasn't given `--runtime-image`, or the user's identity can't pull from that ACR. `az acr login -n <acr>` and rerun. |
| Skills don't load inside container | Pi reads from `/workspace/.agents/skills/`. Ensure the user's repo has skills there and Dockerfile does `COPY . /workspace` (it does by default). |
| Workspace empty inside container | `.dockerignore` excluded too much. Compare against `templates/.dockerignore`. |
