import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAdaptiveWritingGuidance,
  createAdaptiveProfile,
  fitFusionWeight,
  learnFromDetectorReport,
  loadAdaptiveProfile,
  scoreCalibratedLocalDetector,
  scoreWithAdaptiveProfile,
} from "../src/lib/adaptiveDetector";
import { DetectorLabel, validateDetectorReport } from "../src/lib/detectorReport";
import { LABYRINTH_STORY_ID } from "../src/data/labyrinthCanon";

const humanText = [
  "Я вошёл в коридор и сразу задел плечом косяк. Было обидно, хотя винить, кроме себя, некого.",
  "— Ты опять торопишься? — спросила Лена. Я хотел огрызнуться, но только потёр ушиб и кивнул.",
  "На кухне пахло вчерашним кофе. Чашку я вымыл не сразу: сперва зачем-то открыл окно, потом вспомнил.",
].join(" ");

const aiText = [
  "Тишина медленно заполняла пространство, словно невидимая субстанция, проникающая в каждую часть окружающего мира.",
  "В этот самый момент герой осознал, что перед его лицом находится не просто препятствие, а символ внутреннего выбора.",
  "Важно отметить, что дальнейшие события развивались последовательно, демонстрируя глубокую трансформацию его эмоционального состояния.",
].join(" ");

function report(parts: Array<{ label: DetectorLabel; text: string }>) {
  const counts = { AI: 0, LIKELY_AI: 0, LIKELY_HUMAN: 0, HUMAN: 0, UNKNOWN: 0 };
  for (const part of parts) counts[part.label] += 1;
  return validateDetectorReport({
    time: "2026-07-15T00:00:00Z",
    filename: "chapter.txt",
    stats: {
      segments_count: parts.length - counts.UNKNOWN,
      AI_count: counts.AI,
      LIKELY_AI_count: counts.LIKELY_AI,
      LIKELY_HUMAN_count: counts.LIKELY_HUMAN,
      HUMAN_count: counts.HUMAN,
    },
    segments: parts.map((part) => ({ ...part, len: part.text.length })),
    short_text_warning: false,
    text_length: parts.reduce((sum, part) => sum + part.text.length, 0),
  });
}

test("adaptive detector learns HUMAN and AI centroids and deduplicates reports", () => {
  const source = report([
    { label: "HUMAN", text: humanText },
    { label: "AI", text: aiText },
  ]);
  const learned = learnFromDetectorReport(createAdaptiveProfile("story-1"), source);

  assert.equal(learned.learnedHuman, 1);
  assert.equal(learned.learnedAi, 1);
  assert.equal(learned.duplicate, false);
  assert.equal(learned.profile.human.count, 1);
  assert.equal(learned.profile.ai.count, 1);

  const duplicate = learnFromDetectorReport(learned.profile, source);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.profile.human.count, 1);
  assert.equal(duplicate.profile.ai.count, 1);
});

test("adaptive score prefers the class whose learned style is closer", () => {
  const learned = learnFromDetectorReport(createAdaptiveProfile("story-2"), report([
    { label: "LIKELY_HUMAN", text: humanText },
    { label: "LIKELY_AI", text: aiText },
  ])).profile;

  const humanScore = scoreWithAdaptiveProfile(humanText, learned);
  const aiScore = scoreWithAdaptiveProfile(aiText, learned);
  assert.ok(humanScore && aiScore);
  assert.ok(humanScore.humanProbability > 50);
  assert.ok(aiScore.humanProbability < 50);
  assert.ok(humanScore.humanProbability > aiScore.humanProbability);
  const guidance = buildAdaptiveWritingGuidance(learned);
  assert.match(guidance, /АДАПТИВНЫЙ ПРОФИЛЬ/);
  assert.match(guidance, /HUMAN 1, AI 1/);
});

test("adaptive learning ignores UNKNOWN and very short segments", () => {
  const learned = learnFromDetectorReport(createAdaptiveProfile("story-3"), report([
    { label: "UNKNOWN", text: "Слишком коротко." },
    { label: "HUMAN", text: "Тоже слишком коротко для устойчивого обучения." },
  ]));
  assert.equal(learned.learnedHuman, 0);
  assert.equal(learned.learnedAi, 0);
  assert.equal(learned.ignored, 2);
});

test("calibrated local detector fuses style and aiTell stamps", () => {
  const learned = learnFromDetectorReport(createAdaptiveProfile("story-4"), report([
    { label: "HUMAN", text: humanText },
    { label: "AI", text: aiText },
  ])).profile;
  const fusion = fitFusionWeight(
    [
      { text: humanText, human: true },
      { text: aiText, human: false },
      {
        text: "Это был не просто коридор. Волна ужаса накрыла меня, и время словно остановилось. Стоит отметить важное.",
        human: false,
      },
    ],
    learned,
  );
  const profile = { ...learned, version: 2 as const, fusion };
  const dirty = scoreCalibratedLocalDetector(
    "Это был не просто коридор. Волна ужаса накрыла меня, и время словно остановилось. В современном мире стоит отметить важное.",
    profile,
  );
  assert.ok(dirty);
  assert.ok(dirty.calibratedHumanProbability <= 50, `dirty should lean AI, got ${dirty.calibratedHumanProbability}`);
  assert.equal(dirty.predictedLabel, "AI");
  assert.ok(dirty.aiTellScore >= 10);
});

test("labyrinth story loads Yandex-calibrated seed profile", () => {
  const profile = loadAdaptiveProfile(LABYRINTH_STORY_ID);
  assert.ok(profile.human.count >= 3, `expected seed HUMAN examples, got ${profile.human.count}`);
  assert.ok(profile.ai.count >= 3, `expected seed AI examples, got ${profile.ai.count}`);
  assert.ok(profile.fusion, "fusion weights from Yandex calibration");
  const score = scoreCalibratedLocalDetector(humanText + " " + humanText, profile);
  assert.ok(score);
  assert.ok(typeof score.calibratedHumanProbability === "number");
});
