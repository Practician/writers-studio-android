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
  analyzeSentenceRhythm,
  voicePassportCorridor,
  voiceFitIssues,
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

  it("analyzeSentenceRhythm даёт числа и живые примеры фраз", () => {
    const rhythm = analyzeSentenceRhythm(SAMPLE_TEXT);
    assert.ok(rhythm.meanWords > 0);
    assert.ok(rhythm.spreadWords >= 0);
    assert.ok(rhythm.shortExample.length > 0);
    assert.ok(rhythm.longExample.length > 0);
  });

  it("voicePassportV2Block печатает коридор и примеры автора", () => {
    const passport = buildVoicePassportV2("story-1", SAMPLE_TEXT);
    const block = voicePassportV2Block(passport);
    assert.ok(block.includes("КОРИДОР ЧЕРНОВИКА"));
    assert.ok(block.includes("КАК ЭТО ЗВУЧИТ У АВТОРА"));
  });

  it("коридор вмещает сам авторский образец", () => {
    const passport = buildVoicePassportV2("story-1", SAMPLE_TEXT);
    const corridor = voicePassportCorridor(passport);
    assert.ok(corridor.meanLo <= passport.sentenceRhythm.meanWords);
    assert.ok(passport.sentenceRhythm.meanWords <= corridor.meanHi);
    assert.deepEqual(voiceFitIssues(SAMPLE_TEXT, passport), []);
  });

  it("voiceFitIssues ловит сплющенный черновик", () => {
    const passport = buildVoicePassportV2("story-1", SAMPLE_TEXT);
    const flattened = [
      "Она сидела у окна и смотрела на дождь который барабанил по карнизу и отсчитывал последние минуты перед грозой и она думала о том что будет дальше и как ей жить после всего этого.",
      "Он молчал и держал карандаш над белым листом бумаги и не говорил ей ничего о том что собирался сказать ещё вчера вечером когда они возвращались домой вместе.",
      "Темнота за окном становилась всё плотнее и она понимала что ждать больше нельзя и что нужно решать сейчас или никогда и это было страшно и просто одновременно для них обоих.",
      "Она встала и подошла к двери и положила ладонь на холодную ручку и постояла так немного прежде чем выйти в коридор где горела одна единственная лампа под потолком.",
      "Он смотрел ей вслед и думал о том что сказал бы раньше если бы знал как всё обернётся и чем закончится этот вечер в старом доме у реки и на той стороне улицы.",
      "Дождь продолжал барабанить по карнизу и по стеклу и по жестяному подоконнику и она шла по улице не оборачиваясь и не позволяя себе думать о нём и о том что было.",
    ].join("\n\n");
    const issues = voiceFitIssues(flattened, passport);
    assert.ok(issues.length > 0, "сплющенный текст должен выйти из коридора");
    assert.ok(issues.join(" | ").includes("коридор"));
  });
});
