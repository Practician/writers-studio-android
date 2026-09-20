/**
 * Живая проверка конвейера главы С ПАТЧАМИ ОЧЕЛОВЕЧИВАНИЯ через служебный LLM-шлюз платформы.
 * Контекст — свой (глава 4 «Вейпер Вася», восстановлен из docx прогона на APK 82),
 * поэтому проверяются механика конвейера, потолки и отчёт аудита, а не приватный мир книги.
 */
import fs from "node:fs";
import path from "node:path";
import {
  buildPersonaAndStyle,
  generateHumanizedChapter,
  type ChapterGenerateInput,
  type GenerateFn,
} from "../server/chapterGenerate.ts";
import { aiTellScore } from "../server/humanStyle.ts";

const OUT = process.env.OUTDIR || "/home/user/workspace/verify-app83";
const BASE = process.env.LLM_PROXY_BASE || "https://www.genspark.ai/api/llm_proxy/v1";
const TOKEN = process.env.GSK_TOKEN || "";
const MODEL = process.env.LIVE_MODEL || "gemini-2.5-flash";
const CCC = Number(process.env.CCC || 1);
const LOG = path.join(OUT, "log.txt");
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(LOG, "");
const log = (l: string) => {
  const s = `[${new Date().toISOString().slice(11, 19)}] ${l}`;
  fs.appendFileSync(LOG, s + "\n");
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let calls = 0, fails = 0;
async function proxyChat(messages: Array<{ role: string; content: string }>, opts: { maxTokens?: number; temperature?: number } = {}): Promise<string> {
  let tokens = Math.max(opts.maxTokens ?? 16000, 16000);
  let lastErr = "unknown";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    calls += 1;
    const t0 = Date.now();
    try {
      const res = await fetch(`${BASE}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({ model: MODEL, messages, temperature: opts.temperature ?? 0.7, max_tokens: tokens }),
      });
      const raw = await res.text();
      if (!res.ok) { lastErr = `HTTP ${res.status} ${raw.slice(0, 160)}`; log(`call #${calls} FAIL ${lastErr}`); await sleep(2500 * attempt); continue; }
      let text = "", finish = "";
      try { const j = JSON.parse(raw); text = j.choices?.[0]?.message?.content ?? ""; finish = j.choices?.[0]?.finish_reason ?? ""; }
      catch { lastErr = `не JSON: ${raw.slice(0, 160)}`; await sleep(2000 * attempt); continue; }
      if (!text.trim()) { lastErr = `пустой ответ (finish=${finish})`; log(`call #${calls} пусто, бюджет в размышления → ${tokens * 2}`); tokens = Math.min(tokens * 2, 48000); await sleep(1000); continue; }
      log(`call #${calls} ok ${text.length} симв. за ${Date.now() - t0} ms`);
      return text;
    } catch (err) { lastErr = err instanceof Error ? err.message : String(err); await sleep(2500 * attempt); }
  }
  fails += 1;
  throw new Error(`LLM-шлюз не ответил: ${lastErr}`);
}
const generate: GenerateFn = async (params) => {
  const headroom = Number(process.env.REASONING_HEADROOM ?? 12000);
  return proxyChat(
    [{ role: "system", content: params.systemInstruction || "" }, { role: "user", content: params.contents }],
    { maxTokens: (params.maxOutputTokens ?? 8000) + headroom, temperature: params.temperature ?? 0.7 },
  );
};
const prev = fs.readFileSync(path.join(OUT, "previous.txt"), "utf8");
const input: ChapterGenerateInput = {
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
  humanizeDepth: (process.env.DEPTH || "maximum") as any,
  authorSample: prev.slice(0, 6000),
  adaptiveStyleGuidance: prev.slice(0, 6000),
  model: MODEL,
  chapterCandidates: CCC,
};
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
    similes: c(/словно|будто|похоже на|наподобие/giu),
    silence: c(/не ответил|промолчал|молчал(?:а|и)?\b|вместо ответа/giu),
    freeze: c(/замер|застыл|замира/giu),
    plita: c(/плит/giu),
    ilyaPer1000: +(1000 * c(/Илья|Илье|Илью|Ильи|Илюх/giu) / Math.max(words.length, 1)).toFixed(1),
    vaskaPer1000: +(1000 * c(/Васьк|Вась/giu) / Math.max(words.length, 1)).toFixed(1),
  };
}
async function main() {
  log(`Шлюз: ${BASE}, модель ${MODEL}, черновиков главы ${CCC}`);
  const t0 = Date.now();
  const res = await generateHumanizedChapter(input, generate);
  fs.writeFileSync(path.join(OUT, "chapter82.txt"), res.text);
  const w = res.text.trim().split(/\s+/).length;
  log(`generateHumanizedChapter: ${Date.now() - t0} ms, ${res.text.length} симв., ${w} слов`);
  log(`отчёт конвейера: ${JSON.stringify(res.humanizeReport)}`);
  const audit = aiTellScore(res.text);
  log(`локальный аудит финала: score=${audit.score} burst=${audit.burstiness.toFixed(2)} hits=${audit.hits.length}`);
  const suc = aiTellScore(res.text);
  log(`МЕТРИКИ СТЕНДА: ${JSON.stringify(metrics(res.text))}`);
  log(`ИТОГО вызовов шлюза ${calls}, отказов ${fails}`);
  log("ГОТОВО");
}
main().catch((e) => log(`КРАХ: ${e instanceof Error ? e.stack : String(e)}`));
