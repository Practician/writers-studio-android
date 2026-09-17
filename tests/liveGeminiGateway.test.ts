import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { __setGeminiBaseUrlForTests, directGenerate, resetGeminiModelMemory } from "../src/lib/directLlmClient";

// ЖИВОЙ СТЕНД. Настоящий HTTP-сервер на 127.0.0.1 повторяет ту самую
// последовательность ответов Google, что легла в журнал автора 17.09.2026
// (16:17-16:24, время Киева):
//   ключ 1/3 - 429 «You exceeded your current quota ... Quota exceeded for metric»;
//   ключ 2/3 - 503 «high demand»;
//   ключ 3/3 - сначала 200 с обрезкой MAX_TOKENS, затем полноценный 200.
// В самом клиенте не подменено НИЧЕГО: идут настоящие fetch, разбор JSON, ротация
// ключей и моделей, память ключей. Подменён только адрес шлюза.
const traces: any[] = [];
(globalThis as any).window = { dispatchEvent: (event: any) => { traces.push(event?.detail); return true; } };
(globalThis as any).CustomEvent = class { detail: any; constructor(public type: string, public init: any) { this.detail = init?.detail; } };

const KEY1 = "AIzaJournalKey0001";
const KEY2 = "AIzaJournalKey0002";
const KEY3 = "AIzaJournalKey0003";

// Тело 429 из журнала автора — нарочно оставлено ДОСЛОВНО тем самым текстом,
// который раньше принимался за дневную квоту («You exceeded your current quota …
// check your plan and billing details»). Признаком дневной квоты теперь служит
// измерение в details (…PerDay…), а не фраза: так минутный лимит больше не
// паркует здоровый ключ на часы.
const QUOTA_BODY = {
  error: {
    code: 429,
    status: "RESOURCE_EXHAUSTED",
    message: "You exceeded your current quota, please check your plan and billing details. Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 0, quota_value: 1000",
    details: [
      {
        "@type": "type.googleapis.com/google.rpc.QuotaFailure",
        violations: [
          {
            quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_requests",
            quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
            quotaValue: "1000",
          },
        ],
      },
    ],
  },
};
const HIGH_DEMAND_BODY = {
  error: { code: 503, status: "UNAVAILABLE", message: "This model is currently experiencing high demand. Please try again later." },
};
const THINKING_REJECTED_BODY = {
  error: { code: 400, status: "INVALID_ARGUMENT", message: "Invalid JSON payload received. Unknown name \"thinkingConfig\" at 'generation_config': Cannot find field." },
};

const ok = (text: string, finishReason: string) => ({ candidates: [{ content: { parts: [{ text }], role: "model" }, finishReason }] });

function startGateway(respond: (key: string, model: string, body: any, callIndexForKey: number) => { status: number; payload: any }) {
  const hits: Array<{ key: string; model: string; body: any }> = [];
  const server = createServer((req: any, res: any) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    let raw = "";
    req.on("data", (chunk: any) => { raw += chunk; });
    req.on("end", () => {
      const key = url.searchParams.get("key") || "";
      const model = decodeURIComponent((url.pathname.split("/").pop() || "").replace(":generateContent", ""));
      const body = raw ? JSON.parse(raw) : {};
      const callIndexForKey = hits.filter((hit) => hit.key === key).length + 1;
      hits.push({ key, model, body });
      const answer = respond(key, model, body, callIndexForKey);
      res.writeHead(answer.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(answer.payload));
    });
  });
  return new Promise<{ url: string; hits: typeof hits; close: () => Promise<void> }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}/v1beta/models`,
        hits,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

function journal(from: number): string {
  return traces.slice(from).map((trace) => `${trace.status ?? "-"} ${trace.model} ключ ${trace.keyIndex}/${trace.keyCount}${trace.outputChars ? ` ${trace.outputChars} симв.` : ""}${trace.message ? ` — ${trace.message}` : ""}`).join("\n");
}

test("живой прогон журнала: мёртвый по дневной квоте ключ больше не перепробуется", async () => {
  resetGeminiModelMemory();
  const gateway = await startGateway((key, _model, _body, callIndexForKey) => {
    if (key === KEY1) return { status: 429, payload: QUOTA_BODY };
    if (key === KEY2) return { status: 503, payload: HIGH_DEMAND_BODY };
    if (callIndexForKey === 1) return { status: 200, payload: ok("фрагмент главы. ".repeat(60), "MAX_TOKENS") };
    return { status: 200, payload: ok("Полноценный текст главы. ".repeat(40), "STOP") };
  });
  traces.length = 0;
  __setGeminiBaseUrlForTests(gateway.url);
  const request = {
    provider: "gemini" as const,
    model: "gemini-3.8-flash",
    apiKeys: { gemini: [KEY1, KEY2, KEY3].join("\n") },
    prompt: "Продолжи главу.",
    maxTokens: 6_144,
  };
  try {
    const first = await directGenerate(request);
    const afterFirst = gateway.hits.length;
    const firstJournal = journal(0);
    console.log(`\n--- ЖУРНАЛ, запрос 1 ---\n${firstJournal}\n`);

    const second = await directGenerate(request);
    const secondJournal = journal(afterFirst === 0 ? 0 : traces.length - 5);
    console.log(`--- ЖУРНАЛ, запрос 2 ---\n${journal(0).split("\n").slice(-6).join("\n")}\n`);

    // 1. Первый запрос действительно дошёл до рабочего ключа и вернул текст.
    assert.ok(first.includes("фрагмент главы"), "первый запрос должен вернуть текст рабочего ключа");
    // 2. Мёртвый ключ опробован ровно один раз — по одной попытке на каждую модель
    //    цепочки, и больше к нему не возвращаются (раньше он перепробовался на каждом
    //    запросе: именно это выглядело как «зацикливание на Gemini»).
    assert.equal(gateway.hits.filter((hit) => hit.key === KEY1).length, 8, "ключ с дневной квотой должен быть опробован один раз за всю сессию — по одной попытке на каждую из 8 моделей цепочки");
    const secondCallHits = gateway.hits.slice(afterFirst);
    assert.equal(secondCallHits.filter((hit) => hit.key === KEY1).length, 0, "второй запрос не должен трогать припаркованный ключ");
    // 3. Журнал объясняет пропуск и называет причину.
    assert.match(firstJournal + journal(0), /Ключ в паузе до \d{2}:\d{2} \(исчерпана дневная квота\): пропуск\./);
    // 4. Размышления выключены — бюджет вывода целиком уходит в текст. У gemini-2.0-flash
    // поля нет вовсе (она его не понимает), поэтому правило — «ноль или отсутствие».
    for (const hit of gateway.hits) {
      const budget = hit.body?.generationConfig?.thinkingConfig?.thinkingBudget;
      assert.ok(budget === 0 || budget === undefined, `${hit.model}: thinkingConfig должен быть отключён (0) или отсутствовать`);
    }
    assert.ok(gateway.hits.some((hit) => hit.body?.generationConfig?.thinkingConfig?.thinkingBudget === 0), "хотя бы у одной модели размышления должны быть явно отключены");
    // 5. Обрезка по лимиту вывода видна автору отдельной строкой.
    assert.match(journal(0), /Ответ обрезан по лимиту вывода \(MAX_TOKENS\)/);
    // 6. Второй запрос доходит до рабочего ключа и получает полноценный текст.
    assert.ok(second.includes("Полноценный текст главы"), "второй запрос должен получить полноценный текст");
    assert.ok(secondCallHits.filter((hit) => hit.key === KEY2).length <= 12, "перегруженный ключ пробуется только внутри своего запроса: 8 моделей цепочки + повторы перегрузки");
  } finally {
    __setGeminiBaseUrlForTests(null);
    await gateway.close();
  }
});

test("ключ, не понимающий thinkingConfig, повторяется один раз без него", async () => {
  resetGeminiModelMemory();
  const gateway = await startGateway((_key, _model, body) => (
    body?.generationConfig?.thinkingConfig
      ? { status: 400, payload: THINKING_REJECTED_BODY }
      : { status: 200, payload: ok("Глава без размышлений.", "STOP") }
  ));
  traces.length = 0;
  __setGeminiBaseUrlForTests(gateway.url);
  try {
    const text = await directGenerate({
      provider: "gemini" as const,
      model: "gemini-3.6-flash",
      apiKeys: { gemini: KEY3 },
      prompt: "Продолжи главу.",
      maxTokens: 6_144,
    });
    assert.equal(text, "Глава без размышлений.");
    assert.equal(gateway.hits.length, 2, "ожидается ровно один повтор без thinkingConfig");
    assert.ok(!gateway.hits[1].body?.generationConfig?.thinkingConfig, "во втором запросе поля быть не должно");
    assert.match(journal(0), /не принимает thinkingConfig: повтор без отключения размышлений\./);
    console.log(`\n--- ЖУРНАЛ, отказ thinkingConfig ---\n${journal(0)}\n`);
  } finally {
    __setGeminiBaseUrlForTests(null);
    await gateway.close();
  }
});
