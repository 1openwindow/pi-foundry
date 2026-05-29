# Demo checklist

This checklist demonstrates the end-to-end **skill-guided azd-native deployment** story.

Primary story:

```text
clean existing Pi agent repo -> Pi skill guides azd init/template/env/up -> Foundry Hosted Agent
```

No wrapper repo is required.

## Repos

| Repo | Purpose |
|---|---|
| `~/repos/clean-pi-agent` | Clean user-owned Pi agent used as the test fixture. |
| `~/repos/pi-foundry` | Runtime source, azd template, deployment skill, runtime image build scripts, and docs. |

## Demo 1: show the clean Pi agent repo

```bash
cd ~/repos/clean-pi-agent
find . -path './.git' -prune -o -path './.azure' -prune -o -maxdepth 4 -type f -print | sort
```

Expected highlights before initialization:

```text
.agents/skills/hello-foundry/SKILL.md
README.md
demo-workspace/sources/brief.md
prompts/hello-foundry.md
```

Message to tell:

```text
This is a clean user repo. It does not contain pi-foundry runtime source or deployment adapter files until azd init is run.
```

## Demo 2: use the deployment skill as the UX layer

From the clean user repo, temporarily load the pi-foundry deployment skill:

```bash
cd ~/repos/clean-pi-agent
pi --skill ~/repos/pi-foundry/.agents/skills/deploy-pi-agent-to-foundry
```

Then ask:

```text
帮我把当前 agent 部署到 Foundry
```

Expected behavior:

- skill keeps the user in the current repo
- skill uses `azd` as the deployment engine
- skill does not ask the user to cd into `pi-foundry`
- skill does not create a wrapper repo

## Demo 3: initialize the adapter with azd

From the existing Pi agent repo:

```bash
cd ~/repos/clean-pi-agent
azd init --template ~/repos/pi-foundry/templates/azd-native . --environment clean-pi-agent
```

Expected:

- `azd init` warns before copying files into a non-empty repo
- no README conflict from the template
- template files are added in place
- no agent business-code files are modified

Added files:

```text
azure.yaml
agent.yaml
agent.manifest.yaml
.dockerignore
.azd/pi-foundry/Dockerfile
.azd/pi-foundry/README.md
.azd/pi-foundry/doctor.mjs
.azd/pi-foundry/postdeploy.mjs
```

## Demo 4: configure env and run adapter doctor

```bash
cd ~/repos/clean-pi-agent
node .azd/pi-foundry/doctor.mjs
```

Expected after environment configuration:

```text
pi-foundry adapter doctor: ... 0 failed
```

Current known-good result may include one pre-deploy warning from `azd ai agent doctor` before the first deployment because the remote agent does not exist yet.

## Demo 5: deploy with azd up

```bash
cd ~/repos/clean-pi-agent
azd up --no-prompt
```

Expected:

- custom `up` workflow runs
- adapter doctor runs first
- package/deploy succeeds
- postdeploy prints the invoke command and grants artifact RBAC when configured
- no wrapper repo is involved

Known-good remote agent:

```text
pi-agent v1
```

## Demo 6: invoke the deployed agent

```bash
cd ~/repos/clean-pi-agent
azd ai agent invoke pi-agent \
  --protocol invocations \
  --version 1 \
  --new-session \
  --timeout 900 \
  'Say exactly: ok'
```

Expected:

```json
{
  "output": "ok",
  "mock": false,
  "artifacts": []
}
```

## Demo 7: artifact validation

```bash
cd ~/repos/clean-pi-agent
azd ai agent invoke pi-agent \
  --protocol invocations \
  --version 1 \
  --new-session \
  --timeout 900 \
  "Create a tiny downloadable static HTML artifact named index.html titled 'Clean Pi Agent on Foundry'. Save it under the artifact directory you were instructed to use. Write artifact-manifest.json listing index.html. Reply concisely with artifact links."
```

Expected:

- response contains structured `artifacts` array
- `index.html` URL returns HTTP 200
- URLs are under `clean-pi-agent/<date>/<request-id>/...`

Verify a returned URL:

```bash
curl --noproxy '*' -I '<index-html-url>'
```

## Demo 8: runtime image remote build

When Docker is unavailable locally, build the runtime image in ACR:

```bash
cd ~/repos/pi-foundry
npm run runtime:acr-build -- \
  --registry crce6hg4ngzj3as.azurecr.io \
  --image pi-foundry-runtime:0.1.0
```

Known-good validation:

```text
Image:  crce6hg4ngzj3as.azurecr.io/pi-foundry-runtime:0.1.0
Run:    chh
Status: Succeeded
Digest: sha256:d2480ca47d4c4e37af69db1f9eca930108fcbabb062a9ade39cc704f6e1e9416
```

## Recommended story to tell

1. Start with the clean local Pi agent (`clean-pi-agent`).
2. Use the deployment skill as the natural-language UX layer.
3. Let the skill use azd: `azd init --template`, `azd env`, `azd up`.
4. Use a versioned pi-foundry runtime base image.
5. Show remote invocation and artifact URLs.
