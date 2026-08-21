/**
 * Проверка главы 7 через Яндекс Нейродетектор.
 * Запускать на локальной машине (не на сервере!):
 *
 *   npx tsx scripts/yandex-check-ch7.ts
 *
 * Требуется доступ к yandex.ru (без VPN из России).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { aiTellScore, sentenceBurstiness, shortSentenceStats } from "../server/humanStyle";
import { computeStyleStats, splitSentences, wordsOf } from "../src/lib/authorAudit";

const __filename = fileURLToPath(import.meta.url);
const root = path.join(path.dirname(__filename), "..");

async function yandexAnalyze(text: string): Promise<any> {
  const res = await fetch("https://yandex.ru/lab/neurodetector/api/analyze/text", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Accept: "application/json",
      Origin: "https://yandex.ru",
      Referer: "https://yandex.ru/lab/neurodetector",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    },
    body: JSON.stringify({ text: text.slice(0, 14_000) }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Yandex API ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.results || data;
}

function computeAiPct(report: any): number {
  let ai = 0;
  let total = 0;
  for (const s of report.segments || []) {
    const len = s.len || (s.text || "").length;
    total += len;
    if (s.label === "AI" || s.label === "LIKELY_AI") ai += len;
  }
  return total > 0 ? (ai / total) * 100 : 0;
}

async function main() {
  const filePath = path.join(root, "test-artifacts", "chapter7", "глава-7-final.txt");
  const text = fs.readFileSync(filePath, "utf8");

  console.log("=== Проверка главы 7 через Яндекс Нейродетектор ===\n");
  console.log(`Файл: ${filePath}`);
  console.log(`Символов: ${text.length}`);
  console.log(`Слов: ${text.split(/\s+/u).filter(Boolean).length}\n`);

  // Local detector first
  const local = aiTellScore(text);
  const stats = computeStyleStats(text);
  const short = shortSentenceStats(text, 4);
  const burst = sentenceBurstiness(text);

  console.log("--- ЛОКАЛЬНЫЙ ДЕТЕКТОР ---");
  console.log(`Score: ${local.score}/100`);
  console.log(`Burstiness: ${burst.toFixed(3)}`);
  console.log(`ShortShare: ${(short.share * 100).toFixed(1)}%`);
  console.log(`MaxChain: ${short.maxChain}`);
  console.log(`Hits: ${local.hits.length}`);
  for (const h of local.hits) {
    console.log(`  [${h.category}] ${h.label} → «${h.match}»`);
  }

  // Yandex API
  console.log("\n--- ЯНДЕКС НЕЙРОДЕТЕКТОР ---");
  try {
    const report = await yandexAnalyze(text);
    const aiPct = computeAiPct(report);

    console.log(`AI%: ${aiPct.toFixed(1)}%`);
    console.log(`Segments: ${report.segments?.length || 0}`);
    console.log(`Stats: AI=${report.stats?.AI_count || 0} LIKELY_AI=${report.stats?.LIKELY_AI_count || 0} HUMAN=${report.stats?.HUMAN_count || 0} LIKELY_HUMAN=${report.stats?.LIKELY_HUMAN_count || 0}`);

    if (report.segments) {
      for (const s of report.segments) {
        const pct = ((s.len / text.length) * 100).toFixed(0);
        console.log(`  [${s.label.padEnd(8)}] ${pct}% (${s.len} chars): ${(s.text || "").slice(0, 80)}...`);
      }
    }

    // Save report
    const outDir = path.join(root, "test-artifacts", "chapter7");
    const reportPath = path.join(outDir, "yandex-ch7-final-check.json");
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
    console.log(`\nОтчёт Яндекса: ${reportPath}`);

    // Comparison
    console.log("\n--- СРАВНЕНИЕ ---");
    console.log(`Локальный verdict: ${local.score < 15 ? "HUMAN" : "AI"} (score=${local.score})`);
    console.log(`Яндекс verdict: ${aiPct < 50 ? "HUMAN" : "AI"} (AI%=${aiPct.toFixed(1)})`);

    if (aiPct < 30) {
      console.log("\n*** ОТЛИЧНО: Яндекс определяет текст как HUMAN! ***");
    } else if (aiPct < 50) {
      console.log("\n*** ХОРОШО: Яндекс склоняется к HUMAN ***");
    } else {
      console.log("\n*** НУЖНА ДОРАБОТКА: Яндекс определяет как AI ***");
    }

  } catch (error: any) {
    console.log(`\nОШИБКА: ${error.message}`);
    console.log("Убедитесь, что:");
    console.log("1. Вы запускаете скрипт на локальной машине (не на сервере)");
    console.log("2. Доступен yandex.ru (без VPN или с российским VPN)");
    console.log("3. Нет блокировщика рекламы, мешающего API-запросам");
  }
}

main();
