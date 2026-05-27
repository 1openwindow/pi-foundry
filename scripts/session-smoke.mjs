const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:8080";
const sessionId = process.env.SESSION_ID ?? `smoke-${Date.now()}`;

async function invoke(message, id = sessionId) {
  const response = await fetch(`${baseUrl}/invocations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: id, message }),
  });
  const text = await response.text();
  console.log(response.status, text);
  if (!response.ok) throw new Error(`invocation failed: ${response.status} ${text}`);
  return JSON.parse(text);
}

await invoke("Remember this exact word for this session: pineapple. Reply exactly: remembered");
const same = await invoke("What exact word did I ask you to remember? Reply with only the word.");
const other = await invoke("What exact word did I ask you to remember? Reply with only the word, or unknown if none.", `${sessionId}-other`);

if (!same.output.toLowerCase().includes("pineapple")) {
  throw new Error(`same-session recall failed: ${same.output}`);
}
if (other.output.toLowerCase().includes("pineapple")) {
  throw new Error(`cross-session isolation failed: ${other.output}`);
}
