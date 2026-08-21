/**
 * Собрать оптимальный результат: baseline 0% AI + polish текущего + ranking.
 * npx tsx scripts/finalize-optimal-chapter6.ts
 */
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { aiTellScore } from "../server/humanStyle";
import { countWordsRu, russianLanguageIssues } from "../server/chapterGenerate";

dotenv.config({ override: true });

const BASE = process.env.APP_URL || "http://localhost:3000";
const outDir = path.join(process.cwd(), "test-artifacts", "chapter6-optimal");
const parent = path.resolve(process.cwd(), "..");
const samplePath = path.join(parent, "лабиринт_.txt");

function httpJson(method: "GET" | "POST", urlStr: string, body?: unknown, timeoutMs = 30 * 60 * 1000) {
  const url = new URL(urlStr);
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), "utf8");
  return new Promise<{ status: number; json: any }>((resolve, reject) => {
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname,
        method,
        headers: {
          "Content-Type": "application/json",
          ...(payload ? { "Content-Length": String(payload.length) } : {}),
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          try {
            resolve({ status: res.statusCode || 0, json: raw ? JSON.parse(raw) : null });
          } catch {
            resolve({ status: res.statusCode || 0, json: { raw } });
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function yandex(text: string, name: string) {
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
  const report = data.results || data;
  fs.writeFileSync(path.join(outDir, `яндекс-${name}.json`), JSON.stringify(report, null, 2), "utf8");
  const st = report.stats || {};
  let aiChars = 0;
  let tot = 0;
  for (const s of report.segments || []) {
    const len = s.len || (s.text || "").length;
    tot += len;
    if (s.label === "AI" || s.label === "LIKELY_AI") aiChars += len;
  }
  const pct = tot ? (100 * aiChars) / tot : 0;
  console.log(
    `  [${name}] words=${countWordsRu(text)} AI%=${pct.toFixed(1)} H=${st.HUMAN_count || 0} AI=${st.AI_count || 0} LAI=${st.LIKELY_AI_count || 0} LH=${st.LIKELY_HUMAN_count || 0}`,
  );
  return { report, pct, stats: st };
}

function rank(words: number, pct: number, humanSeg: number, tell: number) {
  // lower better; prioritize detector, then human segments, then length
  let s = pct * 3;
  s += Math.max(0, 5 - humanSeg) * 8;
  s += Math.max(0, 1500 - words) * 0.04;
  s += tell * 0.2;
  if (pct === 0 && words >= 1500 && humanSeg >= 8) s -= 30;
  if (pct === 0 && words >= 1500) s -= 15;
  return s;
}

async function rewrite(text: string, segments: any[], sample: string) {
  const res = await httpJson("POST", `${BASE}/api/writer/ai`, {
    action: "rewrite_detector_segments",
    llmProvider: "gemini",
    model: "gemini-3.5-flash",
    humanize: true,
    humanizeDepth: "balanced",
    authorSample: sample.slice(0, 8000),
    voicePreset: "conversational",
    detectorSegments: segments.map((s: any) => ({ text: s.text, label: s.label })),
  });
  if (res.status >= 200 && res.status < 300 && res.json?.result) {
    return String(res.json.result).trim();
  }
  console.warn("rewrite fail", res.status, res.json?.error);
  return text;
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const sample = fs.existsSync(samplePath) ? fs.readFileSync(samplePath, "utf8") : "";
  const chaptersRoot = path.join(parent, "Главы");

  type Cand = { name: string; text: string; words: number; pct: number; stats: any; tell: number; r: number };
  const cands: Cand[] = [];

  // Collect baselines from disk
  if (fs.existsSync(chaptersRoot)) {
    for (const dir of fs.readdirSync(chaptersRoot)) {
      const d = path.join(chaptersRoot, dir);
      if (!fs.statSync(d).isDirectory()) continue;
      for (const f of fs.readdirSync(d)) {
        if (!f.endsWith(".txt") || !f.includes("глава-6") || f.includes("отчёт")) continue;
        const text = fs.readFileSync(path.join(d, f), "utf8");
        const words = countWordsRu(text);
        if (words < 500) continue;
        console.log(`\nBaseline ${dir}/${f}`);
        const y = await yandex(text, `base-${dir.slice(0, 20)}-${f.slice(0, 20)}`);
        const tell = aiTellScore(text).score;
        cands.push({
          name: `base:${dir}/${f}`,
          text,
          words,
          pct: y.pct,
          stats: y.stats,
          tell,
          r: rank(words, y.pct, (y.stats.HUMAN_count || 0) + (y.stats.LIKELY_HUMAN_count || 0), tell),
        });
      }
    }
  }

  // Current groq draft
  const curPath = path.join(process.cwd(), "test-artifacts", "chapter6", "глава-6-финал.txt");
  if (fs.existsSync(curPath)) {
    let text = fs.readFileSync(curPath, "utf8");
    console.log("\nCurrent groq draft + Gemini AI-segment rewrite loop");
    for (let i = 0; i < 3; i += 1) {
      const y = await yandex(text, `cur-r${i}`);
      const words = countWordsRu(text);
      const tell = aiTellScore(text).score;
      cands.push({
        name: `current-r${i}`,
        text,
        words,
        pct: y.pct,
        stats: y.stats,
        tell,
        r: rank(words, y.pct, (y.stats.HUMAN_count || 0) + (y.stats.LIKELY_HUMAN_count || 0), tell),
      });
      if (y.pct === 0 && ((y.stats.AI_count || 0) + (y.stats.LIKELY_AI_count || 0) === 0)) break;
      if ((y.stats.AI_count || 0) + (y.stats.LIKELY_AI_count || 0) === 0) break;
      const next = await rewrite(text, y.report.segments || [], sample);
      if (countWordsRu(next) < words * 0.75) {
        console.warn("rewrite shortened too much, stop");
        break;
      }
      text = next;
      fs.writeFileSync(path.join(outDir, `current-after-rewrite-${i + 1}.txt`), text, "utf8");
    }
  }

  cands.sort((a, b) => a.r - b.r);
  console.log("\n=== RANKING ===");
  for (const c of cands) {
    console.log(
      `${c.r.toFixed(1).padStart(7)}  w=${c.words} AI%=${c.pct.toFixed(1)} H=${c.stats.HUMAN_count || 0} AI=${c.stats.AI_count || 0} LAI=${c.stats.LIKELY_AI_count || 0} tell=${c.tell}  ${c.name}`,
    );
  }

  const best = cands[0];
  if (!best) throw new Error("no candidates");

  fs.writeFileSync(path.join(outDir, "глава-6-optimal.txt"), best.text, "utf8");
  fs.writeFileSync(path.join(process.cwd(), "test-artifacts", "chapter6", "глава-6-optimal.txt"), best.text, "utf8");
  // final yandex
  const yf = await yandex(best.text, "optimal-final");
  const lang = russianLanguageIssues(best.text);
  const tell = aiTellScore(best.text);
  const kpi =
    yf.pct === 0 && best.words >= 1500 && ((yf.stats.AI_count || 0) + (yf.stats.LIKELY_AI_count || 0) === 0)
      ? "PASS"
      : yf.pct <= 10 && best.words >= 1500
        ? "GOOD"
        : "REVIEW";

  fs.writeFileSync(
    path.join(outDir, "отчёт-optimal.txt"),
    [
      `best=${best.name}`,
      `words=${best.words}`,
      `yandex_ai_pct=${yf.pct.toFixed(1)}`,
      `HUMAN=${yf.stats.HUMAN_count || 0}`,
      `LIKELY_HUMAN=${yf.stats.LIKELY_HUMAN_count || 0}`,
      `AI=${yf.stats.AI_count || 0}`,
      `LIKELY_AI=${yf.stats.LIKELY_AI_count || 0}`,
      `ai-tell=${tell.score}`,
      `burst=${tell.burstiness.toFixed(2)}`,
      `lang=${lang.length ? lang.join("|") : "OK"}`,
      `kpi=${kpi}`,
      `note=Оптимум: 0% AI + ≥1500 слов (как прошлый PASS ~1769). 690 слов 100% human — короткий sweet spot; длинный PASS уже был ~1769.`,
    ].join("\n"),
    "utf8",
  );
  fs.writeFileSync(
    path.join(outDir, "ranking.json"),
    JSON.stringify(
      cands.map((c) => ({
        name: c.name,
        words: c.words,
        aiPct: c.pct,
        rank: c.r,
        stats: c.stats,
        tell: c.tell,
      })),
      null,
      2,
    ),
    "utf8",
  );

  console.log("\n=== OPTIMAL ===");
  console.log(best.name);
  console.log(`words=${best.words} AI%=${yf.pct.toFixed(1)} kpi=${kpi}`);
  console.log("file:", path.join(outDir, "глава-6-optimal.txt"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
