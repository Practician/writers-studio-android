import assert from "node:assert/strict";
import test from "node:test";
import {
  aiTellScore,
  humanizeGatePassed,
  MIN_BURSTINESS_WORDS,
  type AiTellScore,
} from "../server/humanStyle";
import {
  isReasoningModel,
  reasoningDisableFields,
  reasoningRetryBudget,
  markReasoningDisableUnsupported,
  callOpenAiStyleGuarded,
  REASONING_RETRY_MAX_TOKENS,
} from "../server/llmProvider";

// --- gate: ритм спрашиваем только там, где он измерим -------------------------
test("gate не валит короткий фрагмент из-за burstiness, а длинный — валит", () => {
  const ровный: AiTellScore = {
    score: 10,
    patternDensity: 0,
    burstiness: 0.1,
    openerRepetition: 0,
    hits: [],
  };
  assert.equal(
    humanizeGatePassed({ ...ровный, words: 80 }, 12, 0.45),
    true,
    "80 слов: ритм не измерим — gate не должен падать",
  );
  assert.equal(
    humanizeGatePassed({ ...ровный, words: 600 }, 12, 0.45),
    false,
    "600 слов: низкий burstiness по-прежнему валит gate",
  );
  assert.equal(
    humanizeGatePassed(ровный, 12, 0.45),
    false,
    "объём неизвестен — прежнее поведение без изменений",
  );
  assert.equal(
    humanizeGatePassed({ ...ровный, words: 80, score: 30 }, 12, 0.45),
    false,
    "короткий фрагмент всё равно не проходит по score и штампам",
  );
});

test("aiTellScore проставляет объём текста", () => {
  const короткий = "Она вошла в комнату. Он посмотрел на неё.";
  const длинный = Array.from({ length: 60 }, (_, i) => `Предложение номер ${i} про героя и его дорогу в город.`).join(" ");
  assert.ok((aiTellScore(короткий).words ?? 0) < MIN_BURSTINESS_WORDS, "короткий текст помечен как короткий");
  assert.ok((aiTellScore(длинный).words ?? 0) >= MIN_BURSTINESS_WORDS, "длинный текст помечен как измеримый");
});

// --- «размышления» reasoning-моделей -----------------------------------------
test("reasoning-модели опознаются, обычные — нет", () => {
  assert.equal(isReasoningModel("deepseek-ai/deepseek-v4-flash-0731"), true);
  assert.equal(isReasoningModel("openai/gpt-oss-120b"), true);
  assert.equal(isReasoningModel("deepseek/deepseek-v3.2"), true);
  assert.equal(isReasoningModel("gemini-3.8-flash"), false);
  assert.equal(isReasoningModel("meta/llama-3.3-70b-instruct"), false);
});

test("поле отключения размышлений своё для каждого провайдера", () => {
  assert.deepEqual(reasoningDisableFields("openrouter", "deepseek/deepseek-v3.2"), {
    reasoning: { enabled: false },
  });
  assert.deepEqual(reasoningDisableFields("nvidia", "deepseek-ai/deepseek-v4-flash-0731"), {
    reasoning_effort: "none",
  });
  assert.deepEqual(reasoningDisableFields("nvidia", "meta/llama-3.3-70b-instruct"), {});
  assert.deepEqual(reasoningDisableFields("gemini", "gemini-3.8-flash"), {});
});

test("модель, отказавшаяся от поля, больше его не получает", () => {
  const model = "deepseek-ai/some-future-reasoner-99";
  assert.deepEqual(reasoningDisableFields("nvidia", model), { reasoning_effort: "none" });
  markReasoningDisableUnsupported("nvidia", model);
  assert.deepEqual(reasoningDisableFields("nvidia", model), {}, "после 400 поле снимается навсегда");
});

test("бюджет повтора удваивается и упирается в потолок", () => {
  assert.equal(reasoningRetryBudget("nvidia", "deepseek-ai/deepseek-v4-flash-0731", 6144), 12288);
  assert.equal(reasoningRetryBudget("openrouter", "deepseek/deepseek-v3.2", 40_000), REASONING_RETRY_MAX_TOKENS);
  assert.equal(reasoningRetryBudget("groq", "openai/gpt-oss-120b", 100), 200, "у Groq потолок TPM считается отдельно");
});

// --- ступени защиты на фиктивном fetch ---------------------------------------
type StubCall = { url: string; body: any };

function stubFetch(handler: (call: number, body: any) => { status?: number; payload: unknown }) {
  const calls: StubCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => {
    const body = JSON.parse(String(init?.body || "{}"));
    calls.push({ url: String(url), body });
    const { status = 200, payload } = handler(calls.length, body);
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(payload),
    } as any;
  }) as any;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const guardCall = (model: string, maxTokens: number) => callOpenAiStyleGuarded({
  provider: "nvidia",
  label: "NVIDIA",
  url: "https://example.invalid/chat/completions",
  headers: { Authorization: "Bearer test" },
  model,
  params: { contents: "Привет" },
  maxTokens,
  timeoutMs: 2_000,
  withJsonFormat: false,
  buildBody: (budget, extra) => ({ model, messages: [], max_tokens: budget, ...extra }),
});

test("пустой ответ при finish_reason=length повторяется с удвоенным бюджетом", async () => {
  const stub = stubFetch((call) => call === 1
    ? { payload: { choices: [{ message: { content: "   " }, finish_reason: "length" }] } }
    : { payload: { choices: [{ message: { content: "  Готовый текст  " }, finish_reason: "stop" }] } });
  try {
    const result = await guardCall("deepseek-ai/deepseek-v4-flash-0731", 2048);
    assert.equal(stub.calls.length, 2, "пустой раунд должен получить ровно один повтор");
    assert.equal(stub.calls[0].body.max_tokens, 2048);
    assert.equal(stub.calls[0].body.reasoning_effort, "none", "размышления гасим сразу");
    assert.equal(stub.calls[1].body.max_tokens, 4096, "повтор идёт с удвоенным бюджетом");
    assert.equal(result.text, "Готовый текст");
    assert.equal(result.finishReason, "stop");
  } finally {
    stub.restore();
  }
});

test("модель, не принявшая поле отключения размышлений, повторяется без него", async () => {
  const model = "deepseek-ai/guard-test-model-400";
  const stub = stubFetch((call) => call === 1
    ? { status: 400, payload: { error: { message: "Unrecognized field reasoning_effort" } } }
    : { payload: { choices: [{ message: { content: "Текст без размышлений" }, finish_reason: "stop" }] } });
  try {
    const result = await guardCall(model, 1024);
    assert.equal(stub.calls.length, 2);
    assert.equal(stub.calls[0].body.reasoning_effort, "none");
    assert.equal("reasoning_effort" in stub.calls[1].body, false, "повтор идёт без поля");
    assert.equal(result.text, "Текст без размышлений");
    // второй вызов той же модели уже не тратит попытку на поле
    const again = stubFetch(() => ({ payload: { choices: [{ message: { content: "ок" }, finish_reason: "stop" }] } }));
    try {
      await guardCall(model, 1024);
      assert.equal("reasoning_effort" in again.calls[0].body, false);
    } finally {
      again.restore();
    }
  } finally {
    stub.restore();
  }
});
