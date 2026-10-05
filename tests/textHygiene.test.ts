import test from "node:test";
import assert from "node:assert/strict";
import { humanizeProseDraft } from "../server/chapterGenerate";
import { sanitizeGeneratedText } from "../server/textHygiene";

test("sanitizeGeneratedText removes hidden directional characters and normalizes whitespace", () => {
  const source = "Первый\u200B абзац\u2060.\r\nВторой\u00A0абзац\u202E.";
  const result = sanitizeGeneratedText(source);

  assert.equal(result.text, "Первый абзац.\nВторой абзац.");
  assert.equal(result.report.removedHiddenCharacters, 3);
  assert.equal(result.report.normalizedSpaces, 1);
  assert.equal(result.report.normalizedLineEndings, true);
  assert.equal(result.report.changed, true);
});

test("sanitizeGeneratedText preserves emoji ZWJ sequences and ordinary text", () => {
  const source = "Автор 👩‍💻 оставил строку без скрытых меток.";
  const result = sanitizeGeneratedText(source);

  assert.equal(result.text, source);
  assert.equal(result.report.removedHiddenCharacters, 0);
  assert.equal(result.report.changed, false);
});

test("humanizeProseDraft always runs final Unicode hygiene", async () => {
  const source = "Я вошёл в комнату\u200B и услышал, как ключ звенит в кармане.";
  const generate = async () => JSON.stringify({ blocks: [source] });

  const result = await humanizeProseDraft(source, generate as any, {
    model: "mock",
    personaBlock: "",
    humanizeDepth: "fast",
  });

  assert.equal(result.text.includes("\u200B"), false);
  assert.equal(result.humanizeReport.textHygiene.removedHiddenCharacters, 1);
  assert.equal(result.humanizeReport.textHygiene.changed, true);
});

// Сборка 118. Живой DOCX главы 4 (05.10.2026) содержал 8 буквальных `**`
// на 19 300 знаков: `боясь спугнуть **трепет**`, `от **тревоги**`.
test("sanitizeGeneratedText снимает markdown-выделение в прозе", () => {
  const source = "Васька промолчал, боясь спугнуть **трепет**; воздух стал плотнее.";
  const result = sanitizeGeneratedText(source);

  assert.equal(result.text, "Васька промолчал, боясь спугнуть трепет; воздух стал плотнее.");
  assert.equal(result.report.fixedPunctuationArtifacts, 1);
  assert.match(result.report.punctuationNotes.join(" "), /markdown-выделение снято/);
});

test("sanitizeGeneratedText не трогает знак ударения и знак умножения", () => {
  // Живая речь пишет ударение без пробела, а «2 ** 3» — не выделение.
  const stress = "Он смотрел на тём* небо и не двигался.";
  assert.equal(sanitizeGeneratedText(stress).text, stress);

  const multiply = "Умножение 2 ** 3 даёт шесть.";
  assert.equal(sanitizeGeneratedText(multiply).text, multiply);

  assert.equal(sanitizeGeneratedText("Обычный абзац.").report.fixedPunctuationArtifacts, 0);
});

test("sanitizeGeneratedText снимает выделение внутри прямой речи", () => {
  const source = "Он крикнул: «**Беги!**» и подался назад.";
  assert.equal(sanitizeGeneratedText(source).text, "Он крикнул: «Беги!» и подался назад.");
});

test("sanitizeGeneratedText возвращает ё однозначным словам", () => {
  const result = sanitizeGeneratedText("Костер развели не сразу. Все молчали.");

  assert.equal(result.text, "Костёр развели не сразу. Все молчали.");
  // «Все» — омограф (все/всё), его не трогаем: восстановлено только «Костер».
  assert.equal(result.report.restoredYo, 1);
  assert.match(result.report.punctuationNotes.join(" "), /ё восстановлено/);
  assert.equal(result.report.changed, true);
});

test("sanitizeGeneratedText не трогает текст без кандидатов на ё", () => {
  const source = "Обычный абзац без меток.";
  const result = sanitizeGeneratedText(source);

  assert.equal(result.text, source);
  assert.equal(result.report.restoredYo, 0);
});
