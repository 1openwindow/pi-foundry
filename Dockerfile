FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    PORT=8088 \
    HOST=0.0.0.0 \
    HOME=/home/node \
    WORKSPACE_DIR=/workspace \
    FILES_DIR=/files \
    STATE_DIR=/home/node/.pi-foundry \
    SESSIONS_DIR=/home/node/.pi-foundry/sessions \
    PI_CODING_AGENT_DIR=/home/node/.pi-foundry/pi-agent \
    PI_ARGS="--mode rpc --no-session"

RUN npm install -g @earendil-works/pi-coding-agent@0.75.5 --ignore-scripts \
    && mkdir -p /app /files /workspace /home/node/.pi-foundry \
    && chown -R node:node /app /files /workspace /home/node

USER node
WORKDIR /app
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src

EXPOSE 8088
CMD ["node", "src/server.mjs"]
