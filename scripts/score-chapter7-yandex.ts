/**
 * npx tsx scripts/score-chapter7-yandex.ts
 */
import fs from "node:fs";
import path from "node:path";

const src = path.join("test-artifacts", "chapter7", "глава-7-maximum.txt");
const outDir = path.join("test-artifacts", "chapter7");
const logPath = path.join(outDir, "yandex-run.log");

function log(msg: string) {
  const line = typeof msg === "string" ? msg : JSON.stringify(msg);
  console.log(line);
  fs.appendFileSync(logPath, line + "\n", "utf8");
}

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(logPath, "", "utf8");

const text = fs.readFileSync(src, "utf8");
const words = text.trim().split(/\s+/).filter(Boolean).length;
log(`words=${words} chars=${text.length}`);

const res = await fetch("https://yandex.ru/lab/neurodetector/api/analyze/text", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Origin: "https://yandex.ru",
    Referer: "https://yandex.ru/lab/neurodetector",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  },
  body: JSON.stringify({ text }),
});

log(`http=${res.status}`);
const raw = await res.text();
fs.writeFileSync(path.join(outDir, "yandex-raw-response.txt"), raw, "utf8");

let data: any;
try {
  data = JSON.parse(raw);
} catch {
  log("parse fail: " + raw.slice(0, 400));
  process.exit(1);
}

const r = data.results || data;
const st = r.stats || {};
let aiLen = 0;
let tot = 0;
const byLabel: Record<string, number> = {};
for (const s of r.segments || []) {
  const len = Number(s.len || (s.text || "").length || 0);
  tot += len;
  byLabel[s.label] = (byLabel[s.label] || 0) + 1;
  if (s.label === "AI" || s.label === "LIKELY_AI") aiLen += len;
}
const pct = tot ? (100 * aiLen) / tot : 0;

const report = {
  time: new Date().toISOString(),
  filename: "глава-7-maximum.txt",
  words,
  text_length: text.length,
  ai_pct_by_chars: Math.round(pct * 10) / 10,
  stats: st,
  segment_labels: byLabel,
  segments: r.segments || [],
  short_text_warning: false,
};

fs.writeFileSync(path.join(outDir, "яндекс-maximum.json"), JSON.stringify(report, null, 2), "utf8");
fs.writeFileSync(path.join(outDir, "яндекс-отчёт.json"), JSON.stringify(report, null, 2), "utf8");

// copy to Downloads for convenience
try {
  const dl = path.join(
    process.env.USERPROFILE || "",
    "Downloads",
    `result_chapter7_maximum_${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.json`,
  );
  fs.writeFileSync(dl, JSON.stringify(report, null, 2), "utf8");
  log(`downloads=${dl}`);
} catch (e: any) {
  log(`downloads fail: ${e?.message || e}`);
}

log(`AI%=${pct.toFixed(1)}`);
log(`stats=${JSON.stringify(st)}`);
log(`labels=${JSON.stringify(byLabel)}`);
for (const s of r.segments || []) {
  const preview = String(s.text || "").replace(/\s+/g, " ").slice(0, 100);
  log(`${String(s.label).padEnd(14)} ${String(s.len || "").padStart(5)} ${preview}`);
}
log("done");
