/**
 * Сборка 119: реплика пишется тем знаком, каким пишет автор.
 *
 * Живой случай 05.10.2026 (глава 4, сборка 118): у автора 63 реплики дефисом и
 * ни одного тире (`Вася.txt`, главы 1–3), а в готовой главе — 54 тире и ни одного
 * дефиса. Причина была не в модели и не в её Lite-тиках, а в промпте: строка
 * «ПРЯМАЯ РЕЧЬ С ТИРЕ, БЕЗ КАВЫЧЕК» была вшита в `buildScenePrompt` жёстко,
 * при этом директива по образцу автора (`speechMarkDirective`) была написана,
 * покрыта тестами и не вызывалась ни разу — был только импорт.
 *
 * Плюс вторая половина того же дефекта: `isMarkedSpeech` считает тире и дефис
 * одинаково «размеченной репликой». Для вопроса «а размечена ли речь» это
 * верно, для вопроса «это манера автора» — нет, и гейт молчал.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  authorSpeechMark,
  speechMarkDirective,
  speechMarkMismatch,
} from "../server/proseRegister";
import { speechParagraphShare, verifyChapter } from "../server/chapterVerdict";
import { buildScenePrompt } from "../server/chapterGenerate";
import type { ChapterBeat } from "../server/chapterGenerate";

/** Живой автор: 170 строк, реплики дефисом. Сокращённый, но с той же структурой. */
const AUTHOR_SAMPLE = [
  "Вечер пятницы не задался с самого начала.",
  "- Не поехал я, на автобус опоздал, - пробурчал Васька.",
  "- Ладно, - сказал он, - только идём быстро.",
  "Они двинулись по тропе, и трава была мокрая.",
  "- Илюх, ты слышал вообще?",
  "- Слышу, - ответил Илюха, - и не нравится мне это.",
].join("\n");

const BEAT: ChapterBeat = { title: "Тропа", goal: "идти", hook: "шаги", endsWith: "молчание" };

function scenePromptFor(sample: string): string {
  return buildScenePrompt(
    {
      title: "Глава 4",
      genre: "x",
      description: "",
      currentChapterTitle: "",
      currentChapterSummary: "",
      previousChapter: "",
      worldBible: "",
      bookPlan: "",
      canonDossier: "",
      customPrompt: "",
      authorSample: sample,
      model: "gemini-3.8-flash",
    },
    BEAT,
    0,
    3,
    "",
    "",
  );
}

test("authorSpeechMark читает знак из строк автора, а не из глав", () => {
  // У автора абзац = строка: делить по пустым строкам нельзя, иначе реплики
  // не видны вовсе (в `Вася.txt` 170 строк и всего 8 пустых).
  assert.deepEqual(authorSpeechMark(AUTHOR_SAMPLE), { mark: "-", long: 0, short: 4 });

  const withLong = "— Погоди.\n— Жду.\n— Тише.\n- Понял.\n- Слышу.\n- Ладно.\n- Погоди.\n— Жду.\n— Тише.\n— Тише.";
  assert.equal(authorSpeechMark(withLong).mark, "—");
});

test("промпт сцены просит знак автора, а не тире по умолчанию", () => {
  const prompt = scenePromptFor(AUTHOR_SAMPLE);

  assert.match(prompt, /со знака «-»/u, "в промпте должен быть знак из образца");
  assert.match(prompt, /в образце 4 реплик дефисом/, "промпт называет замер");
  // Кавычки запрещены отдельно от знака: знак задаёт образец, кавычки — всегда.
  assert.match(prompt, /Кавычки-ёлочки «…» не ставь нигде/u);
  // Строка, из-за которой в главе оказалось 54 тире вместо дефисов.
  assert.doesNotMatch(prompt, /ПРЯМАЯ РЕЧЬ С ТИРЕ/u, "жёсткого требования тире быть не должно");
});

test("промпт без образца просит тире — как пишет русская проза вообще", () => {
  assert.match(scenePromptFor(""), /«—»/u);
});

test("speechMarkMismatch ловит чужой знак и молчит на author's манере", () => {
  const withEmDash = [
    "Они шли по тропе.",
    "— Не поехал я, на автобус опоздал, — пробурчал Васька.",
    "— Ладно, — сказал он, — идём.",
    "Трава была мокрая под ногами.",
    "— Илюх, ты слышал?",
  ].join("\n");

  const mismatch = speechMarkMismatch(withEmDash, AUTHOR_SAMPLE);
  assert.match(mismatch, /знак реплики не тот/u);
  assert.match(mismatch, /пиши реплики со знаком «-»/u);

  // На самом author's тексте и на тексте с правильным знаком — тишина.
  assert.equal(speechMarkMismatch(AUTHOR_SAMPLE, AUTHOR_SAMPLE), "");
  const correct = [
    "Они шли по тропе.",
    "- Не поехал я, - пробурчал Васька.",
    "- Ладно, - сказал он.",
    "Трава была мокрая.",
    "- Илюх, ты слышал?",
  ].join("\n");
  assert.equal(speechMarkMismatch(correct, AUTHOR_SAMPLE), "");
});

test("speechMarkMismatch не ругается, когда сверять не с чем", () => {
  const prose = "Он шёл по тропе. Трава была мокрая. Ветер пах дождём. Фонарь погас.";
  assert.equal(speechMarkMismatch(prose, ""), "");
});

test("speechParagraphShare считает по строкам, а у автора даёт 37 %", () => {
  // Живой замер на `Вася.txt`: 63 реплики из 170 блоков = 37 %.
  const lines = [
    "Обычная строка один.",
    "- Реплика.",
    "Обычная строка два.",
    "Обычная строка три.",
    "- Реплика два.",
    "Обычная строка четыре.",
    "Обычная строка пять.",
    "Обычная строка шесть.",
    "- Реплика три.",
    "Обычная строка семь.",
    "- Реплика четыре.",
    "Обычная строка восемь.",
    "Обычная строка девять.",
    "Обычная строка десять.",
    "- Реплика пять.",
  ].join("\n");
  const share = speechParagraphShare(lines);
  assert.ok(Math.abs(share - 5 / 15) < 1e-9, `ожидалось 5 из 15, получено ${share}`);

  // Тот же текст, разбитый пустыми строками, должен дать тот же ответ:
  // раньше одних пустых строк было мало, и доля уезжала в ноль.
  const paragraphs = lines.split("\n").join("\n\n");
  assert.equal(speechParagraphShare(paragraphs), share);
});

test("сверка главы показывает раздутый диалог как потолок", () => {
  // Глава 4 сборки 118: 54 реплики из 99 абзацев = 55 % при пороге 50.
  const blocks: string[] = [];
  for (let index = 0; index < 10; index += 1) blocks.push(`— Реплика номер ${index} подряд и очень длинная, чтобы блок был настоящим абзацем.`);
  for (let index = 0; index < 8; index += 1) blocks.push(`Обычный абзац номер ${index}, в котором идёт описание и ничего не происходит.`);
  const text = blocks.join("\n\n");

  const verdict = verifyChapter(text);
  const cap = verdict.caps.find((entry) => entry.id === "speech-share");

  assert.ok(cap, "потолок доли реплик должен быть в сверке");
  assert.equal(cap.ok, false, "55 % реплик — это провал потолка");
  assert.match(cap.advice, /собери две соседние реплики/u);
});

test("сверка главы не ругается на диалог в пределах нормы", () => {
  const blocks: string[] = [];
  for (let index = 0; index < 6; index += 1) blocks.push(`— Реплика номер ${index} подряд и очень длинная, чтобы блок был настоящим абзацем.`);
  for (let index = 0; index < 8; index += 1) blocks.push(`Обычный абзац номер ${index}, в котором идёт описание и ничего не происходит.`);
  const verdict = verifyChapter(blocks.join("\n\n"));
  const cap = verdict.caps.find((entry) => entry.id === "speech-share");

  assert.equal(cap?.ok, true, "43 % реплик — в пределах нормы");
});