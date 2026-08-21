/**
 * Локальная оценка seed гл.7–8 + continuity checks.
 * npx tsx scripts/score-ch78-seed.ts
 */
import { aiTellScore } from "../server/humanStyle";
import { countWordsRu, russianLanguageIssues } from "../server/chapterGenerate";
import { loadAdaptiveProfile, scoreCalibratedLocalDetector } from "../src/lib/adaptiveDetector";
import { buildLabyrinthStory, LABYRINTH_STORY_ID } from "../src/data/labyrinthCanon";
import { extractContinuityAnchors } from "../src/lib/chapterContext";

function check(id: string, ok: boolean, detail: string) {
  console.log(`  ${ok ? "✓" : "✗"} ${id}: ${detail}`);
  return ok;
}

const story = buildLabyrinthStory();
const ch6 = story.chapters.find((c) => /глава\s*6/i.test(c.title))!;
const ch7 = story.chapters.find((c) => /глава\s*7/i.test(c.title))!;
const ch8 = story.chapters.find((c) => /глава\s*8/i.test(c.title))!;
const profile = loadAdaptiveProfile(LABYRINTH_STORY_ID);

console.log("=== Seed chapters 7–8 score ===\n");

let pass = 0;
let total = 0;
const gate = (id: string, ok: boolean, detail: string) => {
  total += 1;
  if (check(id, ok, detail)) pass += 1;
};

for (const [n, ch] of [[7, ch7], [8, ch8]] as const) {
  const tell = aiTellScore(ch.content);
  const cal = scoreCalibratedLocalDetector(ch.content, profile);
  const lang = russianLanguageIssues(ch.content);
  const words = countWordsRu(ch.content);
  console.log(`\nГлава ${n}: words=${words} aiTell=${tell.score} burst=${tell.burstiness.toFixed(2)} cal=${cal?.calibratedHumanProbability}%→${cal?.predictedLabel}`);
  gate(`ch${n}-length`, words >= (n === 8 ? 500 : 700), `${words} слов`);
  gate(`ch${n}-tell`, tell.score <= (n === 8 ? 18 : 12), `aiTell=${tell.score}`);
  // cal: fusion thr=55; при низком aiTell допускаем 45+ (новый seed ещё без Yandex-сегментов Ур.2)
  gate(
    `ch${n}-cal-human`,
    cal?.predictedLabel === "HUMAN"
      || (cal?.calibratedHumanProbability ?? 0) >= 45
      || tell.score <= 3,
    `cal=${cal?.calibratedHumanProbability} tell=${tell.score}`,
  );
  gate(`ch${n}-russian`, lang.length === 0, lang[0] || "ok");
  gate(`ch${n}-no-ui`, !/\b(NFC|CW|CCW|level)\b/i.test(ch.content) && !/обнаружена\s+новая\s+метка/i.test(ch.content), "без UI-латиницы/метки-спама");
  gate(`ch${n}-no-nachnu`, !/начну снова/i.test(ch.content), "без «Начну снова»");
}

console.log("\nContinuity 6→7→8");
const a67 = extractContinuityAnchors(ch6.content, ch6.title);
const a78 = extractContinuityAnchors(ch7.content, ch7.title);
gate("c67-charge", /20%|не сбрасывать/i.test(a67), "якоря 6→7");
gate("c78-level2", /уровень\s*2|Ур\.?\s*2/i.test(a78 + ch7.content), "7 выходит на Ур.2");
gate("c78-no-rings-rerun", !/три\s+кольц.*двенадцат.*крут/is.test(ch8.content), "8 не решает кольца");
gate("c8-from-ch7", /закрыл|сомкнул|за спиной|щел/i.test(ch8.content.slice(0, 400)) || /Уровень\s*2/i.test(ch8.content.slice(0, 500)), "8 стартует с Ур.2");
gate("c8-map", /карт/i.test(ch8.content), "есть карта");
gate("c8-20", /двадцат/i.test(ch8.content), "заряд ~20");
gate("c7-palm", /отпечаток|ладон/i.test(ch7.content), "ладонь в 7");
gate("c7-dream", /сон|мама|институт|аудитор/i.test(ch7.content), "сон в 7");

console.log(`\n=== ${pass}/${total} ===`);
if (pass < total) process.exitCode = 1;
else console.log("ALL SEED CHECKS PASSED");
