const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:8080";

async function main() {
  const health = await fetch(`${baseUrl}/health`);
  console.log("health", health.status, await health.text());

  const invocation = await fetch(`${baseUrl}/invocations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "Say exactly: ok" }),
  });
  console.log("invocation", invocation.status, await invocation.text());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
