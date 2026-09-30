// Разовый пробник: считает метрики aiTellScore на сегментах внешнего детектора
// (result_*.json), чтобы сверить локальный аудит с вердиктом детектора.
import { readFileSync } from "node:fs";
import { AI_TELL_CATALOG, aiTellScore, humanizeGatePassed, shortSentenceStats } from "../server/humanStyle";

const [, , filePath] = process.argv;
const data = JSON.parse(readFileSync(String(filePath), "utf8"));
type Row = { label: string; text: string };

const rows: Row[] = (data.segments as Row[]).map((segment) => ({ label: segment.label, text: segment.text }));

const avg = (list: number[]) => (list.length ? list.reduce((sum, value) => sum + value, 0) / list.length : 0);
const pick = (labels: string[]) => rows.filter((row) => labels.includes(row.label));
const summarize = (label: string, list: Row[]) => {
  const scores = list.map((row) => aiTellScore(row.text));
  const shorts = list.map((row) => shortSentenceStats(row.text, 4));
  return {
    label,
    n: list.length,
    score: avg(scores.map((score) => score.score)),
    burstiness: avg(scores.map((score) => score.burstiness ?? 0)),
    shortShare: avg(scores.map((score) => score.shortShare ?? 0)),
    maxShortChain: avg(scores.map((score) => score.maxShortChain ?? 0)),
    short4: avg(shorts.map((stat) => stat.share)),
    chain4: avg(shorts.map((stat) => stat.maxChain)),
    gatePassed: scores.filter((score) => humanizeGatePassed(score, 12, 0.45)).length,
  };
};

console.table([
  summarize("AI", pick(["AI"])),
  summarize("LIKELY_AI", pick(["LIKELY_AI"])),
  summarize("HUMAN", pick(["HUMAN"])),
]);

console.log("по сегментам:");
for (const row of rows) {
  const score = aiTellScore(row.text);
  const heavy = score.hits
    .filter((hit) => (AI_TELL_CATALOG.find((entry) => entry.id === hit.id)?.weight ?? 0) >= 2)
    .map((hit) => hit.id);
  console.log(
    [row.label.padEnd(10), String(score.score).padStart(3), `burst=${(score.burstiness ?? 0).toFixed(2)}`,
      `short=${(score.shortShare ?? 0).toFixed(2)}`, `chain=${score.maxShortChain}`,
      `gate=${humanizeGatePassed(score, 12, 0.45) ? "PASS" : "FAIL"}`, heavy.join(",")].join(" · "),
  );
}
