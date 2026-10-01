// Разовый пробник: стаккато-метрики (доля предложений ≤6 слов вне реплик) и порог
// STACCATO_SHARE_LIMIT на сегментах внешнего отчёта result_*.json.
import { readFileSync } from "node:fs";
import {
  STACCATO_CHAIN_LIMIT,
  STACCATO_SHARE_LIMIT,
  aiTellScore,
  isDialogueSentence,
  longTailStats,
  segmentStyle,
  shortSentenceStats,
  staccatoBlocks,
  type SegmentStyle,
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
  // Стиль сборки 108: зачины, повторность, восклицания, кавычки — эталон книги.
  const styles = list.map((row) => segmentStyle(row.text));
  return {
    label,
    n: list.length,
    share6: +avg(shorts.map((stat) => stat.share)).toFixed(3),
    chain6: +avg(shorts.map((stat) => stat.maxChain)).toFixed(2),
    maxChain: Math.max(...shorts.map((stat) => stat.maxChain)),
    // Хвост длинных предложений (25+ слов) — метрика сборки 107, эталон 0,19–0,30.
    tail: +avg(list.map((row) => longTailStats(row.text).share)).toFixed(3),
    opener: +avg(styles.map((style) => style.openerShare)).toFixed(3),
    ttr: +avg(styles.map((style) => style.ttr)).toFixed(3),
    excl: +avg(styles.map((style) => style.exclamationRate)).toFixed(1),
    quotes: avg(styles.map((style) => style.quoteSentences)),
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
    `chain=${stat.maxChain}`, `sent=${stat.total}`, `tail=${longTailStats(row.text).share.toFixed(2)}`, hot ? "HOT" : "",
  );
});

console.log("горячих блоков по главе:", staccatoBlocks(rows.map((row) => row.text), 50).length, "из", rows.length);

const whole = longTailStats(rows.map((row) => row.text).join("\n\n"));
console.log(
  `хвост по главе: ${(whole.share * 100).toFixed(1)}% длинных предложений `
  + `(${whole.count} из ${whole.total}), эталон человека 19–30%`,
);

const styleOf = (list: Row[]) => {
  const styles = list.map((row) => segmentStyle(row.text));
  const average = (pick: (style: SegmentStyle) => number) => avg(styles.map(pick));
  return {
    opener: average((style) => style.openerShare),
    ttr: average((style) => style.ttr),
    excl: average((style) => style.exclamationRate),
    // кавычки — как и эталон книги: на 100 предложений, а не штуками.
    quotes: average((style) => (style.quoteSentences / (style.sentences || 1)) * 100),
  };
};
const style = styleOf(rows);
console.log(
  `стиль по главе (среднее по ${rows.length} сегментам): `
  + `зачин-макс ${(style.opener * 100).toFixed(1)}% (эталон до 16%), `
  + `TTR ${style.ttr.toFixed(3)} (эталон 0,785), `
  + `восклицания ${style.excl.toFixed(1)} на 100 предл. (эталон 13,1), `
  + `кавычки ${style.quotes.toFixed(1)} на 100 предл. (эталон 0,7)`,
);
