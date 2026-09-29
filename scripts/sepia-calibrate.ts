/** Калибровка порогов гейта на двух классах:
 *
 *   AI    — глава 4 из result_*.json, где внешний детектор дал 22 сегмента из 22 «AI»;
 *   HUMAN — человеческие книги из ~/storage/downloads/книги (fb2, без разметки).
 *
 * Без этого порог в runMultiDetectorGate ничего не значил: локальный счёт 17 при
 * вердикте 22/22 «AI» — ровно тот случай, когда число не откалибровано ни на чём.
 *
 * Запуск: npx tsx scripts/sepia-calibrate.ts [путь к result.json] [каталог книг]
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  connectorDiversity,
  paragraphLengthCV,
  passiveVoiceShare,
  sentenceLengthSpread,
  uniqueWordRatio200,
} from "../server/humanStyleEnhanced";

const HOME = os.homedir();
const RESULT_PATH = process.argv[2] || path.join(HOME, "storage/downloads/result_2026-09-29T11-06-30.json");
const BOOKS_DIR = process.argv[3] || path.join(HOME, "storage/downloads/книги");

const WINDOW = 23_000;
const WINDOWS_PER_BOOK = 3;

function aiChapter(): string {
  const report = JSON.parse(fs.readFileSync(RESULT_PATH, "utf8"));
  return (report.segments as Array<{ text: string }>).map((segment) => segment.text).join("\n\n");
}

function listFiles(dir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (out.length >= 40) break;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listFiles(full, out);
    else if (/\.fb2$/iu.test(entry.name)) out.push(full);
  }
  return out;
}

function stripFb2(raw: Buffer): string | null {
  const utf8 = raw.toString("utf8");
  // Файл не в UTF-8 читается с заменительными символами: такие куски в калибровку
  // не идут, иначе меряется кодировка, а не проза.
  if ((utf8.match(/�/gu) || []).length > 20) return null;
  const body = utf8
    .replace(/<binary[\s\S]*?<\/binary>/giu, " ")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;/giu, " ")
    .replace(/&laquo;|&raquo;|&ldquo;|&rdquo;/gu, "«»")
    .replace(/&#\d+;/gu, " ")
    .replace(/[ \t]+/gu, " ")
    .replace(/\s*\n\s*/gu, "\n\n")
    .trim();
  return body.length > WINDOW ? body : null;
}

interface Row {
  name: string;
  klass: "AI" | "HUMAN";
  spread: number;
  paraCV: number;
  ttr: number;
  passive: number;
  conn: number;
}

function measure(name: string, klass: "AI" | "HUMAN", text: string): Row {
  return {
    name,
    klass,
    spread: sentenceLengthSpread(text),
    paraCV: paragraphLengthCV(text),
    ttr: uniqueWordRatio200(text),
    passive: passiveVoiceShare(text),
    conn: connectorDiversity(text),
  };
}

function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const base = Math.floor(position);
  const rest = position - base;
  return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base];
}

function main(): void {
  const rows: Row[] = [];
  rows.push(measure("result.json (глава 4)", "AI", aiChapter()));

  const files = listFiles(BOOKS_DIR);
  let taken = 0;
  for (const file of files) {
    if (taken >= 6) break;
    let decoded: string | null = null;
    try {
      decoded = stripFb2(fs.readFileSync(file));
    } catch (error) {
      console.warn(`пропущен ${path.basename(file)}:`, (error as Error).message);
    }
    if (!decoded) continue;
    for (let index = 0; index < WINDOWS_PER_BOOK && taken < 6; index += 1) {
      const start = 10_000 + index * 45_000;
      const chunk = decoded.slice(start, start + WINDOW);
      if (chunk.length < WINDOW * 0.8) break;
      rows.push(measure(`${path.basename(file)} #${index + 1}`, "HUMAN", chunk));
      taken += 1;
    }
  }

  const header = ["класс", "текст", "spread", "paraCV", "TTR", "passive", "conn"].join("\t");
  console.log(header);
  for (const row of rows) {
    console.log(
      [row.klass, row.name.slice(0, 46), row.spread.toFixed(3), row.paraCV.toFixed(3), row.ttr.toFixed(3),
        row.passive.toFixed(3), row.conn.toFixed(3)].join("\t"),
    );
  }

  const humanSpread = rows.filter((row) => row.klass === "HUMAN").map((row) => row.spread);
  const humanPara = rows.filter((row) => row.klass === "HUMAN").map((row) => row.paraCV);
  const humanTtr = rows.filter((row) => row.klass === "HUMAN").map((row) => row.ttr);
  const aiRow = rows.find((row) => row.klass === "AI")!;

  console.log("\n=== предложенные пороги (справа от худшего человеческого значения) ===");
  if (humanSpread.length) {
    // Порог ставится НИЖЕ минимума человеческого разброса: гейт не должен ронять
    // живую прозу. AI-строка показана для сравнения, а не как единственный ориентир.
    const minHuman = Math.min(...humanSpread);
    console.log(`minSentenceSpread = ${(minHuman * 0.9).toFixed(2)}  (человек min ${minHuman.toFixed(2)}, `
      + `p25 ${quantile(humanSpread, 0.25).toFixed(2)}, медиана ${quantile(humanSpread, 0.5).toFixed(2)}; `
      + `AI ${aiRow.spread.toFixed(2)})`);
    const minPara = Math.min(...humanPara);
    console.log(`minParagraphCV    = ${(minPara * 0.9).toFixed(2)}  (человек min ${minPara.toFixed(2)}; AI ${aiRow.paraCV.toFixed(2)})`);
    const minTtr = Math.min(...humanTtr);
    console.log(`minTTR200         = ${(minTtr * 0.9).toFixed(2)}  (человек min ${minTtr.toFixed(2)}; AI ${aiRow.ttr.toFixed(2)})`);
  }
}

main();
