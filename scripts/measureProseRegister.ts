/**
 * Калибровка регистра по эталону автора. Печатает обе строки и предлагает пороги.
 *
 *   npx tsx scripts/measureProseRegister.ts [наш текст] [эталон]
 *
 * Эталон по умолчанию — `~/storage/downloads/Вася/Вася.txt`: авторские главы 1–2,
 * 100 % HUMAN по отчёту нейродетектора от 01.10.2026. Правило проекта: порог
 * обязан быть не выше человеческого значения, иначе гейт роняет живую прозу.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  BODILY_PER_10K_LIMIT,
  HEDGE_SHARE_LIMIT,
  INTERIOR_SHARE_FLOOR,
  FILTER_PER_10K_LIMIT,
  INTENSIFIER_PER_10K_LIMIT,
  HUMAN_BODILY_PER_10K,
  HUMAN_HEDGE_SHARE,
  HUMAN_INTERIOR_SHARE,
  HUMAN_FILTER_PER_10K,
  HUMAN_INTENSIFIER_PER_10K,
  HUMAN_NEGATION_MOLD_PER_10K,
  HUMAN_ONE_SENTENCE_PARAGRAPH_SHARE,
  HUMAN_VERBATIM_REPEAT_PER_10K,
  NEGATION_MOLD_PER_10K_LIMIT,
  ONE_SENTENCE_SHARE_LIMIT,
  VERBATIM_REPEAT_PER_10K_LIMIT,
  measureProseRegister,
  proseRegisterFindings,
} from "../server/proseRegister";

const [, , oursPath, humanPath] = process.argv;
const defaultHuman = join(homedir(), "storage", "downloads", "Вася", "Вася.txt");

const load = (path: string): string => readFileSync(path, "utf8").replace(/^﻿/, "").replace(/^Глава \d[^\n]*\n/u, "");
const ours = oursPath ? load(oursPath) : "";
const human = humanPath ? load(humanPath) : load(defaultHuman);

const row = (label: string, text: string) => {
  const m = measureProseRegister(text);
  return {
    label,
    words: m.words,
    "тело/10тыс": m.bodilyPer10k,
    "названо/10тыс": m.namedEmotionPer10k,
    "фильтры/10тыс": m.filterPer10k,
    "оценочн./10тыс": m.intensifierPer10k,
    "«не+глагол»/10тыс": m.negationMoldPer10k,
    "абзацев": m.narrativeParagraphs,
    "однофразных": `${Math.round(m.oneSentenceParagraphShare * 100)} %`,
    [`мода ${m.modalSentenceCount} фр.`]: `${Math.round(m.modalSentenceCountShare * 100)} %`,
    "мысль героя": `${Math.round(m.interiorShare * 100)} %`,
    "оговорок": `${Math.round(m.hedgeShare * 100)} %`,
    "повтор образа": m.verbatimRepeatPer10k,
    "реплики —/-": `${m.speechEmDash}/${m.speechHyphen}`,
  };
};

console.table([row("эталон автора", human), ...(ours ? [row("наш текст", ours)] : [])]);

console.log("\nПредложенные пороги (эталон → порог):");
console.log(`  BODILY_PER_10K_LIMIT            ${HUMAN_BODILY_PER_10K} → ${BODILY_PER_10K_LIMIT}`);
console.log(`  FILTER_PER_10K_LIMIT           ${HUMAN_FILTER_PER_10K} → ${FILTER_PER_10K_LIMIT}`);
console.log(`  INTENSIFIER_PER_10K_LIMIT      ${HUMAN_INTENSIFIER_PER_10K} → ${INTENSIFIER_PER_10K_LIMIT}`);
console.log(`  NEGATION_MOLD_PER_10K_LIMIT     ${HUMAN_NEGATION_MOLD_PER_10K} → ${NEGATION_MOLD_PER_10K_LIMIT}`);
console.log(`  ONE_SENTENCE_SHARE_LIMIT        ${HUMAN_ONE_SENTENCE_PARAGRAPH_SHARE} → ${ONE_SENTENCE_SHARE_LIMIT}`);
console.log(`  INTERIOR_SHARE_FLOOR           ${HUMAN_INTERIOR_SHARE} → ${INTERIOR_SHARE_FLOOR}`);
console.log(`  HEDGE_SHARE_LIMIT              ${HUMAN_HEDGE_SHARE} → ${HEDGE_SHARE_LIMIT}`);
console.log(`  VERBATIM_REPEAT_PER_10K_LIMIT   ${HUMAN_VERBATIM_REPEAT_PER_10K} → ${VERBATIM_REPEAT_PER_10K_LIMIT}`);

if (ours) {
  console.log("\nНаходки на нашем тексте:");
  for (const finding of proseRegisterFindings(ours)) {
    console.log(`  [${finding.severity.toFixed(2)}] ${finding.label} → ${finding.advice}`);
  }
}