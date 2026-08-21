/**
 * Анализ главы 7 улучшенным локальным детектором v2.
 * npx tsx scripts/analyze-ch7-v2.ts
 */
import fs from "fs";
import path from "path";
import { aiTellScore, detectAiTells, sentenceBurstiness, shortSentenceStats, blockHumanizeIssues } from "../server/humanStyle";
import { computeStyleStats, splitSentences, wordsOf } from "../src/lib/authorAudit";
import { loadAdaptiveProfile, scoreCalibratedLocalDetector } from "../src/lib/adaptiveDetector";
import { LABYRINTH_STORY_ID } from "../src/data/labyrinthCanon";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const root = path.join(path.dirname(__filename), "..");

function analyzeBlock(text: string, index: number) {
  const score = aiTellScore(text);
  const stats = computeStyleStats(text);
  const short = shortSentenceStats(text, 4);
  const burst = sentenceBurstiness(text);
  const issues = blockHumanizeIssues(text);
  const hits = score.hits.map((h) => `  [${h.category}] ${h.label} → «${h.match}»`);
  const sentences = splitSentences(text);
  const sentLens = sentences.map((s) => wordsOf(s).length);

  return {
    index,
    score: score.score,
    burstiness: burst,
    shortShare: short.share,
    maxChain: short.maxChain,
    avgSentLen: stats.averageSentenceWords,
    sentCount: sentences.length,
    wordCount: stats.words,
    issues,
    hits,
    sentLens,
  };
}

function main() {
  const filePath = path.join(root, "test-artifacts", "chapter7", "глава-7-final.txt");
  const text = fs.readFileSync(filePath, "utf8");

  console.log("=== Анализ главы 7 локальным детектором v2 ===\n");
  console.log(`Файл: ${filePath}`);
  console.log(`Символов: ${text.length}`);
  console.log(`Слов: ${text.split(/\s+/u).filter(Boolean).length}\n`);

  // Global score
  const global = aiTellScore(text);
  const globalStats = computeStyleStats(text);
  const globalShort = shortSentenceStats(text, 4);
  console.log(`--- ГЛОБАЛЬНАЯ ОЦЕНКА ---`);
  console.log(`AI-Tell Score: ${global.score}/100`);
  console.log(`Burstiness: ${global.burstiness.toFixed(3)}`);
  console.log(`Pattern density: ${global.patternDensity.toFixed(2)} per 1k words`);
  console.log(`Opener repetition: ${(global.openerRepetition * 100).toFixed(1)}%`);
  console.log(`Short share (≤4 words): ${(globalShort.share * 100).toFixed(1)}%`);
  console.log(`Max short chain: ${globalShort.maxChain}`);
  console.log(`Avg sentence length: ${globalStats.averageSentenceWords.toFixed(1)} words`);
  console.log(`Hits: ${global.hits.length}`);
  if (global.hits.length) {
    for (const hit of global.hits) {
      console.log(`  [${hit.category}] ${hit.label} → «${hit.match}»`);
    }
  }

  // Adaptive detector
  const profile = loadAdaptiveProfile(LABYRINTH_STORY_ID);
  const adaptive = scoreCalibratedLocalDetector(text, profile);
  if (adaptive) {
    console.log(`\n--- ADAPTIVE DETECTOR (Яндекс-калибровка) ---`);
    console.log(`Calibrated HUMAN%: ${adaptive.calibratedHumanProbability}%`);
    console.log(`Adaptive HUMAN%: ${adaptive.adaptiveHumanProbability}%`);
    console.log(`aiTell score: ${adaptive.aiTellScore}`);
    console.log(`Label: ${adaptive.predictedLabel}`);
  }

  // Per-block analysis
  console.log(`\n--- ПОБЛОЧНЫЙ АНАЛИЗ ---`);
  const blocks = text.split(/\n{2,}/u).filter((b) => b.trim());
  let totalScore = 0;
  let totalWords = 0;
  let dirtyBlocks = 0;

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i].trim();
    if (block.length < 20) continue;
    const a = analyzeBlock(block, i);
    totalScore += a.score * a.wordCount;
    totalWords += a.wordCount;
    if (a.score >= 15) dirtyBlocks += 1;

    const mark = a.score < 8 ? "✓" : a.score < 15 ? "~" : "✗";
    console.log(`\n${mark} Блок ${i + 1} (${a.wordCount} слов, score=${a.score}):`);
    console.log(`  Burstiness: ${a.burstiness.toFixed(2)} | Short: ${(a.shortShare * 100).toFixed(0)}% | Chain: ${a.maxChain} | AvgSent: ${a.avgSentLen.toFixed(1)}`);
    if (a.hits.length) {
      for (const hit of a.hits) console.log(`  ${hit}`);
    }
    if (a.issues.length) {
      for (const issue of a.issues) console.log(`  ⚠ ${issue}`);
    }
  }

  const weightedScore = totalWords > 0 ? totalScore / totalWords : 0;
  console.log(`\n--- ИТОГО ---`);
  console.log(`Взвешенный score: ${weightedScore.toFixed(1)}`);
  console.log(`Грязных блоков (≥15): ${dirtyBlocks}/${blocks.filter((b) => b.trim().length >= 20).length}`);

  // Verdict
  console.log(`\n--- ВЕРДИКТ ---`);
  if (weightedScore < 8) {
    console.log("ТЕКСТ ВЫГЛЯДИТ КАК HUMAN (score < 8)");
  } else if (weightedScore < 15) {
    console.log("ТЕКСТ НА ГРАНИ — несколько AI-признаков, но в целом живой (8 ≤ score < 15)");
  } else {
    console.log("ТЕКСТ ВЫГЛЯДИТ КАК AI (score ≥ 15) — рекомендуется доработка");
  }

  // Save report
  const report = {
    timestamp: new Date().toISOString(),
    file: filePath,
    globalScore: global.score,
    burstiness: global.burstiness,
    patternDensity: global.patternDensity,
    shortShare: globalShort.share,
    maxChain: globalShort.maxChain,
    hits: global.hits.map((h) => ({ id: h.id, label: h.label, category: h.category, match: h.match })),
    adaptive: adaptive ? {
      calibratedHumanProbability: adaptive.calibratedHumanProbability,
      predictedLabel: adaptive.predictedLabel,
    } : null,
    blocks: blocks.filter((b) => b.trim().length >= 20).map((b, i) => analyzeBlock(b.trim(), i)),
  };
  const outPath = path.join(root, "test-artifacts", "chapter7", "detector-v2-ch7-analysis.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
  console.log(`\nОтчёт: ${outPath}`);
}

main();
