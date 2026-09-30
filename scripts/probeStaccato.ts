// Разовый пробник: стаккато-метрики (доля предложений ≤6 слов вне реплик) и порог
// STACCATO_SHARE_LIMIT на сегментах внешнего отчёта result_*.json.
import { readFileSync } from "node:fs";
import {
  STACCATO_CHAIN_LIMIT,
  STACCATO_SHARE_LIMIT,
  aiTellScore,
  isDialogueSentence,
  shortSentenceStats,
  staccatoBlocks,
} from "../server/humanStyle";

const [, , filePath] = process.argv;
const data = JSON.parse(readFileSync(String(filePath), "utf8"));
type Row = { label: string; text: string };
const rows: Row[] = data.segments as Row[];

const avg = (list: number[]) => (list.length ? list.reduce((sum, value) => sum + value, 0) / list.length : 0);
const pick = (labels: string[]) => rows.filter((row) => labels.includes(row.label));
const summarize = (label: string, list: Row[]) => {
  const shorts = list.map((row) => shortSentenceStats(row.text, 6, isDialogueSentence));
  const scores = list.map((row) => aiTellScore(row.text));
  return {
    label,
    n: list.length,
    share6: +avg(shorts.map((stat) => stat.share)).toFixed(3),
    chain6: +avg(shorts.map((stat) => stat.maxChain)).toFixed(2),
    maxChain: Math.max(...shorts.map((stat) => stat.maxChain)),
    burst: +avg(scores.map((score) => score.burstiness ?? 0)).toFixed(3),
    tell: +avg(scores.map((score) => score.score)).toFixed(2),
    hot: shorts.filter((stat) => stat.share >= STACCATO_SHARE_LIMIT || stat.maxChain >= STACCATO_CHAIN_LIMIT).length,
  };
};

console.table([
  summarize("AI+LIKELY", pick(["AI", "LIKELY_AI"])),
  summarize("HUMAN", pick(["HUMAN", "LIKELY_HUMAN"])),
]);

console.log("по сегментам (порог 0.38 / цепочка 4):");
rows.forEach((row, index) => {
  const stat = shortSentenceStats(row.text, 6, isDialogueSentence);
  const hot = stat.share >= STACCATO_SHARE_LIMIT || stat.maxChain >= STACCATO_CHAIN_LIMIT;
  console.log(
    String(index).padStart(2), row.label.padEnd(11), `share6=${stat.share.toFixed(3)}`,
    `chain=${stat.maxChain}`, `sent=${stat.total}`, hot ? "HOT" : "",
  );
});

console.log("горячих блоков по главе:", staccatoBlocks(rows.map((row) => row.text), 50).length, "из", rows.length);
