/**
 * Живой прогон конвейера главы (сборка 82 + патчи очеловечивания) на ключе автора.
 *
 * Отличие от прежней версии стенда: пул ключей и ЦЕПОЧКА МОДЕЛЕЙ как в приложении
 * (server/llmProvider.ts: collectGeminiKeys + BUILTIN_GEMINI_FALLBACKS + кулдаун).
 * Прежний стенд был прибит к одной модели и умирал на 429 — приложение так не делает:
 * оно уводит исчерпанную модель в кулдаун и берёт следующую.
 *
 * Прогоны: A — прежнее правило ритма (RHYTHM_RULE_OLD=1) при патченом gate;
 *          B — все патчи (правило ритма переписано, стаккато/диалог/gate);
 *          C — контроль: одна сырая генерация без конвейера.
 */
import fs from "node:fs";
import path from "node:path";
import {
  generateHumanizedChapter,
  type ChapterGenerateInput,
  type GenerateFn,
} from "../server/chapterGenerate.ts";
import { aiTellScore } from "../server/humanStyle.ts";

const OUT = process.env.OUTDIR || "/home/user/workspace/gemini-run83";
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, "log.txt");
const log = (s: string) => {
  const l = `[${new Date().toISOString().slice(11, 19)}] ${s}`;
  console.log(l);
  fs.appendFileSync(LOG, l + "\n");
};

function keyPool(): string[] {
  const keys: string[] = [];
  const push = (v?: string) => {
    const t = (v || "").trim();
    if (t && !keys.includes(t)) keys.push(t);
  };
  push(process.env.GEMINI_API_KEY);
  for (let i = 2; i <= 9; i += 1) push(process.env[`GEMINI_API_KEY_${i}`]);
  for (const p of [
    "/home/user/.gemini_key", "/home/user/.gemini_key_2", "/home/user/.gemini_key_3",
    "/home/user/.gemini_key_4", "/home/user/.gemini_key_5",
  ]) {
    try { push(fs.readFileSync(p, "utf8")); } catch { /* нет файла — пропускаем */ }
  }
  return keys;
}
const KEYS = keyPool();
if (!KEYS.length) throw new Error("нет ни одного ключа Gemini");

// Цепочка моделей — порядок приложения + живые на этом ключе запасные.
const MODEL_CHAIN = (process.env.MODELS
  || "gemini-3.8-flash,gemini-flash-latest,gemini-3.6-flash,gemini-3.7-flash,gemini-2.5-flash,gemini-2.5-flash-lite,gemini-3.5-flash-lite")
  .split(",").map((m) => m.trim()).filter(Boolean);

const cooldown = new Map<string, number>();
const deadModels = new Set<string>();
let calls = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function send(model: string, key: string, system: string, prompt: string, temperature: number, maxOutputTokens: number, thinkingOff: boolean) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature, maxOutputTokens,
      ...(thinkingOff ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
    },
  });
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body,
  });
  return { res, raw: await res.text() };
}

async function gemini(system: string, prompt: string, temperature = 0.7, maxOutputTokens = 16000): Promise<{ text: string; model: string }> {
  const problems: string[] = [];
  for (let pass = 0; pass < 3; pass += 1) {
    for (const model of MODEL_CHAIN) {
      if (deadModels.has(model)) continue;
      for (let ki = 0; ki < KEYS.length; ki += 1) {
        const id = `${model}|${ki}`;
        if ((cooldown.get(id) ?? 0) > Date.now()) continue;
        calls += 1;
        const n = calls;
        const t0 = Date.now();
        let { res, raw } = await send(model, KEYS[ki], system, prompt, temperature, maxOutputTokens, true);
        if (!res.ok && /thinking|Invalid JSON payload/i.test(raw)) {
          ({ res, raw } = await send(model, KEYS[ki], system, prompt, temperature, maxOutputTokens, false));
        }
        if (res.ok) {
          try {
            const j = JSON.parse(raw);
            const cand = j.candidates?.[0];
            const text = (cand?.content?.parts ?? []).map((p: any) => p.text ?? "").join("");
            if (text.trim()) {
              log(`call #${n} ${model} (ключ ${ki + 1}/${KEYS.length}) ok ${text.length} симв. за ${Date.now() - t0} ms finish=${cand?.finishReason}`);
              return { text, model };
            }
            problems.push(`${model}: пустой ответ (finish=${cand?.finishReason}, block=${j.promptFeedback?.blockReason})`);
            continue;
          } catch (e) {
            problems.push(`${model}: не разобран JSON — ${(e as Error).message.slice(0, 120)}`);
            continue;
          }
        }
        if (res.status === 429) {
          cooldown.set(id, Date.now() + 90_000);
          problems.push(`${model}: 429 quota`);
          log(`call #${n} ${model} → 429, модель в кулдаун 90 с, беру следующую`);
          continue;
        }
        if (res.status === 400 && /INVALID_ARGUMENT|unsupported|not found|not supported/i.test(raw)) {
          deadModels.add(model);
          problems.push(`${model}: 400 INVALID_ARGUMENT`);
          log(`${model} → 400 INVALID_ARGUMENT, снимаю модель с прогона`);
          break;
        }
        if ([500, 502, 503, 504].includes(res.status)) {
          problems.push(`${model}: HTTP ${res.status}`);
          log(`call #${n} ${model} → HTTP ${res.status}, пауза ${3 * (pass + 1)} с`);
          await sleep(3000 * (pass + 1));
          continue;
        }
        problems.push(`${model}: HTTP ${res.status} ${raw.slice(0, 160)}`);
      }
    }
    log(`весь пул на кулдауне/не ответил — пауза 30 с (проход ${pass + 1}/3); последнее: ${problems.slice(-3).join(" | ")}`);
    await sleep(30_000);
  }
  throw new Error("нет доступной пары ключ×модель: " + problems.slice(-5).join(" | "));
}

const generate: GenerateFn = async (params) => (await gemini(
  params.systemInstruction || "",
  params.contents,
  params.temperature ?? 0.7,
  (params.maxOutputTokens ?? 8000) + 12000,
)).text;

const prev = fs.readFileSync("/home/user/workspace/verify-app82/previous.txt", "utf8");
const baseInput: ChapterGenerateInput = {
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
  humanizeDepth: "maximum",
  authorSample: prev.slice(0, 6000),
  adaptiveStyleGuidance: prev.slice(0, 6000),
  model: MODEL_CHAIN[0],
  chapterCandidates: Number(process.env.CCC || 1),
};

export function metrics(t: string) {
  const body = t.replace(/^.*?Синопсис:[^\n]*\n?/s, "");
  const words = body.match(/[\p{L}\p{N}'’-]+/gu) ?? [];
  const sents = body.split(/(?<=[.!?…])\s+/).filter((s) => s.trim());
  const lens = sents.map((s) => (s.match(/[\p{L}\p{N}'’-]+/gu) ?? []).length);
  const avg = lens.reduce((a, b) => a + b, 0) / Math.max(lens.length, 1);
  const sd = Math.sqrt(lens.reduce((a, b) => a + (b - avg) ** 2, 0) / Math.max(lens.length, 1));
  const c = (re: RegExp) => (body.match(re) ?? []).length;
  const paragraphs = body.split(/\n{2,}/).filter((p) => p.trim().length > 0);
  const dialogue = sents.filter((s) => /^\s*[—–―-]\s/u.test(s.trim()) || /^[«"„”]/.test(s.trim())).length;
  return {
    words: words.length,
    paragraphs: paragraphs.length,
    sentences: sents.length,
    avgSentence: +avg.toFixed(2),
    sdSentence: +sd.toFixed(2),
    shortUnder5: +(100 * lens.filter((l) => l < 5).length / Math.max(lens.length, 1)).toFixed(1),
    long25plus: lens.filter((l) => l >= 25).length,
    dialogueShare: +(100 * dialogue / Math.max(sents.length, 1)).toFixed(1),
    maxShortChain: (() => {
      let chain = 0, best = 0;
      for (const l of lens) { if (l <= 4) { chain += 1; best = Math.max(best, chain); } else chain = 0; }
      return best;
    })(),
    similes: c(/словно|будто|похоже на|наподобие|как будто/giu),
    silence: c(/не ответил|промолчал|молчал(?:а|и)?\b|вместо ответа/giu),
    freeze: c(/замер|застыл|замира/giu),
    plita: c(/плит/giu),
    ilyaPer1000: +(1000 * c(/Илья|Илье|Илью|Ильи|Илюх/giu) / Math.max(words.length, 1)).toFixed(1),
    thoughtVerbs: c(/\b(?:подумал|подумала|решил|решила|понял|поняла|осознал|вспомнил|представил|казалось|показалось)\b/giu),
    dialogLines: c(/^\s*[—–-]\s*/gmu),
  };
}

function auditLine(t: string) {
  const a = aiTellScore(t);
  return {
    gateScore: a.score,
    diagnosticScore: a.diagnosticScore,
    staccato: a.staccatoComponent,
    thoughtPenalty: a.thoughtPenalty,
    burstiness: +a.burstiness.toFixed(3),
    openerRepetition: +a.openerRepetition.toFixed(3),
    shortShare: +(a.shortShare ?? 0).toFixed(3),
    maxShortChain: a.maxShortChain,
    dialogueShare: +(a.dialogueShare ?? 0).toFixed(3),
    hits: a.hits.length,
    topHits: a.hits.slice(0, 12).map((h: any) => h.id ?? h.label),
  };
}

async function runPipeline(tag: string, file: string) {
  log(`=== прогон ${tag}: конвейер, глубина maximum, черновиков ${baseInput.chapterCandidates}, правило ритма ${process.env.RHYTHM_RULE_OLD ? "ПРЕЖНЕЕ" : "НОВОЕ"}`);
  const t0 = Date.now();
  const res = await generateHumanizedChapter(baseInput, generate);
  fs.writeFileSync(path.join(OUT, file), res.text);
  log(`${tag}: ${Date.now() - t0} ms, ${res.text.length} симв.`);
  log(`${tag} отчёт: ${JSON.stringify(res.humanizeReport)}`);
  const m = metrics(res.text);
  const a = auditLine(res.text);
  log(`${tag} метрики: ${JSON.stringify(m)}`);
  log(`${tag} аудит: ${JSON.stringify(a)}`);
  return { tag, file, chars: res.text.length, report: res.humanizeReport, metrics: m, audit: a };
}

async function runRaw() {
  log("=== прогон C: сырая генерация без конвейера (контроль)");
  const system = "Ты — русскоязычный прозаик. Пиши сцену художественной прозы без пояснений от автора.";
  const prompt = [
    "КОНТЕКСТ КНИГИ:", baseInput.worldBible,
    "ПЛАН КНИГИ:", baseInput.bookPlan,
    "КАНОН:", baseInput.canonDossier,
    "ПРЕДЫДУЩАЯ ГЛАВА (фрагмент, для голоса и непрерывности):", prev.slice(0, 6000),
    "ЗАДАЧА: напиши главу «Глава 5. За янтарной полосой» (синопсис: " + baseInput.currentChapterSummary + ").",
    "Объём: примерно 1100-1300 слов. Лицо повествования — третье. Язык — русский.",
  ].join("\n\n");
  const t0 = Date.now();
  const out = await gemini(system, prompt, 0.85, 16000);
  fs.writeFileSync(path.join(OUT, "chapter-C.txt"), out.text);
  log(`C: ${Date.now() - t0} ms, ${out.text.length} симв., модель ${out.model}`);
  const m = metrics(out.text);
  const a = auditLine(out.text);
  log(`C метрики: ${JSON.stringify(m)}`);
  log(`C аудит: ${JSON.stringify(a)}`);
  return { tag: "C", file: "chapter-C.txt", chars: out.text.length, metrics: m, audit: a };
}

async function main() {
  log(`ключей в пуле: ${KEYS.length}; цепочка моделей: ${MODEL_CHAIN.join(" → ")}`);
  const results: any[] = [];
  const step = async (label: string, fn: () => Promise<any>) => {
    try { results.push(await fn()); }
    catch (e) { log(`${label} не удался: ${e instanceof Error ? e.message.slice(0, 300) : String(e)}`); }
  };
  const runs = process.env.RUNS || "BAC";
  if (runs.includes("A")) {
    process.env.RHYTHM_RULE_OLD = "1";
    await step("A-old-rhythm", () => runPipeline("A-old-rhythm", "chapter-A.txt"));
  }
  if (runs.includes("B")) {
    delete process.env.RHYTHM_RULE_OLD;
    await step("B-all-patches", () => runPipeline("B-all-patches", "chapter-B.txt"));
  }
  if (runs.includes("C")) await step("C-raw", () => runRaw());
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ calls, models: MODEL_CHAIN, results }, null, 2));
  log(`ИТОГО вызовов Google: ${calls}`);
  log("ГОТОВО");
}

main().catch((e) => log(`КРАХ: ${e instanceof Error ? e.stack : String(e)}`));
