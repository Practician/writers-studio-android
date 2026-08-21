/**
 * Оптимизация гл.7 под Yandex: rewrite_detector_segments + лучший кандидат.
 * npx tsx scripts/optimize-chapter7-detector.ts
 */
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { aiTellScore } from "../server/humanStyle";
import { countWordsRu, russianLanguageIssues } from "../server/chapterGenerate";

dotenv.config({ override: true });

const BASE = process.env.APP_URL || "http://localhost:3000";
const outDir = path.join(process.cwd(), "test-artifacts", "chapter7");
const parentRoot = path.resolve(process.cwd(), "..");

const samplePath = [
  path.join(process.cwd(), "test-artifacts", "chapter6-optimal", "глава-6-optimal.txt"),
  path.join(process.cwd(), "test-artifacts", "chapter6", "глава-6-финал.txt"),
  path.join(parentRoot, "лабиринт_.txt"),
].find((p) => fs.existsSync(p)) || "";

function httpJson(
  method: "GET" | "POST",
  urlStr: string,
  body?: unknown,
  timeoutMs = 45 * 60 * 1000,
): Promise<{ status: number; json: any }> {
  const url = new URL(urlStr);
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), "utf8");
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname + url.search,
        method,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(payload ? { "Content-Length": String(payload.length) } : {}),
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let json: any = null;
          try {
            json = raw ? JSON.parse(raw) : null;
          } catch {
            json = { raw: raw.slice(0, 500) };
          }
          resolve({ status: res.statusCode || 0, json });
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("HTTP timeout")));
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
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0",
    },
    body: JSON.stringify({ text }),
  });
  const data = await res.json();
  const report = data.results || data;
  fs.writeFileSync(path.join(outDir, `яндекс-${name}.json`), JSON.stringify(report, null, 2), "utf8");
  const st = report.stats || {};
  let aiChars = 0;
  let total = 0;
  for (const s of report.segments || []) {
    total += s.len || (s.text || "").length || 0;
    if (s.label === "AI" || s.label === "LIKELY_AI") aiChars += s.len || (s.text || "").length || 0;
  }
  const pct = total ? (100 * aiChars) / total : 0;
  console.log(
    `  Yandex[${name}]: AI%=${pct.toFixed(1)} HUMAN=${st.HUMAN_count || 0} AI=${st.AI_count || 0} LAI=${st.LIKELY_AI_count || 0} LH=${st.LIKELY_HUMAN_count || 0} segs=${(report.segments || []).length}`,
  );
  return { report, pct, stats: st };
}

async function rewriteRound(
  text: string,
  segments: any[],
  provider: string,
  model: string,
  sample: string,
  round: number,
): Promise<string> {
  const res = await httpJson(
    "POST",
    `${BASE}/api/writer/ai`,
    {
      action: "rewrite_detector_segments",
      model,
      llmProvider: provider,
      humanize: true,
      humanizeDepth: "maximum",
      authorSample: sample.slice(0, provider === "groq" ? 2500 : 10000),
      voicePreset: "conversational",
      detectorSegments: segments.map((s: any) => ({
        text: s.text,
        label: s.label,
      })),
    },
    30 * 60 * 1000,
  );
  if (res.status < 200 || res.status >= 300 || !res.json?.result) {
    console.warn(`  rewrite round ${round} failed:`, res.status, res.json?.error || res.json);
    return text;
  }
  const next = String(res.json.result).trim();
  console.log(
    `  rewrite #${round}: words ${countWordsRu(text)}→${countWordsRu(next)} rewritten=${res.json.rewrittenCount ?? "?"}`,
  );
  return next;
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  let text = fs.readFileSync(path.join(outDir, "глава-7-maximum.txt"), "utf8");
  const sample = samplePath ? fs.readFileSync(samplePath, "utf8") : text;
  console.log("sample", samplePath || "(self)", "start words", countWordsRu(text));

  // Prefer Groq (fast); fallback gemini
  const providers: Array<{ id: string; model: string }> = [
    { id: "groq", model: "llama-3.3-70b-versatile" },
    { id: "gemini", model: "gemini-2.0-flash" },
  ];

  let best = { text, pct: 100, words: countWordsRu(text), stats: {} as any, round: -1 };

  for (const p of providers) {
    console.log(`\n=== provider ${p.id} ===`);
    let cur = text;
    for (let round = 0; round < 4; round += 1) {
      const y = await yandex(cur, `${p.id}-r${round}`);
      const words = countWordsRu(cur);
      const tell = aiTellScore(cur).score;
      const langOk = russianLanguageIssues(cur).length === 0;
      console.log(`  words=${words} tell=${tell} langOk=${langOk}`);

      if (y.pct < best.pct || (y.pct === best.pct && words > best.words)) {
        best = { text: cur, pct: y.pct, words, stats: y.stats, round };
        fs.writeFileSync(path.join(outDir, "глава-7-best.txt"), cur, "utf8");
        fs.writeFileSync(
          path.join(outDir, "best-meta.json"),
          JSON.stringify({ pct: best.pct, words: best.words, round: best.round, provider: p.id, stats: best.stats }, null, 2),
          "utf8",
        );
      }

      if (y.pct === 0 && (y.stats.AI_count || 0) + (y.stats.LIKELY_AI_count || 0) === 0) {
        console.log("  → clean HUMAN");
        break;
      }

      const segs = (y.report.segments || []).filter(
        (s: any) => s.label === "AI" || s.label === "LIKELY_AI",
      );
      if (!segs.length) break;

      const next = await rewriteRound(cur, y.report.segments || [], p.id, p.model, sample, round);
      if (next === cur || next.length < 500) {
        console.log("  no progress, next provider/round");
        break;
      }
      // keep plot anchors
      const must = ["NFC", "метк", "не найдено", "мама", "аудитор", "20", "ладо"];
      const missing = must.filter((m) => !next.toLowerCase().includes(m.toLowerCase()));
      if (missing.length > 2) {
        console.warn("  rewrite lost plot anchors:", missing.join(", "));
        // still try if shorter AI% later
      }
      cur = next;
      fs.writeFileSync(path.join(outDir, `глава-7-${p.id}-r${round + 1}.txt`), cur, "utf8");
    }
    if (best.pct < 40) break; // good enough to stop switching providers
  }

  console.log("\n=== BEST ===");
  console.log(`AI%=${best.pct.toFixed(1)} words=${best.words} round=${best.round}`);
  console.log("stats", best.stats);
  fs.writeFileSync(path.join(outDir, "глава-7-maximum.txt"), best.text, "utf8");

  // final yandex + downloads
  const yf = await yandex(best.text, "maximum-final");
  const report = {
    time: new Date().toISOString(),
    filename: "глава-7-maximum.txt",
    words: countWordsRu(best.text),
    ai_pct_by_chars: yf.pct,
    stats: yf.stats,
    segments: yf.report.segments || [],
  };
  fs.writeFileSync(path.join(outDir, "яндекс-maximum.json"), JSON.stringify(report, null, 2), "utf8");
  const dl = path.join(
    process.env.USERPROFILE || "",
    "Downloads",
    `result_chapter7_maximum_${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.json`,
  );
  fs.writeFileSync(dl, JSON.stringify(report, null, 2), "utf8");
  console.log("saved", dl);

  // re-export docx via child
  const { spawnSync } = await import("node:child_process");
  spawnSync("npx", ["tsx", "scripts/export-chapter7-maximum-docx.ts"], {
    cwd: process.cwd(),
    stdio: "inherit",
    shell: true,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
