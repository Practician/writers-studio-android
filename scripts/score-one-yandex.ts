import fs from "node:fs";
import path from "node:path";

const file = process.argv[2] || path.join("src", "data", "labyrinth", "chapter-6.txt");
const text = fs.readFileSync(file, "utf8");
const words = text.split(/\s+/).filter(Boolean).length;

const res = await fetch("https://yandex.ru/lab/neurodetector/api/analyze/text", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Origin: "https://yandex.ru",
    Referer: "https://yandex.ru/lab/neurodetector",
    "User-Agent": "Mozilla/5.0",
  },
  body: JSON.stringify({ text }),
});

const data = await res.json();
const r = data.results || data;
const st = r.stats || {};
const segs = r.segments || [];
let ai = 0;
let tot = 0;
const labels: Record<string, number> = {};
for (const s of segs) {
  const len = s.len || (s.text || "").length;
  tot += len;
  if (s.label === "AI" || s.label === "LIKELY_AI") ai += len;
  labels[s.label] = (labels[s.label] || 0) + 1;
}
const pct = tot ? (100 * ai) / tot : 0;

const outDir = path.join("test-artifacts", "chapter6-optimal");
fs.mkdirSync(outDir, { recursive: true });
const report = {
  file,
  status: res.status,
  words,
  aiPct: pct,
  stats: st,
  labels,
  error: data.error || data.message || null,
  segments: segs.map((s: any) => ({
    label: s.label,
    len: s.len || (s.text || "").length,
    preview: String(s.text || "").slice(0, 160),
  })),
};
const outPath = path.join(outDir, "яндекс-rewrite-manual.json");
fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");

console.log(`status=${res.status} words=${words} AI%=${pct.toFixed(1)}`);
console.log(`stats:`, JSON.stringify(st));
console.log(`labels:`, JSON.stringify(labels));
if (segs.some((s: any) => s.label === "AI" || s.label === "LIKELY_AI")) {
  console.log("\nAI / LIKELY_AI segments:");
  for (const s of segs.filter((s: any) => s.label === "AI" || s.label === "LIKELY_AI")) {
    console.log(`[${s.label}] ${String(s.text || "").slice(0, 220)}`);
  }
} else {
  console.log("\nNo AI / LIKELY_AI segments.");
}
console.log("\nreport:", outPath);
