/**
 * voice-passport-probe.ts — прогон паспорта голоса на живых данных.
 *
 * 1. Собирает реальный промпт главы через buildPersonaAndStyle() и показывает, что
 *    детерминированный паспорт v2 в нём есть, с коридором и примерами автора.
 * 2. Считает коридор по авторскому образцу и меряет по нему главу из отчёта
 *    нейродетектора: что именно модель не удержала на первом проходе.
 *
 * Запуск: npx tsx scripts/voice-passport-probe.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { LABYRINTH_AUTHOR_SAMPLE } from "../src/data/labyrinthCanon";
import { buildPersonaAndStyle } from "../server/chapterGenerate";
import {
  buildVoicePassportV2,
  voiceFitIssues,
  voicePassportCorridor,
  voicePassportV2Block,
} from "../server/agent/voicePassportV2";

const REPORT = "/home/user/uploaded_files/result_chapter.json";

function collectTexts(node: unknown, acc: string[]): void {
  if (Array.isArray(node)) { node.forEach((item) => collectTexts(item, acc)); return; }
  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (typeof value === "string" && (key === "text" || key === "content" || key === "segment_text")) {
        acc.push(value);
      } else {
        collectTexts(value, acc);
      }
    }
  }
}

const sample = LABYRINTH_AUTHOR_SAMPLE.trim();
const passport = buildVoicePassportV2("probe", sample);
const corridor = voicePassportCorridor(passport);
const block = voicePassportV2Block(passport);

console.log("=== 1. ПАСПОРТ В ЖИВОМ ПРОМПТЕ ГЛАВЫ ===");
const assembled = buildPersonaAndStyle({
  title: "Проба",
  genre: "survival",
  description: "",
  currentChapterTitle: "Глава 1",
  currentChapterSummary: "",
  previousChapter: "",
  worldBible: "",
  bookPlan: "",
  canonDossier: "",
  customPrompt: "",
  authorSample: sample,
  model: "gemini-2.5-pro",
});
console.log(`образец: ${sample.length} знаков; блок v2: ${block.length} знаков`);
console.log(`statsBlock целиком: ${assembled.statsBlock.length} знаков`);
console.log(`паспорт v2 в промпте: ${assembled.statsBlock.includes("ПАСПОРТ ГОЛОСА АВТОРА v2") ? "ДА" : "НЕТ"}`);
console.log(`коридор в промпте: ${assembled.statsBlock.includes("КОРИДОР ЧЕРНОВИКА") ? "ДА" : "НЕТ"}`);
console.log(`примеры фраз в промпте: ${assembled.statsBlock.includes("КАК ЭТО ЗВУЧИТ У АВТОРА") ? "ДА" : "НЕТ"}`);

console.log("\n=== 2. КОРИДОР ПО ОБРАЗЦУ АВТОРА ===");
console.log(`средняя фраза: ${passport.sentenceRhythm.meanWords} слов, коридор ${corridor.meanLo}–${corridor.meanHi}`);
console.log(`разброс: ${passport.sentenceRhythm.spreadWords}, коридор ${corridor.spreadLo}–${corridor.spreadHi}`);
console.log(`короткие фразы: ${(passport.sentenceRhythm.shortShare * 100).toFixed(1)}%, коридор ${(corridor.shortLo * 100).toFixed(0)}–${(corridor.shortHi * 100).toFixed(0)}%`);
console.log(`частицы: ${passport.sentenceRhythm.particlesPer1k} на 1000, коридор ${corridor.particlesLo}–${corridor.particlesHi}`);
console.log(`восклицания: ${passport.sentenceRhythm.exclamationsPer1k} на 1000, коридор ${corridor.exclamationsLo}–${corridor.exclamationsHi}`);

console.log("\n=== 3. ГЛАВА ИЗ ОТЧЁТА ДЕТЕКТОРА ПРОТИВ КОРИДОРА ===");
if (!existsSync(REPORT)) {
  console.log(`отчёт не найден: ${REPORT} — замер не выполнен`);
} else {
  const texts: string[] = [];
  collectTexts(JSON.parse(readFileSync(REPORT, "utf8")), texts);
  const chapter = texts.join("\n\n");
  const issues = voiceFitIssues(chapter, passport);
  console.log(`сегментов: ${texts.length}, знаков главы: ${chapter.length}`);
  console.log(`нарушений коридора: ${issues.length}`);
  issues.forEach((issue) => console.log(` - ${issue}`));
}
