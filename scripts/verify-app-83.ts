/**
 * Живая проверка ТОЛЬКО через API приложения /api/writer/ai.
 * Никаких прямых вызовов generateHumanizedChapter: тест идёт тем же путём,
 * что и кнопка генерации главы в приложении.
 */
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { aiTellScore } from "../server/humanStyle.ts";

dotenv.config({ override: true });

const OUT = process.env.OUTDIR || "/home/user/workspace/verify-app83";
const APP = process.env.APP_URL || "http://127.0.0.1:3000";
const PROVIDER = String(process.env.VERIFY_PROVIDER || process.env.LLM_PROVIDER || "gemini").toLowerCase();
const MODEL = process.env.LIVE_MODEL || process.env.VERIFY_MODEL || "gemini-2.5-flash";
const CCC = Number(process.env.CCC || 1);
const LOG = path.join(OUT, "log.txt");
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(LOG, "");
const log = (l: string) => {
  const s = `[${new Date().toISOString().slice(11, 19)}] ${l}`;
  fs.appendFileSync(LOG, s + "\n");
};

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
          Accept: "application/json",
          ...(payload ? { "Content-Type": "application/json", "Content-Length": String(payload.length) } : {}),
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
            json = { raw };
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

async function waitServer(maxMs = 60_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    try {
      const res = await httpJson("GET", `${APP}/api/llm/status`, undefined, 5_000);
      if (res.status === 200) return res.json;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error(`Сервер приложения не ответил на ${APP}`);
}

function metrics(t: string) {
  const body = t.replace(/^.*?Синопсис:[^\n]*\n?/s, "");
  const words = body.match(/[\p{L}\p{N}'’-]+/gu) ?? [];
  const sents = body.split(/(?<=[.!?…])\s+/).filter((s) => s.trim());
  const lens = sents.map((s) => (s.match(/[\p{L}\p{N}'’-]+/gu) ?? []).length);
  const avg = lens.reduce((a, b) => a + b, 0) / Math.max(lens.length, 1);
  const sd = Math.sqrt(lens.reduce((a, b) => a + (b - avg) ** 2, 0) / Math.max(lens.length, 1));
  const c = (re: RegExp) => (body.match(re) ?? []).length;
  return {
    words: words.length,
    sentences: sents.length,
    avgSentence: +avg.toFixed(2),
    sdSentence: +sd.toFixed(2),
    shortUnder5: +(100 * lens.filter((l) => l < 5).length / Math.max(lens.length, 1)).toFixed(1),
    long25plus: lens.filter((l) => l >= 25).length,
    similes: c(/словно|будто|похоже на|наподобие|как будто/giu),
    silence: c(/не ответил|промолчал|молчал(?:а|и)?\b|вместо ответа/giu),
    freeze: c(/замер|застыл|замира/giu),
    plita: c(/плит/giu),
    ilyaPer1000: +(1000 * c(/Илья|Илье|Илью|Ильи|Илюх/giu) / Math.max(words.length, 1)).toFixed(1),
    vaskaPer1000: +(1000 * c(/Васьк|Вась/giu) / Math.max(words.length, 1)).toFixed(1),
  };
}

async function main() {
  const prev = fs.readFileSync(path.join(OUT, "previous.txt"), "utf8");
  const status = await waitServer();
  log(`API приложения: ${APP}`);
  log(`LLM status: ${JSON.stringify(status)}`);
  log(`Провайдер ${PROVIDER}, модель ${MODEL}, черновиков главы ${CCC}`);

  const bodyPayload = {
    action: "generate_full_chapter",
    humanize: true,
    humanizeDepth: (process.env.DEPTH || "maximum"),
    chapterCandidates: CCC,
    llmProvider: PROVIDER,
    model: MODEL,
    title: "Вейпер Вася и трусы из паракорда",
    genre: "приключенческая фантастика",
    description: "Двое братьев вываливаются из привычного мира в чужой, где вещи и приборы ведут себя иначе; первая ночь в новом мире, следы искусственных сооружений.",
    currentChapterTitle: "Глава 5. За янтарной полосой",
    currentChapterSummary: "Илья остаётся один у металлической плиты: брат исчез, нож лежит не там, где висел; на стене загорается узкая янтарная полоса, похожая на индикатор отцовской магнитолы.",
    previousChapter: prev,
    worldBible: "Лес, река и пещера в чужом мире; в глубине — металлическая плита и коридор с серой дымкой, растворяющей камень; электроника (вейп) в поле отказывает; рядом живёт Гур, местный.",
    bookPlan: "1) первый день; 2) первая ночь; 3) чужой быт и еда; 4) пещера и плита; 5) потеря брата за полосой; 6) выход не туда, куда шли.",
    canonDossier: "Илья — старший, практичный, с ножом в поясном чехле, за спиной мешок с рыбой и бананами. Васька — младший, говорит быстро, таскает вейп. Лицо повествования — третье.",
    customPrompt: "Писать плотно, без объяснений от автора, много телесных деталей и звука.",
    authorSample: prev.slice(0, 6000),
    adaptiveStyleGuidance: prev.slice(0, 4000),
  };

  const t0 = Date.now();
  const res = await httpJson("POST", `${APP}/api/writer/ai`, bodyPayload, 45 * 60 * 1000);
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`API /api/writer/ai вернул ${res.status}: ${JSON.stringify(res.json).slice(0, 1000)}`);
  }
  const text = String(res.json?.result || "").trim();
  if (!text) throw new Error("API приложения вернул пустой result");
  const elapsedMs = Date.now() - t0;
  fs.writeFileSync(path.join(OUT, "chapter83.txt"), text, "utf8");
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(res.json, null, 2), "utf8");

  const report = res.json?.humanizeReport || {};
  const audit = aiTellScore(text);
  log(`API generate_full_chapter: ${elapsedMs} ms, ${text.length} симв., ${text.trim().split(/\s+/).length} слов`);
  log(`ответ модели/провайдера: ${JSON.stringify({ provider: res.json?.provider, model: res.json?.model })}`);
  log(`отчёт конвейера: ${JSON.stringify(report)}`);
  log(`локальный аудит финала: score=${audit.score} burst=${audit.burstiness.toFixed(3)} hits=${audit.hits.length}`);
  log(`МЕТРИКИ ПРИЛОЖЕНИЯ: ${JSON.stringify(metrics(text))}`);
  log("ГОТОВО");
}

main().catch((e) => log(`КРАХ: ${e instanceof Error ? e.stack : String(e)}`));
