import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRewritePrompt,
  buildTargetedRewritePrompt,
  deterministicChecks,
  priorityStyleBlockIndexes,
  priorityStyleMatches,
  reassembleText,
  selectStyleExcerpts,
  splitTextStructure,
  validateProfileRequest,
  validateRewriteRequest,
} from "../server/authorPipeline";

test("text structure keeps every original line break run", () => {
  const source = "Первая строка.\n\nВторая.\n— Реплика.\n\n\nФинал.";
  const structure = splitTextStructure(source);
  assert.equal(reassembleText([...structure.blocks], structure.separators), source);
  assert.equal(structure.blocks.length, structure.separators.length + 1);
});

test("reassembly rejects a changed block count", () => {
  assert.throws(() => reassembleText(["один"], ["\n\n"]), /структуру/u);
});

test("profile and rewrite requests enforce safe size and sample constraints", () => {
  assert.throws(() => validateProfileRequest({ action: "profile", sample: "мало", styleDescription: "" }), /300/u);
  const valid = validateRewriteRequest({
    action: "rewrite",
    sourceText: "Достаточно длинный исходный художественный фрагмент.",
    authorSample: "а".repeat(300),
    protectedTerms: ["Лабиринт", "Лабиринт", ""],
    strength: "balanced",
    instructions: "",
    context: {},
  });
  assert.deepEqual(valid.protectedTerms, ["Лабиринт"]);
});

test("deterministic checks catch lost terms and changed numbers", () => {
  const checks = deterministicChecks("Лабиринт: заряд 3%.", "Коридор: заряд 2%.", ["Лабиринт"]);
  assert.deepEqual(checks.missingTerms, ["Лабиринт"]);
  assert.deepEqual(checks.missingNumbers, ["3%"]);
  assert.deepEqual(checks.addedNumbers, ["2%"]);
});

test("style excerpts are bounded and do not return the entire oversized sample", () => {
  const sample = Array.from({ length: 20 }, (_, index) => `Абзац ${index}. ${"текст ".repeat(30)}`).join("\n\n");
  const excerpts = selectStyleExcerpts(sample, "— Идём дальше, — сказал я.", 900);
  assert.ok(excerpts.length <= 900);
  assert.ok(excerpts.length > 0);
});

test("style excerpts follow the paragraph scale of the source chapter", () => {
  const sample = [
    "Коротко. И прямо.",
    "Длинный абзац с последовательным описанием действий героя, который сначала проверил телефон, затем ощупал стену и только после этого решился идти дальше в темноту.".repeat(3),
    "Ещё одна короткая реплика.",
  ].join("\n\n");
  const source = "Предыдущая глава содержит развёрнутые абзацы с несколькими связанными действиями и наблюдениями героя.".repeat(4);
  const excerpts = selectStyleExcerpts(sample, source, 2000);
  assert.match(excerpts, /последовательным описанием/);
});

test("deep rewrite requires stylistic work beyond spelling corrections", () => {
  const request = validateRewriteRequest({
    action: "rewrite",
    sourceText: "Исходный текст для глубокой редакторской проверки.",
    authorSample: "Авторский образец. ".repeat(30),
    styleDescription: "",
    protectedTerms: [],
    strength: "deep",
    instructions: "",
    context: {},
  });
  const prompt = buildRewritePrompt(request, {
    summary: "Краткий голос",
    voiceRules: [],
    avoid: [],
    evidence: [],
  }, {}, { blocks: [request.sourceText], separators: [] });
  assert.match(prompt, /содержательную стилистическую редактуру/u);
  assert.match(prompt, /а не орфографическую корректуру/u);
  assert.match(prompt, /олицетворения абстрактных чувств/u);
});

test("deep targeted pass isolates locally flagged formulaic blocks", () => {
  const blocks = [
    "Обычный авторский абзац.",
    "Паника наконец прорвала плотину моего разума.",
    "Только тишина, густая и равнодушная.",
  ];
  const indexes = priorityStyleBlockIndexes(blocks);
  assert.deepEqual(indexes, [1, 2]);
  assert.deepEqual(priorityStyleMatches(blocks[1]), ["прорвала плотину"]);
  const request = validateRewriteRequest({
    action: "rewrite",
    sourceText: blocks.join("\n\n"),
    authorSample: "Авторский образец. ".repeat(30),
    styleDescription: "",
    protectedTerms: [],
    strength: "deep",
    instructions: "",
    context: {},
  });
  const prompt = buildTargetedRewritePrompt(request, {
    summary: "Краткий голос",
    voiceRules: [],
    avoid: [],
    evidence: [],
  }, {}, blocks, indexes);
  assert.match(prompt, /ровно 2 переработанных текстов/u);
  assert.match(prompt, /Не ограничивайся орфографией/u);
  assert.match(prompt, /matchedFormulas/u);
  assert.match(prompt, /прорвала плотину/u);
  assert.match(prompt, /Не добивайся лаконичности простым удалением/u);
});
