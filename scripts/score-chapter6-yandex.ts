import fs from "node:fs";
import path from "node:path";

const root = path.join(path.resolve(".."), "Главы");
const files: string[] = [];

if (fs.existsSync(root)) {
  for (const dir of fs.readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const d = path.join(root, dir.name);
    for (const f of fs.readdirSync(d)) {
      if (f.endsWith(".txt") && f.includes("глава-6") && !f.includes("отчёт")) {
        files.push(path.join(d, f));
      }
    }
  }
}
files.push(path.join(process.cwd(), "test-artifacts", "chapter6", "глава-6-финал.txt"));

async function score(p: string) {
  const text = fs.readFileSync(p, "utf8");
  const words = text.split(/\s+/).filter(Boolean).length;
  if (words < 100) return null;
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
  let ai = 0;
  let tot = 0;
  for (const s of r.segments || []) {
    const len = s.len || (s.text || "").length;
    tot += len;
    if (s.label === "AI" || s.label === "LIKELY_AI") ai += len;
  }
  const pct = tot ? (100 * ai) / tot : 0;
  const rel = path.relative(root, p);
  console.log(
    `${String(words).padStart(5)}  AI%=${pct.toFixed(1).padStart(5)}  H=${st.HUMAN_count || 0} AI=${st.AI_count || 0} LAI=${st.LIKELY_AI_count || 0} LH=${st.LIKELY_HUMAN_count || 0}  ${rel}`,
  );
  return { p, words, pct, st, text };
}

const results: any[] = [];
for (const f of files) {
  try {
    const r = await score(f);
    if (r) results.push(r);
  } catch (e: any) {
    console.log("fail", f, e.message);
  }
}
results.sort((a, b) => a.pct - b.pct || b.words - a.words);
console.log("\nBEST:", results[0]?.p, "words", results[0]?.words, "AI%", results[0]?.pct?.toFixed(1));
if (results[0]) {
  fs.mkdirSync("test-artifacts/chapter6-optimal", { recursive: true });
  fs.writeFileSync("test-artifacts/chapter6-optimal/baseline-best-existing.txt", results[0].text, "utf8");
  fs.writeFileSync(
    "test-artifacts/chapter6-optimal/baseline-ranking.json",
    JSON.stringify(
      results.map((r) => ({ file: r.p, words: r.words, aiPct: r.pct, stats: r.st })),
      null,
      2,
    ),
    "utf8",
  );
}
