import { aiTellScore, sentenceBurstiness, shortSentenceStats } from "../server/humanStyle";
import { countWordsRu } from "../server/chapterGenerate";
import { computeStyleStats } from "../src/lib/authorAudit";
import { loadAdaptiveProfile, scoreCalibratedLocalDetector } from "../src/lib/adaptiveDetector";
import { LABYRINTH_STORY_ID } from "../src/data/labyrinthCanon";
import fs from "fs";

const text = fs.readFileSync("src/data/labyrinth/chapter-8.txt", "utf8");
const s = aiTellScore(text);
const b = sentenceBurstiness(text);
const sh = shortSentenceStats(text, 4);
const st = computeStyleStats(text);
const w = countWordsRu(text);
const profile = loadAdaptiveProfile(LABYRINTH_STORY_ID);
const cal = scoreCalibratedLocalDetector(text, profile);

console.log("=== Глава 8: Локальный детектор v2 ===");
console.log("Слов:", w);
console.log("AI-Tell Score:", s.score + "/100");
console.log("Burstiness:", b.toFixed(3));
console.log("ShortShare:", (sh.share * 100).toFixed(1) + "%");
console.log("MaxChain:", sh.maxChain);
console.log("AvgSent:", st.averageSentenceWords.toFixed(1));
console.log("Hits:", s.hits.length);
for (const h of s.hits) console.log("  [" + h.category + "] " + h.label);
if (cal) {
  console.log();
  console.log("=== Adaptive Detector ===");
  console.log("Calibrated HUMAN%:", cal.calibratedHumanProbability + "%");
  console.log("Label:", cal.predictedLabel);
}
console.log();
console.log("=== Вердикт ===");
if (s.score < 15) console.log("HUMAN (score < 15)");
else if (s.score < 25) console.log("НА ГРАНИ (15 <= score < 25)");
else console.log("AI (score >= 25)");

// Try Yandex API
console.log("\n=== Яндекс Нейродетектор ===");
try {
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
    console.log("HTTP", res.status, body.slice(0, 200));
  } else {
    const data = await res.json();
    const report = data.results || data;
    let ai = 0, total = 0;
    for (const seg of report.segments || []) {
      const len = seg.len || (seg.text || "").length;
      total += len;
      if (seg.label === "AI" || seg.label === "LIKELY_AI") ai += len;
    }
    const pct = total > 0 ? (ai / total) * 100 : 0;
    console.log("AI%:", pct.toFixed(1) + "%");
    console.log("Segments:", report.segments?.length || 0);
    console.log("Stats: AI=" + (report.stats?.AI_count || 0) + " LIKELY_AI=" + (report.stats?.LIKELY_AI_count || 0) + " HUMAN=" + (report.stats?.HUMAN_count || 0));
    for (const seg of report.segments || []) {
      console.log("  [" + seg.label.padEnd(8) + "] " + (seg.text || "").slice(0, 80) + "...");
    }
    fs.writeFileSync("test-artifacts/ch78-app/yandex-ch8-v2-check.json", JSON.stringify(report, null, 2), "utf8");
  }
} catch (e: any) {
  console.log("Ошибка:", e.message);
  console.log("Яндекс API недоступен с этого сервера. Запустите yandex-check-ch7.ts на локальной машине.");
}
