# open-foundry thin Dockerfile. Free to edit.
# The open-foundry runtime image owns the Foundry Invocations host, Pi RPC, and
# session lifecycle. This image only layers the user's repo into /workspace,
# which pi will read at runtime.
ARG OPEN_FOUNDRY_RUNTIME_IMAGE=<runtime-image>
FROM ${OPEN_FOUNDRY_RUNTIME_IMAGE}

WORKDIR /app
COPY . /workspace
