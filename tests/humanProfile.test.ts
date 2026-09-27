import test from "node:test";
import assert from "node:assert/strict";
import { HUMAN_PROFILE, humanProfileScore } from "../server/humanStyleEnhanced";
import { isAcceptableRewrite } from "../server/chapterGenerate";
import { pickBestVariant } from "../server/humanStyle";

/** Ровный текст: короткие фразы одной длины — так выглядит сплющенная правка модели. */
const FLAT = "Илья шёл. Свет гас. Он считал. Ветер стих. Шаги звучали. Было тихо. Он встал. Он ждал. Он молчал.";
/** Живой текст: фразы разной длины — как в размеченных HUMAN-сегментах главы 4. */
const VARIED = "Илья шёл по коридору и старался не задевать плечом осыпавшуюся штукатурку. Свет гас. Он считал шаги, чтобы не думать о том, что осталось за спиной, и сбивался на каждом третьем, потому что шаги всё равно звучали громче, чем нужно. Ветер стих. За стеной кто-то размеренно капал воду в железный таз, и от этого звука хотелось заорать.";

test("профиль фразы ставит живой абзац выше ровного", () => {
  assert.ok(humanProfileScore(VARIED) > humanProfileScore(FLAT));
});

test("константы профиля стоят между измеренными средними классов", () => {
  // Измерено на 96 размеченных сегментах главы 4: длина 13.20 (HUMAN) / 10.28 (AI),
  // разброс длин 6.45 (HUMAN) / 5.35 (AI).
  assert.ok(HUMAN_PROFILE.sentenceWordsMid > 10.28 && HUMAN_PROFILE.sentenceWordsMid < 13.2);
  assert.ok(HUMAN_PROFILE.sentenceSpreadMid > 5.35 && HUMAN_PROFILE.sentenceSpreadMid < 6.45);
  assert.ok(HUMAN_PROFILE.sentenceWordsScale > 0 && HUMAN_PROFILE.sentenceSpreadScale > 0);
});

test("правка, сплющивающая фразу, не проходит приёмку", () => {
  assert.equal(isAcceptableRewrite(VARIED, FLAT), false);
});

test("правка, не сплющивающая фразу, приёмку проходит", () => {
  const source = [FLAT, FLAT, FLAT].join(" ");
  const richer = `${source} Он всё-таки шагнул вперёд и толкнул дверь плечом.`;
  assert.equal(isAcceptableRewrite(source, richer), true);
});

test("best-of-N с профилем не выбирает сплющенный вариант", () => {
  assert.equal(pickBestVariant(VARIED, [FLAT], humanProfileScore), VARIED);
});
