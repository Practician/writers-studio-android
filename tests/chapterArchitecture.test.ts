/** Архитектура главы: сепия-чек-листы должны доходить до живого промпта.
 *  До правки 21.09.2026 они были ре-экспортированы в server/humanStyle.ts и
 *  импортированы в src/lib/directLlmClient.ts, но не использовались нигде. */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHAPTER_ARCHITECTURE_FULL,
  CHAPTER_ARCHITECTURE_MOVES,
  architectureNotes,
  buildScenePrompt,
  providerOfModel,
  type ChapterGenerateInput,
} from "../server/chapterGenerate";

const beat = { title: "Тит", goal: "Цель", hook: "Зацепка", endsWith: "Итог" };

function fakeInput(model: string): ChapterGenerateInput {
  return {
    model,
    title: "Глава 4",
    currentChapterSummary: "Синопсис",
    canonDossier: "",
    worldBible: "",
    previousChapter: "",
  } as unknown as ChapterGenerateInput;
}

function promptFor(model: string, beatIndex: number): string {
  return buildScenePrompt(
    fakeInput(model),
    beat,
    beatIndex,
    8,
    "",
    "",
    "",
    "",
    { minWords: 350, maxWords: 520 },
  );
}

test("архитектурные приёмы идут тремя пунктами и меняются от бита к биту", () => {
  const first = architectureNotes(0);
  const second = architectureNotes(1);
  const third = architectureNotes(3);
  const lines = first.split("\n").slice(1);
  assert.equal(lines.length, 3);
  assert.match(first, /АРХИТЕКТУРА ГЛАВЫ/);
  for (const line of lines) {
    assert.ok(line.startsWith("- "), `строка без маркера: ${line}`);
    assert.ok(CHAPTER_ARCHITECTURE_MOVES.includes(line.slice(2)), `пункт не из списка: ${line}`);
  }
  assert.notEqual(first, second);
  assert.notEqual(first, third);
  // Соседние сцены не должны повторять одну тройку целиком.
  assert.notEqual(second, third);
});

test("провайдер пишущей модели определяет гайд по тикам", () => {
  assert.equal(providerOfModel("deepseek-ai/deepseek-v4-flash-0731"), "nvidia");
  assert.equal(providerOfModel("deepseek/deepseek-v3.2"), "nvidia");
  assert.equal(providerOfModel("gemini-3.8-flash"), "gemini");
  assert.equal(providerOfModel("openai/gpt-oss-120b"), "");
});

test("промпт сцены несёт три пункта архитектуры и тики своей модели", () => {
  const deepseek = promptFor("deepseek-ai/deepseek-v4-flash-0731", 2);
  assert.match(deepseek, /АРХИТЕКТУРА ГЛАВЫ/);
  assert.match(deepseek, /Особенности именно этой модели \(DeepSeek\)/);
  const gemini = promptFor("gemini-3.8-flash", 2);
  assert.match(gemini, /Особенности именно этой модели \(Gemini\)/);
  // Чужой гайд в текст не попадает: он портит письмо другой модели.
  const groq = promptFor("openai/gpt-oss-120b", 2);
  assert.doesNotMatch(groq, /Особенности именно этой модели/);
  assert.match(groq, /АРХИТЕКТУРА ГЛАВЫ/);
});

test("полный чек-лист главы собран из трёх частей", () => {
  assert.match(CHAPTER_ARCHITECTURE_FULL, /Признаки ИИ-прозы часто прячутся/);
  assert.match(CHAPTER_ARCHITECTURE_FULL, /Уровень связности между абзацами/);
  assert.match(CHAPTER_ARCHITECTURE_FULL, /Позитивные ориентиры человеческого письма/);
});
