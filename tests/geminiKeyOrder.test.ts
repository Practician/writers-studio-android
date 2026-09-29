import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { __setGeminiBaseUrlForTests, directGenerate, geminiHealthSummary, resetGeminiModelMemory } from "../src/lib/directLlmClient";

// Стенд по журналу 29.09.2026: три ключа Gemini, а в журнале сплошное «ключ 1/3» и модель
// gemini-3.1-flash-lite. Настоящий HTTP-шлюз на 127.0.0.1; клиент не подменён.
const traces: any[] = [];
(globalThis as any).window = { dispatchEvent: (event: any) => { traces.push(event?.detail); return true; } };
(globalThis as any).CustomEvent = class { detail: any; constructor(public type: string, public init: any) { this.detail = init?.detail; } };

const KEY1 = "AIzaOrderKey00000001";
const KEY2 = "AIzaOrderKey00000002";
const KEY3 = "AIzaOrderKey00000003";
const MINUTE_LIMIT = { error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Resource has been exhausted (e.g. check quota)." } };
const ok = (text: string) => ({ candidates: [{ content: { parts: [{ text }], role: "model" }, finishReason: "STOP" }] });
const EMPTY = { candidates: [{ content: { role: "model" }, finishReason: "STOP" }] };

function startGateway(respond: (key: string, model: string) => { status: number; payload: any }) {
  const hits: Array<{ key: string; model: string }> = [];
  const server = createServer((req: any, res: any) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    let raw = "";
    req.on("data", (chunk: any) => { raw += chunk; });
    req.on("end", () => {
      const key = url.searchParams.get("key") || "";
      const model = decodeURIComponent((url.pathname.split("/").pop() || "").replace(":generateContent", ""));
      hits.push({ key, model });
      const answer = respond(key, model);
      res.writeHead(answer.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(answer.payload));
    });
  });
  return new Promise<{ url: string; hits: typeof hits; close: () => Promise<void> }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ url: `http://127.0.0.1:${port}/v1beta/models`, hits, close: () => new Promise<void>((done) => server.close(() => done())) });
    });
  });
}

const request = (keys: string[]) => ({
  provider: "gemini" as const,
  model: "gemini-3.8-flash",
  apiKeys: { gemini: keys.join("\n") },
  prompt: "Правь блок.",
  maxTokens: 6_144,
});

test("ключ 1 сидит на lite, а ключи 2 и 3 свежие: следующий запрос идёт на ключ 2 с основной моделью", async () => {
  resetGeminiModelMemory();
  const gateway = await startGateway((key, model) => {
    if (key === KEY1 && model !== "gemini-3.1-flash-lite") return { status: 429, payload: MINUTE_LIMIT };
    return { status: 200, payload: ok(`ответ ${key.slice(-1)} ${model}`) };
  });
  __setGeminiBaseUrlForTests(gateway.url);
  try {
    const first = await directGenerate(request([KEY1, KEY2, KEY3]));
    assert.match(first, /gemini-3\.1-flash-lite/, "первый запрос деградирует по моделям на ключе 1");
    const afterFirst = gateway.hits.length;
    const second = await directGenerate(request([KEY1, KEY2, KEY3]));
    const secondHits = gateway.hits.slice(afterFirst);
    assert.equal(secondHits[0]?.key, KEY2, "второй запрос должен начаться с ключа, где доступна лучшая модель");
    assert.equal(secondHits[0]?.model, "gemini-3.8-flash");
    assert.equal(secondHits.filter((hit) => hit.key === KEY1).length, 0, "ключ 1 со слабой моделью не трогается");
    assert.match(second, /ответ 2 gemini-3\.8-flash/);
  } finally {
    __setGeminiBaseUrlForTests(null);
    await gateway.close();
  }
});

test("пустой ответ на всей цепочке ключа 1: следующий запрос-ключ, а не сразу другой провайдер", async () => {
  resetGeminiModelMemory();
  const gateway = await startGateway((key) => (key === KEY1 ? { status: 200, payload: EMPTY } : { status: 200, payload: ok("Текст с ключа 2.") }));
  __setGeminiBaseUrlForTests(gateway.url);
  traces.length = 0;
  try {
    const text = await directGenerate(request([KEY1, KEY2, KEY3]));
    assert.equal(text, "Текст с ключа 2.");
    assert.ok(traces.some((trace) => String(trace?.message || "").includes("пробую следующий ключ Gemini")));
    assert.ok(gateway.hits.some((hit) => hit.key === KEY2));
  } finally {
    __setGeminiBaseUrlForTests(null);
    await gateway.close();
  }
});

test("блокировка запроса фильтром: одна попытка, ключи и модели не выжигаются и не остывают", async () => {
  resetGeminiModelMemory();
  const gateway = await startGateway(() => ({ status: 200, payload: { promptFeedback: { blockReason: "OTHER" } } }));
  __setGeminiBaseUrlForTests(gateway.url);
  traces.length = 0;
  try {
    await assert.rejects(() => directGenerate(request([KEY1, KEY2, KEY3])), /blockReason=OTHER/);
    assert.equal(gateway.hits.length, 1, "блокировка не зависит от ключа и модели — ровно один вызов");
    assert.deepEqual(geminiHealthSummary().cooling, [], "фильтр не должен переводить модели в остывание");
  } finally {
    __setGeminiBaseUrlForTests(null);
    await gateway.close();
  }
});

test("липкость lite истекает: через 10 минут основная модель пробуется снова", async () => {
  resetGeminiModelMemory();
  let primaryHealthy = false;
  const gateway = await startGateway((_key, model) => {
    if (model === "gemini-3.8-flash" && !primaryHealthy) return { status: 429, payload: MINUTE_LIMIT };
    if (model !== "gemini-3.8-flash" && model !== "gemini-3.1-flash-lite") return { status: 429, payload: MINUTE_LIMIT };
    return { status: 200, payload: ok(`ответ ${model}`) };
  });
  __setGeminiBaseUrlForTests(gateway.url);
  const realNow = Date.now;
  try {
    const first = await directGenerate(request([KEY1]));
    assert.match(first, /gemini-3\.1-flash-lite/);
    // Сразу после успеха lite держит голову цепочки.
    const afterFirst = gateway.hits.length;
    await directGenerate(request([KEY1]));
    assert.equal(gateway.hits.slice(afterFirst)[0]?.model, "gemini-3.1-flash-lite");
    // Через 31 минуту и остывание 3.8 кончилось, и липкость lite истекла.
    primaryHealthy = true;
    Date.now = () => realNow() + 31 * 60_000;
    const afterSecond = gateway.hits.length;
    const third = await directGenerate(request([KEY1]));
    assert.equal(gateway.hits.slice(afterSecond)[0]?.model, "gemini-3.8-flash", "основная модель должна вернуться в голову цепочки");
    assert.match(third, /gemini-3\.8-flash/);
  } finally {
    Date.now = realNow;
    __setGeminiBaseUrlForTests(null);
    await gateway.close();
  }
});
