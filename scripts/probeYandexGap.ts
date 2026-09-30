// Этап 6 (eval): чем текст главы отличается от человеческой прозы в тех измерениях,
// которые считаем локально. Внешний детектор (Яндекс Нейродетектор) недоступен из CI,
// поэтому сравниваем сегменты отчёта result_*.json с кусками человеческих книг
// примерно той же длины, что и сегменты детектора (~1000 знаков), и ранжируем разрыв.
//
// Запуск: npx tsx scripts/probeYandexGap.ts [путь к result.json] [каталог книг]
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  connectorDiversity,
  passiveVoiceShare,
  sentenceLengthSpread,
  uniqueWordRatio200,
} from "../server/humanStyleEnhanced";
import {
  aiTellScore,
  isDialogueSentence,
  shortSentenceStats,
} from "../server/humanStyle";

const HOME = os.homedir();
const RESULT_PATH = process.argv[2] || path.join(HOME, "storage/downloads/result_2026-09-30T19-56-38.json");
const BOOKS_DIR = process.argv[3] || path.join(HOME, "storage/downloads/книги");

type Row = { label: string; text: string };

const report = JSON.parse(fs.readFileSync(RESULT_PATH, "utf8")) as { segments: Row[] };
const ours = report.segments.filter((row) => row.label !== "HUMAN" && row.label !== "LIKELY_HUMAN");
const humanLabels = report.segments.filter((row) => row.label === "HUMAN" || row.label === "LIKELY_HUMAN");

/** Признаки одного куска текста — все считаются локально, без сети. */
function features(text: string) {
  const stats = shortSentenceStats(text, 6, isDialogueSentence);
  const score = aiTellScore(text);
  const dialogueChars = (text.match(/[«"][^»"]*[»"]/gu) ?? []).join("").length;
  const words = text.match(/[а-яёa-z-]+/giu) ?? [];
  const sentences = stats.total || 1;
  return {
    share6: stats.share,
    chain6: stats.maxChain,
    burst: score.burstiness ?? 0,
    spread: sentenceLengthSpread(text),
    ttr: uniqueWordRatio200(text),
    passive: passiveVoiceShare(text),
    conn: connectorDiversity(text),
    dialogue: text.length ? dialogueChars / text.length : 0,
    wordsPerSent: words.length / sentences,
    dots: ((text.match(/[.!?…]/gu) ?? []).length / Math.max(1, words.length)) * 100,
    tell: score.score,
  };
}

type Feat = ReturnType<typeof features>;
const KEYS = Object.keys(features("")) as Array<keyof Feat>;

/** Куски по ~1000 знаков с границей по предложению — как нарезает детектор. */
function chunk(text: string, size = 1000): string[] {
  const out: string[] = [];
  let rest = text.replace(/\s+/gu, " ").trim();
  while (rest.length > size) {
    let cut = rest.lastIndexOf(". ", size);
    if (cut < size * 0.5) cut = size;
    out.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest.length > 300) out.push(rest);
  return out;
}

function listFb2(dir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (out.length >= 40) break;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listFb2(full, out);
    else if (/\.fb2$/iu.test(entry.name)) out.push(full);
  }
  return out;
}

function stripFb2(raw: Buffer): string | null {
  const utf8 = raw.toString("utf8");
  if ((utf8.match(/�/gu) || []).length > 20) return null;
  return utf8
    .replace(/<binary[\s\S]*?<\/binary>/giu, " ")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;/giu, " ")
    .replace(/&laquo;|&raquo;|&ldquo;|&rdquo;/gu, "«»")
    .replace(/&#\d+;/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

const humanChunks: string[] = [];
for (const file of listFb2(BOOKS_DIR)) {
  const text = stripFb2(fs.readFileSync(file));
  if (!text || text.length < 5000) continue;
  humanChunks.push(...chunk(text.slice(0, 120_000)));
}

const oursFeats = ours.map((row) => features(row.text));
const humanFeats = humanChunks.map(features);
const labelledFeats = humanLabels.map((row) => features(row.text));

const avg = (list: number[]) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0);
const sd = (list: number[]) => {
  if (list.length < 2) return 0;
  const m = avg(list);
  return Math.sqrt(list.reduce((a, b) => a + (b - m) ** 2, 0) / (list.length - 1));
};

const rows = KEYS.map((key) => {
  const a = oursFeats.map((f) => f[key]);
  const b = humanFeats.map((f) => f[key]);
  const pooled = Math.sqrt((sd(a) ** 2 + sd(b) ** 2) / 2) || 1;
  return {
    признак: key,
    "наш текст": +avg(a).toFixed(3),
    "человек": +avg(b).toFixed(3),
    "min человек": +Math.min(...b).toFixed(3),
    "max человек": +Math.max(...b).toFixed(3),
    "d (разрыв)": +((avg(a) - avg(b)) / pooled).toFixed(2),
    "HUMAN из отчёта": labelledFeats.length ? +avg(labelledFeats.map((f) => f[key])).toFixed(3) : NaN,
  };
});
rows.sort((x, y) => Math.abs(y["d (разрыв)"]) - Math.abs(x["d (разрыв)"]));

console.log(`сегментов отчёта без HUMAN: ${ours.length}, человеческих кусков: ${humanChunks.length}`);
console.table(rows);

console.log("\nпо сегментам нашего отчёта:");
for (const [i, row] of report.segments.entries()) {
  const f = features(row.text);
  console.log(
    `${String(i).padStart(2)} ${row.label.padEnd(10)} share6=${f.share6.toFixed(2)} chain=${f.chain6} burst=${f.burst.toFixed(2)} `
    + `spread=${f.spread.toFixed(2)} dial=${f.dialogue.toFixed(2)} w/s=${f.wordsPerSent.toFixed(1)} tell=${f.tell}`,
  );
}
