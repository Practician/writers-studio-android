/**
 * voicePassportV2.test.ts
 *
 * Unit-тесты для server/agent/voicePassportV2.ts
 * Запуск: npm test
 */

import test, { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildVoicePassportV2,
  voicePassportV2Block,
  analyzeWordFingerprint,
  analyzePunctuationPattern,
  analyzeDialogueProfile,
  analyzeParagraphRhythm,
  analyzeSyntaxPreferences,
} from "../server/agent/voicePassportV2";

const SAMPLE_TEXT = `
Она сидела у окна. Дождь барабанил по карнизу — глухо, мерно, будто отсчитывал последние минуты перед грозой.
— Ты ведь всё равно не пойдёшь? — спросил Алексей, не отрываясь от чертежей.
— Пойду, — ответила она тихо. — И ты это знаешь.
Он помолчал. Карандаш замер над белым листом бумаги.
— Там темно. И холодно...
— Я знаю. Но ждать больше нельзя.
`;

describe("voicePassportV2", () => {
  it("analyzeWordFingerprint извлекает структуру словаря", () => {
    const res = analyzeWordFingerprint(SAMPLE_TEXT);
    assert.ok(Array.isArray(res.characteristicWords));
    assert.ok(Array.isArray(res.avoidedCommonWords));
    assert.ok(Array.isArray(res.topAdjectives));
    assert.ok(Array.isArray(res.topVerbs));
  });

  it("analyzePunctuationPattern определяет пунктуацию", () => {
    const res = analyzePunctuationPattern(SAMPLE_TEXT);
    assert.ok(typeof res.emDashPer1k === "number");
    assert.ok(typeof res.ellipsisPer1k === "number");
    assert.ok(["mid", "end", "mixed"].includes(res.ellipsisPosition));
  });

  it("analyzeDialogueProfile определяет диалоговые характеристики", () => {
    const res = analyzeDialogueProfile(SAMPLE_TEXT);
    assert.ok(res.avgReplicaWords > 0);
    assert.ok(res.directSpeechShare > 0);
    assert.ok(Array.isArray(res.topDialogueTags));
  });

  it("analyzeParagraphRhythm считает вариацию длин абзацев", () => {
    const res = analyzeParagraphRhythm(SAMPLE_TEXT);
    assert.strictEqual(res.lengthDistribution.length, 5);
    assert.ok(typeof res.cv === "number");
    assert.ok(res.medianWords > 0);
  });

  it("analyzeSyntaxPreferences считает синтаксические доли", () => {
    const res = analyzeSyntaxPreferences(SAMPLE_TEXT);
    assert.ok(typeof res.gerundShare === "number");
    assert.ok(typeof res.participleShare === "number");
    assert.ok(typeof res.homogeneousShare === "number");
    assert.ok(typeof res.nominativeShare === "number");
  });

  it("buildVoicePassportV2 собирает полный паспорт автора", () => {
    const passport = buildVoicePassportV2("story-1", SAMPLE_TEXT);
    assert.strictEqual(passport.storyId, "story-1");
    assert.ok(passport.sampleCharCount > 0);
    assert.ok(passport.wordFingerprint);
    assert.ok(passport.punctuationPattern);
    assert.ok(passport.dialogueProfile);
    assert.ok(passport.paragraphRhythm);
    assert.ok(passport.syntaxPrefs);
  });

  it("voicePassportV2Block генерирует форматированный prompt block", () => {
    const passport = buildVoicePassportV2("story-1", SAMPLE_TEXT);
    const block = voicePassportV2Block(passport);
    assert.ok(typeof block === "string");
    assert.ok(block.includes("ПАСПОРТ ГОЛОСА АВТОРА v2"));
    assert.ok(block.includes("ПУНКТУАЦИЯ"));
    assert.ok(block.includes("ДИАЛОГИ"));
  });
});
