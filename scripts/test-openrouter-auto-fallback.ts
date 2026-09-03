import assert from "node:assert/strict";
import { directGenerate } from "../src/lib/directLlmClient";

const appWindow = new EventTarget();
Object.assign(globalThis, { window: appWindow });

const requestedModels: string[] = [];
const fallbackEvents: Array<{ from?: string; to?: string }> = [];
appWindow.addEventListener("writers-studio-openrouter-fallback", (event) => {
  fallbackEvents.push((event as CustomEvent<{ from?: string; to?: string }>).detail);
});

const originalFetch = globalThis.fetch;
globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const body = JSON.parse(String(init?.body || "{}"));
  requestedModels.push(body.model);

  if (body.model === "openrouter/example-primary") {
    return new Response(JSON.stringify({
      error: { code: 402, message: "Insufficient credits" },
    }), { status: 402, headers: { "Content-Type": "application/json" } });
  }

  if (body.model === "openrouter/free") {
    return new Response(JSON.stringify({
      choices: [{ message: { content: "Fallback generated text." } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  return new Response(JSON.stringify({ error: { message: `Unexpected model: ${body.model}` } }), { status: 500 });
}) as typeof fetch;

try {
  const result = await directGenerate({
    provider: "openrouter",
    model: "openrouter/example-primary",
    apiKeys: { openrouter: "test-key" },
    prompt: "Продолжи сцену.",
  });

  assert.equal(result, "Fallback generated text.");
  assert.deepEqual(requestedModels, ["openrouter/example-primary", "openrouter/free"]);
  assert.deepEqual(fallbackEvents, [{ from: "openrouter/example-primary", to: "openrouter/free" }]);
  console.log("PASS: 402 primary model → openrouter/free → successful generated text; fallback event emitted.");
} finally {
  globalThis.fetch = originalFetch;
}
