import { strict as assert } from "node:assert";
import test from "node:test";
import {
  describeGeminiKeyPool,
  describeShrink,
  isRequestTooLarge,
  shrinkPromptDetailed,
  splitApiKeyPool,
  tooLargeRatio,
} from "../src/lib/directLlmClient";

/**
 * Сборка 117: разбор каскада провайдеров.
 *
 * Живой сбой 05.10.2026, 02:31–02:33: сцена 7 не была написана, потому что
 * Groq отверг запрос по размеру («TPM: Limit 8000, Requested 8326»), а обработки
 * такого отказа в приложении не было вовсе. Вместо одного понятного отказа
 * каскад ушёл по четырём провайдерам и двум минутам: Groq 400 → 413, NVIDIA
 * 410 → 504 → 200 с нулём символов, OpenRouter 402 → 200 с нулём символов.
 *
 * Второе, что заметил автор в том же прогоне: все запросы шли на «ключ 1/3»,
 * а второй и третий ключ не появлялись в журнале ни разу и не объяснялись.
 */

// ── Пул ключей ────────────────────────────────────────────────────────────────

test("разбор пула ключей называет каждый ключ и причину пропуска", () => {
  const pool = "AIzaSyB12345abcdefgh-aaaa\nAIzaSyB12345abcdefgh-bbbb";
  const lines = describeGeminiKeyPool(pool, "gemini-3.8-flash");
  assert.ok(lines.length >= 3, `строк ${lines.length}`);
  assert.ok(lines[0].includes("Ключей Gemini: 2"), lines[0]);
  assert.ok(lines.some((line) => line.includes("ключ 1/2")), "первый ключ назван");
  assert.ok(lines.some((line) => line.includes("ключ 2/2")), "второй ключ назван");
  assert.ok(lines.some((line) => line.includes("годных ключей")), "итог назван");
});

test("три ключа одного проекта: предупреждение, что квота одна", () => {
  // Именно это объясняет, почему «запасной ключ» не помогает при исчерпанной
  // дневной квоте: у Gemini квота считается по проекту, а не по ключу.
  const pool = [
    "AIzaSyB12345abcdefgh-aaaa",
    "AIzaSyB12345abcdefgh-bbbb",
    "AIzaSyB12345abcdefgh-cccc",
  ].join("\n");
  const lines = describeGeminiKeyPool(pool, "gemini-3.8-flash");
  assert.ok(lines.some((line) => line.includes("ВНИМАНИЕ") && line.includes("одного проекта")),
    `ожидалось предупреждение о единой квоте; получено:\n${lines.join("\n")}`);
});

test("ключи разных проектов: предупреждения нет, проекты названы", () => {
  const pool = "AIzaSyB12345abcdefgh-a\nAIzaSyC99999zzzzzzzz-w";
  const lines = describeGeminiKeyPool(pool, "gemini-3.8-flash");
  assert.ok(!lines.some((line) => line.includes("ВНИМАНИЕ")), "ложной тревоги быть не должно");
  assert.ok(lines.some((line) => line.includes("Проектов: 2")), "раздельные квоты названы");
});

test("один ключ или пустой пул: разбор не занимает журнал", () => {
  assert.deepEqual(describeGeminiKeyPool("AIzaSyB12345-zzz", "gemini-3.8-flash"), [],
    "при одном ключе разбирать нечего");
  assert.deepEqual(describeGeminiKeyPool("", "gemini-3.8-flash"), []);
});

test("ключи разделяются по переводу строки, запятой и точке с запятой", () => {
  assert.equal(splitApiKeyPool("a\nb").length, 2);
  assert.equal(splitApiKeyPool("a,b").length, 2);
  assert.equal(splitApiKeyPool("a;b").length, 2);
  assert.equal(splitApiKeyPool("a\na").length, 1, "повтор ключа не удваивает пул");
});

// ── «Запрос не влезает» ───────────────────────────────────────────────────────

test("HTTP 413 и «context length» опознаются как слишком большой запрос", () => {
  // Живой отказ Groq 05.10.2026: «Request too large … TPM: Limit 8000,
  // Requested 8326» приходит именно кодом 413, а не текстом ошибки.
  assert.equal(isRequestTooLarge(413), true);
  assert.equal(isRequestTooLarge(413, { error: { message: "Request too large" } }), true);
  assert.equal(isRequestTooLarge(400, { error: { code: "context_length_exceeded" } }), true);
  assert.equal(isRequestTooLarge(400, { error: { message: "This model's maximum context length is 8192 tokens" } }), true);
});

test("предел из текста ошибки Groq превращается в долю с запасом", () => {
  // Живой отказ 05.10.2026: «TPM: Limit 8000, Requested 8326». Без этих чисел
  // сжатие шло «на глаз» и на живой сцене вырезало образец авторской манеры
  // ради того, чтобы отнять 5 %, — а это ровно то, за что борется вся сборка.
  const ratio = tooLargeRatio({ error: { message: "Request too large for model `openai/gpt-oss-120b` in organization `org_01kxg0ht96fkbr2jsmpz7kmg1a` service tier `on_demand` on tokens per minute (TPM): Limit 8000, Requested 8326, please reduce your message size and try again." } });
  assert.ok(ratio !== undefined);
  assert.ok(ratio > 0.9 && ratio < 1, `ожидалось около 0,91; получено ${ratio}`);
});

test("предел контекста читается из ответа другой формы", () => {
  const ratio = tooLargeRatio({ error: { message: "This model's maximum context length is 32768 tokens. However, you requested 35000 tokens." } });
  assert.ok(ratio !== undefined && ratio > 0.85 && ratio < 1, `получено ${ratio}`);
});

test("нет чисел — доля не выдумывается, сжатие остаётся округлённым", () => {
  assert.equal(tooLargeRatio({ error: { message: "context length exceeded" } }), undefined);
  assert.equal(tooLargeRatio({ error: { message: "Limit abc, Requested xyz" } }), undefined);
  assert.equal(tooLargeRatio(undefined), undefined);
  // Предел больше запроса — сжатие не нужно, доля не превышает единицу.
  assert.equal(tooLargeRatio({ error: { message: "Limit 32000, Requested 8000" } }), 1);
});

test("чужие 400 и обычные статусы «запрос не влезает» — не считаются", () => {
  // Ротация по 400 от неверного JSON сожгла бы пул ключей впустую: это ошибка
  // запроса, а не его размера.
  assert.equal(isRequestTooLarge(400, { error: { message: "Invalid JSON payload" } }), false);
  assert.equal(isRequestTooLarge(400, { error: { code: "API_KEY_INVALID" } }), false);
  assert.equal(isRequestTooLarge(401), false);
  assert.equal(isRequestTooLarge(429), false);
  assert.equal(isRequestTooLarge(503), false);
  assert.equal(isRequestTooLarge(200), false);
});

// ── Сжатие промпта ────────────────────────────────────────────────────────────

const SCENE_PROMPT_SHAPE = (sampleRepeat: number): string => [
  "Напиши фрагмент главы (бит 2 из 12).",
  "Продолжай сразу после этого хвоста:",
  '"""',
  "СТАРТ ".repeat(200),
  "КОНЕЦ-STYK",
  '"""',
  "Канон и контекст:",
  `- Замок канона (фрагмент): ${"кан".repeat(1200)}`,
  `- Библия мира (фрагмент): ${"мир".repeat(800)}`,
  "ОБРАЗЕЦ АВТОРСКОЙ МАНЕРЫ:",
  '"""',
  "Авторский кусок. ".repeat(sampleRepeat),
  '"""',
  "Требования:",
  "1. Только текст прозы.",
].join("\n");

test("сжатие промпта сцены урезает хвост главы и канон, голос не трогая", () => {
  // Метки берутся из buildScenePrompt. Первая версия сжатия искала блоки
  // <DATA role="author-sample">, которых в промпте нет, и не вырезала ничего —
  // то есть повторяла запрос, который уже отвергли.
  const prompt = SCENE_PROMPT_SHAPE(400);
  const { text, steps } = shrinkPromptDetailed(prompt, 0.9);
  assert.ok(text.length < prompt.length, `стало ${text.length} из ${prompt.length}`);
  assert.deepEqual(steps.map((step) => step.label), [
    "хвост предыдущей главы урезан до 600 знаков",
    "замок канона урезан до 1400 знаков",
    "библия мира урезана до 800 знаков",
  ], "режется по порядку цены: хвост, канон, библия мира");
  assert.ok(text.includes("ОБРАЗЕЦ АВТОРСКОЙ МАНЕРЫ"), "бюджет достигнут — голос остаётся");
  assert.ok(text.includes("Авторский кусок."), "выдержка не срезана вместе с хвостом главы");
  assert.ok(text.includes("Требования:"), "требования должны остаться");
  assert.ok(text.includes("КОНЕЦ-STYK"), "конец хвоста главы держит стык");
  assert.ok(text.includes("Напиши фрагмент главы"), "задача остаётся");
  assert.ok(describeShrink(steps).includes("знаков"), "итог сжатия описывается словами");
});

test("авторские выдержки снимаются последними, только если иначе не влезает", () => {
  const prompt = SCENE_PROMPT_SHAPE(4_000);
  const { text, steps } = shrinkPromptDetailed(prompt, 0.6);
  const last = steps[steps.length - 1];
  assert.ok(last.label.includes("образец авторской манеры"), `шаги: ${steps.map((step) => step.label).join(", ")}`);
  assert.ok(!text.includes("ОБРАЗЕЦ АВТОРСКОЙ МАНЕРЫ"), "выдержки должны уйти");
  assert.ok(text.includes("Требования:"), "требования переживают снятие голоса");
});

test("короткий промпт не трогается", () => {
  const prompt = "Напиши фрагмент главы.\nТребования:\n1. Только проза.";
  const { text, steps } = shrinkPromptDetailed(prompt, 0.72);
  assert.equal(text, prompt, "промпт, укладывающийся в лимит, должен уйти без изменений");
  assert.deepEqual(steps, []);
});
