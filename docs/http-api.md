# HTTP API

The `pi-foundry-runtime` image exposes the Foundry Invocations protocol on the
container port (`8088` by default). End users typically reach it via
`azd ai agent invoke` or Pi's remote mode, but the raw HTTP shape is documented
here for direct callers and debugging.

## `POST /invocations` — JSON

Request:

```json
{ "message": "List files in the current directory.", "sessionId": "optional", "cwd": "." }
```

Response:

```json
{
  "requestId": "...",
  "output": "...",
  "sessionId": "...",
  "mock": false
}
```

## `POST /invocations` — Server-Sent Events

Use `Accept: text/event-stream` (or `?stream=true`). The server streams
`data:` lines:

```json
{ "type": "token", "content": "..." }
```

terminated by exactly one:

```json
{
  "type": "done",
  "full_text": "...",
  "session_id": "...",
  "request_id": "..."
}
```

Stream contract:

- `token` events carry **model deltas only**.
- `done` carries the final `full_text` plus correlation ids.

## `GET /invocations/docs/openapi.json`

Returns the OpenAPI spec for the routes above.

## Health & readiness

- `GET /health` — process is up
- `GET /readiness` — backend ready to accept invocations
