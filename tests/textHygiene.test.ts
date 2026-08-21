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
