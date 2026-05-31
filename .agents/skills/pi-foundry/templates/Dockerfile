# pi-foundry thin Dockerfile. Free to edit.
# The pi-foundry runtime image owns the Foundry Invocations host, Pi RPC,
# artifact publishing, and session lifecycle. This image only layers the user's
# repo into /workspace, which pi will read at runtime.
ARG PI_FOUNDRY_RUNTIME_IMAGE=<runtime-image>
FROM ${PI_FOUNDRY_RUNTIME_IMAGE}

WORKDIR /app
COPY . /workspace
