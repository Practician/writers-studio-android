/**
 * Сборка 114 — сверка на живых материалах. Один прогон, который отвечает на
 * вопрос «что стало с главой 4 и с эталоном автора».
 *
 *   npx tsx scripts/verifyBuild114.ts [наш текст] [эталон]
 *
 * Печатает по каждому тексту: балл, гейт, профиль, потолки главы, находки
 * регистра, критику. Смысл таблицы — видна ли разница в том, где разница должна
 * быть, и не появилась ли она там, где её быть не должно.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { verifyChapter } from "../server/chapterVerdict";
import { deterministicCriticism, criticismFixBlock, CRITIC_FIX_THRESHOLD } from "../server/criticAgent";
import { sanitizeGeneratedText, punctuationHygieneNote } from "../server/textHygiene";
import { modelTier } from "../server/modelTier";
import { emptyChunkShare } from "../server/proseRegister";

const [, , oursPath, humanPath] = process.argv;
const defaultHuman = join(homedir(), "storage", "downloads", "Вася", "Вася.txt");
const load = (path: string): string =>
  readFileSync(path, "utf8").replace(/^﻿/, "").replace(/^Глава \d[^\n]*\n/u, "");

const ours = oursPath ? load(oursPath) : "";
const human = load(humanPath || defaultHuman);

const row = (label: string, raw: string) => {
  const hygiene = sanitizeGeneratedText(raw);
  const verdict = verifyChapter(hygiene.text, undefined, punctuationHygieneNote(hygiene.report));
  const criticism = deterministicCriticism(hygiene.text);
  const actionable = criticism.filter((finding) => finding.severity >= CRITIC_FIX_THRESHOLD);
  return {
    label,
    "балл": verdict.score,
    "гейт": verdict.gatePassed ? "прошёл" : "НЕ прошёл",
    "профиль (чел. 2,41)": verdict.humanProfileScore.toFixed(2),
    "CV абзацев (0,60)": verdict.paragraphCV.toFixed(2),
    "хвост 25+ (18–30 %)": `${Math.round(verdict.longTailShare * 100)} %`,
    "куски без хвоста": `${verdict.emptyChunks.empty}/${verdict.emptyChunks.total}`,
    "пунктуация": hygiene.report.fixedPunctuationArtifacts,
    "молчаний (2)": verdict.caps.find((cap) => cap.id === "silence")?.actual ?? 0,
    "регистр": verdict.registerFindings.length,
    "критика": actionable.length,
  };
};

console.table([row("эталон автора", human), ...(ours ? [row("наш текст", ours)] : [])]);

console.log("\nПодробно по нашему тексту:");
if (ours) {
  const hygiene = sanitizeGeneratedText(ours);
  const verdict = verifyChapter(hygiene.text);
  console.log(`  балл ${verdict.score}, гейт ${verdict.gatePassed ? "прошёл" : `не пройден — ${verdict.gateReason}`}`);
  console.log(`  ${punctuationHygieneNote(hygiene.report) || "пунктуация чиста"}`);
  for (const note of verdict.notes) console.log(`  ${note}`);
  console.log(`  блок правки критики:\n${criticismFixBlock(deterministicCriticism(hygiene.text)) || "    (пусто)"}`);
}

console.log("\nПол качества модели:");
for (const model of ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-3.1-flash-lite"]) {
  console.log(`  ${model.padEnd(24)} ${modelTier(model) === "primary" ? "основная" : "РЕЗЕРВНАЯ"}`);
}