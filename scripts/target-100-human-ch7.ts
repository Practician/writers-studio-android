/**
 * Цель: 100% HUMAN по Яндексу для гл.7.
 *
 * 1) Берём best (maximum / seed) + известный отчёт яндекс-maximum.json
 * 2) Детерминированная анти-AI правка (паттерны из mine-yandex-patterns)
 * 3) LLM-rewrite только AI/LIKELY_AI сегментов (NVIDIA → failover)
 * 4) Локальная оценка: aiTell + calibrated detector
 * 5) Live Yandex, если сеть пускает
 *
 * npx tsx scripts/target-100-human-ch7.ts
 */
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { aiTellScore } from "../server/humanStyle";
import {
  countWordsRu,
  rewriteDetectorAiSegments,
  russianLanguageIssues,
} from "../server/chapterGenerate";
import {
  getLlmStatus,
  llmGenerate,
  runWithProviderPreference,
} from "../server/llmProvider";
import {
  loadAdaptiveProfile,
  scoreCalibratedLocalDetector,
} from "../src/lib/adaptiveDetector";
import {
  LABYRINTH_AUTHOR_SAMPLE,
  LABYRINTH_STORY_ID,
  LABYRINTH_VOICE_SHEET,
} from "../src/data/labyrinthCanon";
import chapter7Seed from "../src/data/labyrinth/chapter-7.content";

const shellProvider = process.env.LLM_PROVIDER;
dotenv.config({ override: false });
if (shellProvider) process.env.LLM_PROVIDER = shellProvider;

const outDir = path.join(process.cwd(), "test-artifacts", "chapter7-100");
fs.mkdirSync(outDir, { recursive: true });

const provider = (process.env.LLM_PROVIDER || "nvidia") as "nvidia" | "gemini" | "groq" | "auto";

/** Известные AI-сегменты из яндекс-maximum (29.6%) — переписываем вручную+LLM. */
const AI_DREAM_WAKE = `После супа мать отправила меня готовиться. Я унёс тарелку, помыл ложку и сел за стол. Конспект лежит передо мной, ручка рядом, телефон показывает сообщения группы. Всё нормально. Вот только прочитал одну страницу и не понял ни слова.

«Ладно, ещё раз».

Вернулся к началу. Вместо формулы вижу зелёную двадцатку, потом кольца. Потёр глаза, встал, прошёлся по комнате. Во рту чувствовалась мята с мёдом. На кухне выпил кружку воды, заел хлебом — бесполезно.

«Чтобы это значило? Сон уже закончился, а вкус остался...»

Так и проходил до вечера от стола к кухне и обратно. Зачёт ближе не становился. Мама заглянула, потрогала мне лоб и сказала, что температуры нет, но вид у меня дурной. Пришлось обещать, что сейчас лягу.

Выключив свет, я стал рассматривать трещины над люстрой. Одна шла к окну, рядом две коротких. Насчитал восемь, сбился, начал сначала... В какой-то момент потолок исчез.

Открываю глаза — перед носом кольцо. Под щекой тёплый пол, кровати нет, тупик на месте!

«Однако... Вот и вернулся».

Достал телефон: двадцать процентов, связи нет.`;

/** Hand rewrite: меньше «резюме дня», больше жеста/шероховатости дневника (HUMAN-паттерны). */
const AI_DREAM_WAKE_REWRITE = `После супа мать отправила меня готовиться. Я унёс тарелку, помыл ложку — вода была тёплая, кран чуть подвывал. Сел. Конспект, ручка, телефон с сообщениями группы. Всё как всегда. Прочитал страницу. Слова стояли, смысл нет.

«Ладно, — подумал, — с начала».

Снова первая строка. А вместо формулы уже зелёная двадцатка. Потом кольца. Потёр глаза. Встал. Прошёлся до окна и обратно. Во рту мята с мёдом, хотя суп был обычный. На кухне долил кружку, откусил хлеба. Не помогло.

«Сон кончился, — сказал себе вполголоса, — а вкус остался. Ну и что с того».

День тянулся. Стол, кухня, снова стол. Зачёт не приближался. Мама заглянула, потрогала лоб.

— Температуры нет, а вид дурной. Ляг.

Я кивнул. Выключил свет. Лежал и считал трещины на потолке: одна к окну, две коротких рядом. Дошёл до восьми, сбился, начал сначала. В какой-то момент потолка не стало.

Открыл глаза. Перед носом — кольцо. Под щекой тёплый пол. Кровати нет. Тупик.

«Однако… — подумал. — Вот и вернулся».

Достал телефон. Около двадцати процентов. Связи нет.`;

const LIKELY_AI_EXIT = `Я протиснулся в щель.

За ней оказался обычный коридор, если в Лабиринте вообще бывает что-то обычное. Пол твёрже прежнего, стены гладкие, через одинаковые промежутки идут зелёные риски. Я достал ключ и сделал возле входа короткую царапину. Она вспыхнула синим.

«Работает! Значит, не всё поменялось».

Щель за спиной начала закрываться. Сначала сузилась до полосы, потом стена сошлась полностью. Вернуться уже не получится... Хотя я и не собирался. Наверное.

Пошёл вперёд, считая шаги. На тридцать седьмом вспомнил маму и сбился. «Справишься, Андрей». Голос был настоящий, суп тоже казался настоящим. Может, Лабиринт просто вытащил всё это из моей головы, а может быть, я действительно был дома. Разбираться сейчас бесполезно.

«Ладно, начинаем считать заново».

На стене впереди увидел выдавленную надпись: «Уровень 2». Потрогал буквы — холодные. Телефон всё ещё показывал около двадцати процентов, тепловизор включался, карты не было. Коридор немного поворачивал вправо.

Я остановился и прислушался. Тихо.

«Направо, значит направо. Мужики налево уже ходили!»

Улыбнувшись собственной глупости, я пошёл дальше.`;

const LIKELY_AI_EXIT_REWRITE = `Я протиснулся в щель боком. Плечо задело край — стена была мягче, чем казалась.

За ней коридор. Обычный, насколько тут бывает обычное. Пол твёрже. Стены гладкие. Зелёные риски через равные промежутки, как отметки на линейке. Достал ключ, чиркнул у входа. Царапина вспыхнула синим и погасла до тусклого шрама.

«Работает, — подумал. — Хоть что-то знакомое».

За спиной щель поехала. Сначала полоска, потом стена сомкнулась. Обратно уже не выйти. Я и не планировал. Наверное.

Пошёл, считая шаги вслух шёпотом. На тридцать седьмом вспомнил маму — «Справишься, Андрей» — и сбился. Голос из сна был как настоящий. Суп тоже. Может, Лабиринт вытащил это из головы. Может, я правда там был. Сейчас разбирать некогда.

«С нуля, — сказал себе. — Тридцать семь не считается».

Впереди на стене выдавленные буквы: «Уровень 2». Потрогал. Холодные. Телефон около двадцати процентов. Тепловизор включается. Карты нет. Коридор чуть уходит вправо.

Остановился. Послушал. Тишина.

«Направо так направо. Налево я уже ходил».

Усмехнулся и пошёл.`;

/** Жёсткая зачистка UI/латиницы/квест-лога — топ AI-штампов по mine-yandex. */
export function deterministicAntiYandexAi(text: string): string {
  let t = text;
  t = t.replace(/\bNFC\b/g, "бесконтакт");
  t = t.replace(/\bCW\b|\bCCW\b/g, "");
  t = t.replace(/\bOK\b/g, "ок");
  t = t.replace(/\blevel\b/gi, "уровень");
  t = t.replace(/\bRisks?\b/g, "риски");
  t = t.replace(/\bthink\b/gi, "");
  t = t.replace(/обнаружена\s+новая\s+метка/giu, "телефон коротко бзикнул — будто что-то записал");
  t = t.replace(/не\s+найдено\s*:\s*\d+/giu, "");
  t = t.replace(/^\s*\d+\.\s+.+$/gmu, ""); // numbered quest lines
  // не больше 2 «что дальше / и что дальше»
  let chto = 0;
  t = t.replace(/и\s+что\s+дальше\?/giu, (m) => {
    chto += 1;
    return chto <= 1 ? "и что теперь?" : "";
  });
  t = t.replace(/что\s+дальше\?/giu, (m) => {
    chto += 1;
    return chto <= 2 ? m : "ладно";
  });
  t = t.replace(/Начну снова\.?\s*/giu, "");
  t = t.replace(/\d{1,2}\s*:\s*\d{2}/g, "");
  t = t.replace(/\d+\s*часа\s*\d+\s*минут/giu, "");
  t = t.replace(/\n{3,}/g, "\n\n");
  t = t.replace(/[ \t]+\n/g, "\n");
  return t.trim() + "\n";
}

function normalizeForMatch(s: string): string {
  return s
    .replace(/\u00a0/g, " ")
    .replace(/[ёЁ]/g, "е")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function replaceFlexible(haystack: string, needle: string, replacement: string): string {
  if (haystack.includes(needle)) return haystack.replace(needle, replacement);
  // fallback: collapse whitespace match
  const n = normalizeForMatch(needle);
  const parts = haystack.split(/\n\n+/);
  let joined = haystack;
  const collapsed = normalizeForMatch(haystack);
  if (!collapsed.includes(n.slice(0, 80))) return haystack;
  // try paragraph-level
  for (let i = 0; i < parts.length; i++) {
    if (normalizeForMatch(parts[i]).includes(n.slice(0, 60))) {
      // multi-para block: find contiguous
    }
  }
  // simple: replace first long common prefix region via index of unique phrase
  const key = needle.slice(0, 40);
  const idx = haystack.indexOf(key);
  if (idx < 0) {
    // try without ё
    const key2 = key.replace(/ё/g, "е");
    const h2 = haystack.replace(/ё/g, "е");
    const idx2 = h2.indexOf(key2);
    if (idx2 < 0) return haystack;
  }
  // If exact needle not found, do phrase-based splice using start/end anchors
  const startAnchor = needle.slice(0, 50);
  const endAnchor = needle.slice(-50);
  const si = haystack.indexOf(startAnchor);
  const ei = haystack.lastIndexOf(endAnchor);
  if (si >= 0 && ei > si) {
    return haystack.slice(0, si) + replacement + haystack.slice(ei + endAnchor.length);
  }
  return haystack;
}

async function yandexLive(text: string, name: string): Promise<{ pct: number; report: any } | null> {
  try {
    const res = await fetch("https://yandex.ru/lab/neurodetector/api/analyze/text", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Accept: "application/json",
        Origin: "https://yandex.ru",
        Referer: "https://yandex.ru/lab/neurodetector",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      },
      body: JSON.stringify({ text: text.slice(0, 14_000) }),
    });
    const raw = await res.text();
    if (!res.ok) {
      console.log(`  Yandex ${name}: HTTP ${res.status} ${raw.slice(0, 120)}`);
      return null;
    }
    const data = JSON.parse(raw);
    const report = data.results || data;
    fs.writeFileSync(path.join(outDir, `yandex-${name}.json`), JSON.stringify(report, null, 2), "utf8");
    let ai = 0;
    let tot = 0;
    for (const s of report.segments || []) {
      const len = s.len || (s.text || "").length;
      tot += len;
      if (s.label === "AI" || s.label === "LIKELY_AI") ai += len;
    }
    const pct = tot ? (100 * ai) / tot : 0;
    console.log(
      `  Yandex ${name}: AI%=${pct.toFixed(1)} H=${report.stats?.HUMAN_count ?? "?"} AI=${report.stats?.AI_count ?? "?"}`,
    );
    return { pct, report };
  } catch (e) {
    console.log(`  Yandex ${name}: unavailable (${e instanceof Error ? e.message : e})`);
    return null;
  }
}

function localScore(label: string, text: string) {
  const profile = loadAdaptiveProfile(LABYRINTH_STORY_ID);
  const cal = scoreCalibratedLocalDetector(text, profile);
  const tell = aiTellScore(text);
  const lang = russianLanguageIssues(text);
  console.log(
    `  [${label}] words=${countWordsRu(text)} aiTell=${tell.score} burst=${tell.burstiness.toFixed(2)}`
    + ` calHUMAN=${cal?.calibratedHumanProbability}%→${cal?.predictedLabel}`
    + ` style=${cal?.adaptiveHumanProbability}% lang=${lang.length ? lang[0] : "ok"}`,
  );
  return { tell, cal, lang };
}

function loadBaseText(): string {
  const candidates = [
    path.join(process.cwd(), "test-artifacts", "chapter7", "глава-7-maximum.txt"),
    path.join(process.cwd(), "test-artifacts", "chapter7", "глава-7-final.txt"),
    path.join(process.cwd(), "src", "data", "labyrinth", "chapter-7.txt"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      console.log("Base:", p);
      return fs.readFileSync(p, "utf8");
    }
  }
  return chapter7Seed;
}

async function main() {
  console.log("=== Target 100% HUMAN chapter 7 ===\n");
  console.log("LLM status", {
    provider,
    nvidia: getLlmStatus().nvidiaConfigured,
    gemini: getLlmStatus().geminiKeys,
  });

  let text = loadBaseText();
  fs.writeFileSync(path.join(outDir, "00-base.txt"), text, "utf8");
  console.log("\n0) Base scores");
  localScore("base", text);

  // 1) Deterministic splice of known bad segments
  console.log("\n1) Deterministic rewrite of known AI segments (from yandex-maximum 29.6%)");
  let step1 = text;
  step1 = replaceFlexible(step1, AI_DREAM_WAKE, AI_DREAM_WAKE_REWRITE);
  // also try without ё variants by normalizing source block from file
  if (step1 === text) {
    // looser: replace between unique anchors
    const a = "После супа мать отправила меня готовиться";
    const b = "Достал телефон: двадцать процентов, связи нет.";
    const b2 = "Достал телефон: двадцать процентов, связи нет";
    const si = step1.indexOf(a);
    let ei = step1.indexOf(b, si);
    if (ei < 0) ei = step1.indexOf(b2, si);
    if (si >= 0 && ei > si) {
      const endLen = step1.includes(b) ? b.length : b2.length;
      step1 = step1.slice(0, si) + AI_DREAM_WAKE_REWRITE.trim() + step1.slice(ei + endLen);
      console.log("  spliced dream-wake by anchors");
    } else {
      console.log("  warn: dream-wake block not found");
    }
  } else {
    console.log("  replaced dream-wake exact");
  }

  const a2 = "Я протиснулся в щель";
  const bEnd = "Улыбнувшись собственной глупости, я пошёл дальше.";
  const bEnd2 = "Улыбнувшись собственной глупости, я пошел дальше.";
  if (step1.includes(LIKELY_AI_EXIT.trim().slice(0, 40))) {
    step1 = replaceFlexible(step1, LIKELY_AI_EXIT, LIKELY_AI_EXIT_REWRITE);
    console.log("  replaced exit block flexible");
  } else {
    const si = step1.lastIndexOf(a2);
    let ei = step1.lastIndexOf(bEnd);
    if (ei < 0) ei = step1.lastIndexOf(bEnd2);
    if (si >= 0 && ei > si) {
      const endLen = step1.includes(bEnd) ? bEnd.length : bEnd2.length;
      step1 = step1.slice(0, si) + LIKELY_AI_EXIT_REWRITE.trim() + step1.slice(ei + endLen);
      console.log("  spliced exit by anchors");
    } else {
      console.log("  warn: exit block not found");
    }
  }

  step1 = deterministicAntiYandexAi(step1);
  fs.writeFileSync(path.join(outDir, "01-deterministic.txt"), step1, "utf8");
  localScore("deterministic", step1);

  // 2) LLM rewrite AI-flagged chunks via synthetic detector segments
  console.log("\n2) LLM rewrite of remaining high-risk spans (NVIDIA preferred)");
  const segments = [
    { text: AI_DREAM_WAKE_REWRITE, label: "AI" as const },
    { text: LIKELY_AI_EXIT_REWRITE, label: "LIKELY_AI" as const },
    // include middle human glue so reassembler has context? rewrite only AI
  ];

  // Build full segment list from current text by splitting into ~1k char chunks for detector-style rewrite
  // Better: rewrite only the two blocks in place after LLM polishes them
  const generate = async (params: {
    model: string;
    contents: string;
    systemInstruction: string;
    temperature: number;
    responseMimeType?: string;
    responseSchema?: unknown;
    maxOutputTokens?: number;
  }) => {
    const r = await llmGenerate({
      model: params.model,
      contents: params.contents,
      systemInstruction: params.systemInstruction,
      temperature: params.temperature,
      responseMimeType: params.responseMimeType,
      responseSchema: params.responseSchema,
      maxOutputTokens: params.maxOutputTokens,
    });
    console.log(`    [llm ${r.provider}/${r.model} fo=${r.failoverCount ?? 0}]`);
    return r.text;
  };

  let polishedDream = AI_DREAM_WAKE_REWRITE;
  let polishedExit = LIKELY_AI_EXIT_REWRITE;
  try {
    const result = await runWithProviderPreference(provider, () =>
      rewriteDetectorAiSegments(
        [
          { text: "Я сидел у тупиковой стены. Заряд двадцать. Не сейчас.", label: "HUMAN" },
          { text: AI_DREAM_WAKE_REWRITE, label: "AI" },
          { text: "Под ногтями грязь. Подошёл к отпечатку.", label: "HUMAN" },
          { text: LIKELY_AI_EXIT_REWRITE, label: "LIKELY_AI" },
        ],
        generate,
        {
          model: process.env.NVIDIA_DEFAULT_MODEL || "deepseek-ai/deepseek-v4-flash",
          personaBlock: LABYRINTH_VOICE_SHEET.summary + "\n" + LABYRINTH_VOICE_SHEET.voiceRules.join("\n"),
          humanizeDepth: "maximum",
        },
      ),
    );
    // Extract polished blocks from full reassembly roughly by anchors
    const full = result.text;
    fs.writeFileSync(path.join(outDir, "02-llm-segments.txt"), full, "utf8");
    console.log("  rewriteDetector done, refined", result.rewrittenCount, "scoreAfter", result.humanizeReport.scoreAfter);

    // Map back into step1 using our rewrites as search keys
    if (full.includes("После супа") || full.includes("После супа")) {
      // use entire llm output as chapter if similar length
      if (countWordsRu(full) > 800) {
        step1 = deterministicAntiYandexAi(full);
        console.log("  used full LLM reassembly as chapter body");
      }
    }
    // Prefer splicing polished middle if we can find parts
    const dreamStart = full.indexOf("После супа");
    const exitStart = full.lastIndexOf("протиснулся");
    if (dreamStart >= 0) {
      // keep step1 structure: replace dream section with llm dream portion
    }
    void polishedDream;
    void polishedExit;
  } catch (e) {
    console.log("  LLM rewrite failed:", e instanceof Error ? e.message : e);
    console.log("  continuing with deterministic rewrites only");
  }

  // Ensure our deterministic rewrites are in the final text even if LLM path odd
  let finalText = step1;
  // If LLM replaced whole body poorly, re-apply deterministic on seed-like base
  if (countWordsRu(finalText) < 700 || russianLanguageIssues(finalText).length) {
    console.log("  fallback: re-apply deterministic on original base");
    finalText = loadBaseText();
    const a = "После супа мать отправила меня готовиться";
    const si = finalText.indexOf(a);
    const b2 = "Достал телефон: двадцать процентов, связи нет";
    const ei = finalText.indexOf(b2, si);
    if (si >= 0 && ei > si) {
      finalText =
        finalText.slice(0, si)
        + AI_DREAM_WAKE_REWRITE.trim()
        + finalText.slice(ei + b2.length);
    }
    const si2 = finalText.lastIndexOf("Я протиснулся в щель");
    const bEnd = "я пошёл дальше.";
    const bEnd2 = "я пошел дальше.";
    let ei2 = finalText.lastIndexOf(bEnd);
    if (ei2 < 0) ei2 = finalText.lastIndexOf(bEnd2);
    if (si2 >= 0 && ei2 > si2) {
      finalText =
        finalText.slice(0, si2)
        + LIKELY_AI_EXIT_REWRITE.trim()
        + finalText.slice(ei2 + (finalText.includes(bEnd) ? bEnd.length : bEnd2.length));
    }
    finalText = deterministicAntiYandexAi(finalText);
  }

  // 3) Optional full touchup pass on AI-risk paragraphs only (local flag)
  finalText = deterministicAntiYandexAi(finalText);
  // Soft: ensure no NFC/UI spam left
  finalText = finalText
    .replace(/список\s+NFC/gi, "список меток")
    .replace(/NFC-метк/gi, "метка");

  fs.writeFileSync(path.join(outDir, "03-final.txt"), finalText, "utf8");
  // Also write into chapter7 artifacts for comparison
  fs.writeFileSync(
    path.join(process.cwd(), "test-artifacts", "chapter7", "глава-7-target-100.txt"),
    finalText,
    "utf8",
  );

  console.log("\n3) Final local scores");
  const finalLocal = localScore("final", finalText);

  // Pattern checklist (proxy for Yandex 100%)
  const checks = {
    noLatinUi: !/\b(NFC|CW|CCW|OK|level|think|Risks)\b/i.test(finalText),
    noQuestNumberLines: !/^\s*\d+\.\s+\S/m.test(finalText),
    noMetkaSpam: (finalText.match(/обнаружена\s+новая\s+метка/giu) || []).length === 0,
    noNachnuSnova: !/Начну снова/i.test(finalText),
    noClockStamp: !/\d{1,2}:\d{2}/.test(finalText),
    chtoDalsheLeq2: (finalText.match(/что\s+дальше/giu) || []).length <= 2,
    hasPalm: /отпечаток|ладон/i.test(finalText),
    has20: /20\s*%|двадцат\w*\s+процент/i.test(finalText) || /число\s*20/i.test(finalText),
    hasLevel2: /уровень\s*2/i.test(finalText),
    wordsGe900: countWordsRu(finalText) >= 900,
    aiTellLeq8: finalLocal.tell.score <= 8,
    calibratedHuman: (finalLocal.cal?.calibratedHumanProbability ?? 0) >= 55
      && finalLocal.cal?.predictedLabel === "HUMAN",
    russianOk: finalLocal.lang.length === 0,
  };
  console.log("\n4) Pattern checklist (Yandex proxy for 100% HUMAN)");
  let pass = 0;
  let total = 0;
  for (const [k, v] of Object.entries(checks)) {
    total += 1;
    if (v) pass += 1;
    console.log(`  ${v ? "✓" : "✗"} ${k}`);
  }

  console.log("\n5) Live Yandex (if available)");
  const y = await yandexLive(finalText, "final");

  const report = {
    createdAt: new Date().toISOString(),
    provider,
    words: countWordsRu(finalText),
    local: {
      aiTell: finalLocal.tell.score,
      burst: finalLocal.tell.burstiness,
      calibratedHuman: finalLocal.cal?.calibratedHumanProbability,
      predicted: finalLocal.cal?.predictedLabel,
    },
    checklist: checks,
    checklistPass: `${pass}/${total}`,
    yandexAiPct: y?.pct ?? null,
    yandexStats: y?.report?.stats ?? null,
    goal: "100% HUMAN on Yandex",
    goalMet: y ? y.pct === 0 : null,
    note: y
      ? y.pct === 0
        ? "GOAL MET: 0% AI on Yandex"
        : `Yandex AI%=${y.pct.toFixed(1)} — iterate AI segments again`
      : "Yandex API unreachable from this host; checklist + local detector used as proxy. Upload 03-final.txt to https://yandex.ru/lab/neurodetector manually.",
    outputs: {
      final: path.join(outDir, "03-final.txt"),
      also: "test-artifacts/chapter7/глава-7-target-100.txt",
    },
  };
  fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2), "utf8");

  console.log("\n=== Summary ===");
  console.log(JSON.stringify(report, null, 2));
  if (y && y.pct === 0) {
    console.log("\nSUCCESS: 100% HUMAN (0% AI chars on Yandex)");
  } else if (!y) {
    console.log("\nYandex offline — open test-artifacts/chapter7-100/03-final.txt in neurodetector manually.");
  }
  // non-zero exit only if local checklist critical fails
  if (!checks.noLatinUi || !checks.russianOk || !checks.wordsGe900 || !checks.hasLevel2) {
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
