/**
 * Что различает HUMAN- и AI-сегменты ВНУТРИ одного отчёта детектора.
 *
 * Смысл: метрики, откалиброванные на главе целиком, могут не разделять класс,
 * тогда как внутри одного отчёта разница видна. Это сильнейший аргумент, какой
 * вообще бывает: и эталон, и глава приложения измерены одним и тем же кодом в
 * один и тот же день.
 *
 *   npx tsx scripts/probeDetectorSplit.ts result_*.json
 */
import { readFileSync } from "node:fs";
import { measureProseRegister } from "../server/proseRegister";
import { longTailStats, isDialogueSentence, aiTellScore } from "../server/humanStyle";

/** Разбор на слова: тот же счёт, что у гейта, чтобы числа сопоставимы. */
const wordsOf = (text: string): string[] => (text.match(/[\p{L}\p{N}]+/gu) || []);

const [, , filePath] = process.argv;
const data = JSON.parse(readFileSync(String(filePath), "utf8"));
type Row = { label: string; text: string };
const rows: Row[] = data.segments;

const avg = (list: number[]): number => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0);
const isHuman = (label: string): boolean => label === "HUMAN" || label === "LIKELY_HUMAN";

interface Metric {
  label: string;
  value: (row: Row) => number;
  /** Чем больше — тем человечнее (по эталону). */
  humanHigher: boolean;
}

const metrics: Metric[] = [
  { label: "хвост 25+ слов", value: (row) => longTailStats(row.text).share, humanHigher: true },
  { label: "восклицаний на 100 предл.", value: (row) => {
    const sentences = row.text.split(/(?<=[.!?…])\s+/u).filter((s) => s.trim().length > 2);
    const count = sentences.filter((s) => s.includes("!")).length;
    return sentences.length ? (count / sentences.length) * 100 : 0;
  }, humanHigher: true },
  { label: "средняя длина фразы", value: (row) => {
    const measured = row.text.split(/(?<=[.!?…])\s+/u).filter((s) => s.trim().length > 2 && !isDialogueSentence(s.trim()));
    return avg(measured.map((s) => wordsOf(s).length));
  }, humanHigher: true },
  { label: "разброс длин фраз", value: (row) => aiTellScore(row.text).burstiness ?? 0, humanHigher: true },
  { label: "телесных /10 тыс.", value: (row) => measureProseRegister(row.text).bodilyPer10k, humanHigher: false },
  { label: "фильтр-слов /10 тыс.", value: (row) => measureProseRegister(row.text).filterPer10k, humanHigher: false },
  { label: "названных чувств /10 тыс.", value: (row) => measureProseRegister(row.text).namedEmotionPer10k, humanHigher: true },
  { label: "«не + глагол» /10 тыс.", value: (row) => measureProseRegister(row.text).negationMoldPer10k, humanHigher: false },
  { label: "реплик в сегменте", value: (row) => (row.text.match(/(?:^|\n)\s*[—–-]\s+/gu) || []).length, humanHigher: true },
  { label: "доля реплик", value: (row) => {
    const sentences = row.text.split(/(?<=[.!?…])\s+/u).filter((s) => s.trim().length > 2);
    return sentences.length ? sentences.filter(isDialogueSentence).length / sentences.length : 0;
  }, humanHigher: true },
  { label: "слов", value: (row) => wordsOf(row.text).length, humanHigher: true },
];

console.log(`\nОтчёт: ${String(filePath).split("/").pop()}\n`);
const rowsOut = metrics.map((metric) => {
  const human = rows.filter((row) => isHuman(row.label));
  const ai = rows.filter((row) => !isHuman(row.label));
  const h = avg(human.map(metric.value));
  const a = avg(ai.map(metric.value));
  const ratio = a > 0 ? h / a : h > 0 ? 99 : 1;
  return {
    метрика: metric.label,
    "HUMAN": +h.toFixed(2),
    "AI": +a.toFixed(2),
    разница: `${metric.humanHigher ? (h > a ? "+" : "−") : (a > h ? "+" : "−")}${Math.abs(h - a).toFixed(2)}`,
    "отношение": ratio > 10 ? ">10×" : `${ratio.toFixed(2)}×`,
  };
});
console.table(rowsOut);

console.log(`\nСегменты HUMAN: ${rows.filter((row) => isHuman(row.label)).length}, AI/LIKELY_AI: ${rows.filter((row) => !isHuman(row.label)).length}`);