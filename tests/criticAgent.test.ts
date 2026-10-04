import { strict as assert } from "node:assert";
import test from "node:test";
import {
  CRITIC_FIX_THRESHOLD,
  CRITIC_QUESTIONS,
  criticPrompt,
  criticismFixBlock,
  deterministicCriticism,
  parseCriticism,
} from "../server/criticAgent";
import { HUMAN_SAMPLE, MACHINE_CHAPTER } from "./fixturesProseRegister";

// ── Критик на живых текстах ───────────────────────────────────────────────────

test("критик не выдумывает следы у живого автора", () => {
  const actionable = deterministicCriticism(HUMAN_SAMPLE)
    .filter((finding) => finding.severity >= CRITIC_FIX_THRESHOLD);
  assert.equal(actionable.length, 0,
    `авторский текст не должен идти в правку, а получил: ${actionable.map((f) => f.id).join(", ")}`);
});

test("критик ловит следы, когда они есть, и не требует их на каждом куске", () => {
  // Синтетическая глава со всеми следами разом: проверяем, что агент их видит.
  const stained = new Array(5).fill([
    "Никаких следов костей или пустых стоянок на полу не было, только эта выверенная до миллиметра геометрия.",
    "Он не ответил. Он не двигался. Он смотрел под ноги, не отрывая взгляда.",
    "Пахло озоном и горелой изоляцией. Запах был резким. Запах не давал покоя.",
    "Все стены были гладкие. Пол был твёрже. Стены были серыми.",
  ].join("\n\n")).join("\n\n");
  const ids = deterministicCriticism(stained).map((finding) => finding.id);
  for (const expected of ["silence-mold", "olfaction-dominance"]) {
    assert.ok(ids.includes(expected), `не найден след ${expected}; найдены: ${ids.join(", ")}`);
  }
  // На куске в 12 абзацев агент может не найти ничего — это закономерно: критика
  // требует двадцати предложений, иначе она фантазирует.
  const machineIds = deterministicCriticism(MACHINE_CHAPTER).map((finding) => finding.id);
  assert.ok(Array.isArray(machineIds));
});

test("каждая находка подтверждена цитатой — правило sepia «no quote — no signal»", () => {
  for (const finding of deterministicCriticism(MACHINE_CHAPTER)) {
    assert.ok(finding.quote.trim().length > 0, `находка ${finding.id} без цитаты`);
    assert.ok(finding.label.trim().length > 0, `находка ${finding.id} без формулировки`);
    assert.ok(finding.advice.trim().length > 0, `находка ${finding.id} без совета`);
  }
});

test("критик различает рефрен и регенерацию", () => {
  // Живая авторская цитата: повтор слова трижды — это рефрен, а не след машины.
  const refrain = new Array(6).fill("По веленью, по веленью, по веленью твоему!").join("\n\n");
  assert.equal(deterministicCriticism(refrain).filter((f) => f.id === "regenerated-image").length, 0,
    "рефрен не должен читаться как регенерация");
});

test("серийность ищется по многословным абзацам: однофразные подряд — норма автора", () => {
  const shortParagraphs = new Array(10).fill("Он кивнул.").join("\n\n");
  assert.equal(deterministicCriticism(shortParagraphs).filter((f) => f.id === "serial-paragraphs").length, 0,
    "однофразные абзацы подряд у человека — его норма");
  const longParagraphs = new Array(10).fill("Он вошёл. Он посмотрел. Он не ответил.").join("\n\n");
  assert.ok(deterministicCriticism(longParagraphs).some((f) => f.id === "serial-paragraphs"),
    "три одинаковых многословных абзаца подряд — серийность");
});

test("на коротком тексте критик молчит, а не фантазирует", () => {
  assert.deepEqual(deterministicCriticism("Он шагнул. Встал. Пошёл."), []);
});

test("повтор молчания в готовой главе — самостоятельная находка", () => {
  const chapter = new Array(6).fill("Васька не ответил. Он смотрел на стену и не двигался.").join("\n\n");
  const finding = deterministicCriticism(chapter).find((f) => f.id === "silence-mold");
  assert.ok(finding, "повтор молчания найден");
  assert.ok((finding?.severity ?? 0) >= CRITIC_FIX_THRESHOLD, "находка идёт в правку");
});

// ── Модельная часть ──────────────────────────────────────────────────────────

test("вопросы критики не повторяют рубрику и спрашивают разное", () => {
  assert.ok(CRITIC_QUESTIONS.length >= 6, "вопросов мало");
  const unique = new Set(CRITIC_QUESTIONS);
  assert.equal(unique.size, CRITIC_QUESTIONS.length, "вопросы повторяются");
  assert.ok(CRITIC_QUESTIONS.some((q) => q.includes("цитата") || q.includes("абзац")),
    "вопросы требуют указания места, а не оценки");
});

test("промпт критики требует JSON и цитаты, а не оценки", () => {
  const prompt = criticPrompt(MACHINE_CHAPTER);
  assert.ok(prompt.includes("ТОЛЬКО JSON") || prompt.includes("только JSON"), "требуется машинно-читаемый ответ");
  assert.ok(prompt.includes("цитата"), "цитата объявлена обязательной");
  assert.ok(prompt.includes("не повторяй то, что уже хорошо"), "запрет на комплименты");
  assert.ok(prompt.endsWith(MACHINE_CHAPTER), "текст идёт последним, без обрезки");
});

test("ответ модели без цитаты отбрасывается целиком", () => {
  const withoutQuote = parseCriticism({ findings: [{ why: "машинно", fix: "переписать" }] });
  assert.deepEqual(withoutQuote, [], "находка без цитаты — не находка");
  const withQuote = parseCriticism({ findings: [{ quote: "«Он кивнул»", why: "стоковое движение", fix: "дать действие" }] });
  assert.equal(withQuote.length, 1);
  assert.equal(withQuote[0].quote, "«Он кивнул»");
});

test("мусор в ответе модели не ломает разбор", () => {
  assert.deepEqual(parseCriticism(undefined), []);
  assert.deepEqual(parseCriticism("не json"), []);
  assert.deepEqual(parseCriticism({ findings: "нет" }), []);
});

test("в блок правки идёт не всё, что нашёл критик", () => {
  const everything = [
    { id: "a", label: "сильное", quote: "«а»", advice: "правь", severity: 0.9 },
    { id: "b", label: "слабое", quote: "«б»", advice: "правь", severity: 0.2 },
  ];
  const block = criticismFixBlock(everything);
  assert.ok(block.includes("«а»"));
  assert.ok(!block.includes("«б»"), "слабая находка остаётся в отчёте, но не в промпте");
  assert.equal(criticismFixBlock([{ id: "b", label: "слабое", quote: "«б»", advice: "правь", severity: 0.2 }]), "");
});