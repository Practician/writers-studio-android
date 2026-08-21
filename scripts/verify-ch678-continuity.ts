/**
 * Проверка стыка 6→7→8: unit-гейты + live-генерация 7 и 8 + continuity checks + AI-tell.
 *
 * npx tsx scripts/verify-ch678-continuity.ts
 * SKIP_LIVE=1 — только offline checks (без LLM)
 * QUICK=1 — depth=fast, без yandex
 */
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { aiTellScore } from "../server/humanStyle";
import {
  countWordsRu,
  fallbackBeatsFromSynopsis,
  generateHumanizedChapter,
  russianLanguageIssues,
} from "../server/chapterGenerate";
import {
  getLlmStatus,
  llmGenerate,
  runWithProviderPreference,
  type ProviderPreference,
} from "../server/llmProvider";
import {
  LABYRINTH_AUTHOR_SAMPLE,
  LABYRINTH_BOOK_PLAN,
  LABYRINTH_VOICE_SHEET,
  LABYRINTH_WORLD_BIBLE,
  buildLabyrinthChapters,
  mergeLabyrinthCanonIntoStories,
  shouldKeepUserChapterContent,
} from "../src/data/labyrinthCanon";
import { canonDossier, extractContinuityAnchors } from "../src/lib/chapterContext";
import type { Story } from "../src/types";

// Не затирать CLI/shell env значениями из .env (иначе LLM_PROVIDER=nvidia → auto из .env)
const shellProvider = process.env.LLM_PROVIDER;
const shellDepth = process.env.HUMANIZE_DEPTH;
const shellSkipLive = process.env.SKIP_LIVE;
const shellQuick = process.env.QUICK;
dotenv.config({ override: false });

const outDir = path.resolve(process.cwd(), "test-artifacts", "ch678-verify");
fs.mkdirSync(outDir, { recursive: true });

const skipLive = (shellSkipLive ?? process.env.SKIP_LIVE) === "1";
const quick = (shellQuick ?? process.env.QUICK) === "1";
const depth = quick ? "fast" : (shellDepth || process.env.HUMANIZE_DEPTH || "balanced");
const provider = (shellProvider || process.env.LLM_PROVIDER || "nvidia") as ProviderPreference;

type Check = { id: string; ok: boolean; detail: string };

function check(id: string, ok: boolean, detail: string): Check {
  console.log(`  ${ok ? "✓" : "✗"} ${id}: ${detail}`);
  return { id, ok, detail };
}

function continuityChecks(text: string, chapter: 7 | 8): Check[] {
  const t = text.toLocaleLowerCase("ru");
  const checks: Check[] = [];

  // Откат к 2–3% без прогресса
  const lowCharge =
    /(?:заряд[^\n.%]{0,30}?|около\s+|примерно\s+)(?:2|3)\s*%/.test(text)
    || /(?:2|3)\s*%\s*(?:заряд|батаре)/i.test(text);
  const has20 = /20\s*%|двадцать\s+процент/i.test(text);
  checks.push(
    check(
      `ch${chapter}-no-false-2pct`,
      !(lowCharge && !has20),
      lowCharge && !has20
        ? "похоже на откат к 2–3% без 20%"
        : has20
          ? "есть ~20% (ок)"
          : lowCharge
            ? "есть низкий % — смотри контекст"
            : "явного 2% отката нет",
    ),
  );

  // Полная переигровка колец гл.6
  const reSolveRings =
    /три\s+кольц/i.test(text)
    && /двенадцат/i.test(text)
    && /(?:крут|враща|по\s+часов|против\s+часов)/i.test(text)
    && /(?:поймать|ярк(ая|ую)\s+20|число\s+стало)/i.test(text);
  checks.push(
    check(
      `ch${chapter}-no-rerun-rings`,
      !reSolveRings,
      reSolveRings ? "похоже на повторную сборку колец гл.6" : "колец «с нуля» нет",
    ),
  );

  // Повтор «мята+заряд с нуля» как главная награда гл.6
  const reEatCharge =
    /мятн/i.test(t)
    && /(?:положил\s+телефон|заряжа)/i.test(t)
    && /(?:голод|жажда).{0,40}(?:ушл|пропал|исчез)/i.test(t)
    && chapter === 8;
  checks.push(
    check(
      `ch${chapter}-no-ch6-resource-plot`,
      !reEatCharge,
      reEatCharge ? "похоже на повтор сюжета ресурса гл.6" : "сюжет ресурса 6-й не повторен",
    ),
  );

  if (chapter === 7) {
    const hasPalm = /отпечаток|ладон/i.test(text);
    const hasDream = /сон|институт|мама|аудитор/i.test(text);
    const hasLevel2 = /уровень\s*2|ур\.?\s*2|щель/i.test(text);
    checks.push(check("ch7-palm", hasPalm, hasPalm ? "есть ладонь/отпечаток" : "нет отпечатка"));
    checks.push(check("ch7-dream-or-rest", hasDream || /сел|уснул|глаза/i.test(text), hasDream ? "есть сон/институт" : "сон слабый — допустимо при fast"));
    checks.push(check("ch7-level2-hook", hasLevel2, hasLevel2 ? "есть Ур.2/щель" : "нет выхода на Ур.2"));
  }

  if (chapter === 8) {
    const onL2 = /уровень\s*2|ур\.?\s*2|зелён(ые|ых)\s+риск|риск/i.test(text);
    const mapOrSensors = /карт|датчик|магнит|барометр|шаг/i.test(text);
    const notPalmFocus = !(/приложил\s+ладонь/i.test(text) && /янтар/i.test(text) && /щель/i.test(text));
    checks.push(check("ch8-on-level2", onL2, onL2 ? "есть маркеры Ур.2" : "слабые маркеры Ур.2"));
    checks.push(check("ch8-map-or-sensors", mapOrSensors, mapOrSensors ? "карта/датчики/шаги" : "нет карты/датчиков"));
    checks.push(check("ch8-not-replay-palm", notPalmFocus, notPalmFocus ? "не переигрывает ладонь 7-й" : "похоже на повтор активации ладони"));
  }

  const lang = russianLanguageIssues(text);
  checks.push(check(`ch${chapter}-russian`, lang.length === 0, lang.length ? lang.join("; ") : "только русский"));

  const words = countWordsRu(text);
  const minWords = quick ? 400 : 900;
  checks.push(
    check(`ch${chapter}-length`, words >= minWords, `${words} слов (мин ${minWords})`),
  );

  return checks;
}

async function yandexAiPct(text: string, name: string): Promise<number | null> {
  if (quick || process.env.SKIP_YANDEX === "1") return null;
  try {
    const res = await fetch("https://yandex.ru/lab/neurodetector/api/analyze/text", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Accept: "application/json",
        Origin: "https://yandex.ru",
        Referer: "https://yandex.ru/lab/neurodetector",
      },
      body: JSON.stringify({ text: text.slice(0, 12_000) }),
    });
    const raw = await res.text();
    if (!res.ok) {
      console.log(`  Yandex ${name}: HTTP ${res.status}`);
      return null;
    }
    const data = JSON.parse(raw);
    const report = data.results || data;
    fs.writeFileSync(path.join(outDir, `yandex-${name}.json`), JSON.stringify(report, null, 2), "utf8");
    let aiChars = 0;
    let total = 0;
    for (const seg of report.segments || []) {
      total += seg.len || 0;
      if (seg.label === "AI" || seg.label === "LIKELY_AI") aiChars += seg.len || 0;
    }
    const pct = total ? (100 * aiChars) / total : null;
    console.log(`  Yandex ${name}: AI%=${pct != null ? pct.toFixed(1) : "?"} segs=${report.stats?.segments_count ?? "?"}`);
    return pct;
  } catch (error) {
    console.log(`  Yandex ${name}: fail`, error instanceof Error ? error.message : error);
    return null;
  }
}

function offlineChecks(): Check[] {
  console.log("\n=== Offline continuity gates ===");
  const chapters = buildLabyrinthChapters();
  const ch6 = chapters.find((c) => /глава\s*6/i.test(c.title))!;
  const ch7 = chapters.find((c) => /глава\s*7/i.test(c.title))!;
  const ch8 = chapters.find((c) => /глава\s*8/i.test(c.title))!;
  const checks: Check[] = [];

  checks.push(check("seed-ch6-end", /не сейчас/i.test(ch6.content) && /20/i.test(ch6.content), "финал 6: не сейчас + 20"));
  checks.push(check("seed-ch7-start", /двадцат/i.test(ch7.content.slice(0, 400)), "начало 7: двадцать %"));
  checks.push(check("seed-ch7-level2", /уровень\s*2/i.test(ch7.content), "seed 7 ведёт на Ур.2"));
  checks.push(check("seed-ch8-summary", /уровень\s*2/i.test(ch8.summary) && /не\s+2%/i.test(ch8.summary), "summary 8: стык Ур.2"));

  const manual = ("Ручная правка главы шесть. ".repeat(50)) + "Не сейчас. 20%.";
  checks.push(
    check(
      "keep-manual-ch6",
      shouldKeepUserChapterContent(manual, ch6.content) === true,
      "длинная ручная 6-я сохраняется",
    ),
  );
  checks.push(
    check(
      "replace-stub-ch6",
      shouldKeepUserChapterContent("Начну снова. Свет.", ch6.content) === false,
      "stub 6-й заменяется seed",
    ),
  );

  const merged = mergeLabyrinthCanonIntoStories([
    {
      id: "story-labyrinth",
      title: "Лабиринт. Путь домой",
      genre: "t",
      description: "",
      characters: [],
      chapters: [{ id: "x6", title: "Глава 6. Число 20", summary: "old", content: manual }],
      worldRules: [],
      worldBible: "no marker",
      bookPlan: "",
      updatedAt: 1,
    },
  ]);
  const kept = merged[0].chapters.find((c) => /глава\s*6/i.test(c.title))!.content;
  checks.push(check("merge-keeps-manual", kept.includes("Ручная правка"), "merge сохранил ручную 6-ю"));

  const beats7 = fallbackBeatsFromSynopsis({
    title: "Лабиринт",
    genre: "t",
    description: "",
    currentChapterTitle: "Глава 7. Отпечаток ладони",
    currentChapterSummary: ch7.summary,
    previousChapter: ch6.content.slice(-2000),
    worldBible: "",
    bookPlan: "",
    canonDossier: "",
    customPrompt: "",
    model: "x",
  });
  const j7 = beats7.map((b) => b.goal + b.hook).join(" ");
  checks.push(check("fallback-ch7", /сон|ладон|щель/i.test(j7) && !/мятно-медов/i.test(j7), "fallback 7 ≠ сюжет 6"));

  const beats8 = fallbackBeatsFromSynopsis({
    title: "Лабиринт",
    genre: "t",
    description: "",
    currentChapterTitle: "Глава 8. Уровень 2",
    currentChapterSummary: ch8.summary,
    previousChapter: ch7.content.slice(-2000),
    worldBible: "",
    bookPlan: "",
    canonDossier: "",
    customPrompt: "",
    model: "x",
  });
  const j8 = beats8.map((b) => b.goal + b.hook).join(" ");
  checks.push(check("fallback-ch8", /риск|карт|датчик|уровн/i.test(j8) && !/мятно-медов/i.test(j8), "fallback 8 ≠ сюжет 6"));

  const anchors = extractContinuityAnchors(ch6.content, ch6.title);
  checks.push(check("anchors-ch6", /20%|не сбрасывать/i.test(anchors), "якоря 6→7"));

  const story = {
    title: "Лабиринт",
    characters: [],
    chapters: [ch6, ch7, ch8],
  } as Story;
  const dossier = canonDossier(story, ch7, ch6);
  checks.push(check("dossier-tail", /Хвост предыдущей|Не сейчас|20/i.test(dossier), "dossier содержит стык"));

  const s6 = aiTellScore(ch6.content);
  const s7 = aiTellScore(ch7.content);
  checks.push(check("seed-ch6-aitell", s6.score <= 15, `seed6 AI-tell=${s6.score}`));
  checks.push(check("seed-ch7-aitell", s7.score <= 12, `seed7 AI-tell=${s7.score}`));

  return checks;
}

async function generateChapter(
  n: 7 | 8,
  previous: { title: string; content: string },
  summary: string,
  title: string,
) {
  const chapters = buildLabyrinthChapters();
  const current = chapters.find((c) => new RegExp(`глава\\s*${n}`, "i").test(c.title))!;
  const story = {
    title: "Лабиринт. Путь домой",
    characters: [],
    chapters: buildLabyrinthChapters(),
  } as Story;

  const prevChapter = { id: "prev", title: previous.title, summary: "", content: previous.content };
  const dossier = canonDossier(story, { ...current, summary, title }, prevChapter);

  const generate = async (params: {
    model: string;
    contents: string;
    systemInstruction: string;
    temperature: number;
    responseMimeType?: string;
    responseSchema?: unknown;
    maxOutputTokens?: number;
  }) => {
    const result = await llmGenerate({
      model: params.model,
      contents: params.contents,
      systemInstruction: params.systemInstruction,
      temperature: params.temperature,
      responseMimeType: params.responseMimeType,
      responseSchema: params.responseSchema,
      maxOutputTokens: params.maxOutputTokens,
    });
    console.log(`    [llm ${result.provider}/${result.model} fo=${result.failoverCount ?? 0}]`);
    return result.text;
  };

  console.log(`\n=== Live generate chapter ${n} (depth=${depth}, provider=${provider}) ===`);
  const t0 = Date.now();
  const result = await runWithProviderPreference(provider, () =>
    generateHumanizedChapter(
      {
        title: "Лабиринт. Путь домой",
        genre: "психологический триллер / survival",
        description: "Студент в Лабиринте. Телефон — якорь.",
        currentChapterTitle: title,
        currentChapterSummary: summary,
        previousChapter: `Глава: ${previous.title}\n\n${previous.content}`,
        worldBible: LABYRINTH_WORLD_BIBLE,
        bookPlan: LABYRINTH_BOOK_PLAN,
        canonDossier: dossier,
        customPrompt: n === 7
          ? "Продолжай строго после финала гл.6. Не решай кольца заново. Не сбрасывай заряд к 2%."
          : "Уже Уровень 2 после щели. Не сон, не ладонь, не кольца гл.6. ~20%.",
        authorSample: LABYRINTH_AUTHOR_SAMPLE,
        voiceSheet: LABYRINTH_VOICE_SHEET,
        humanizeDepth: depth,
        chapterCandidates: 1,
        model: process.env.NVIDIA_DEFAULT_MODEL || "deepseek-ai/deepseek-v4-flash",
      },
      generate,
    ),
  );
  const ms = Date.now() - t0;
  const score = aiTellScore(result.text);
  console.log(
    `  done ${ms}ms words=${countWordsRu(result.text)} AI-tell=${score.score} burst=${score.burstiness.toFixed(2)} gate=${result.humanizeReport.gatePassed} mode=${result.humanizeReport.mode}`,
  );
  fs.writeFileSync(path.join(outDir, `глава-${n}.txt`), result.text, "utf8");
  fs.writeFileSync(
    path.join(outDir, `глава-${n}.report.json`),
    JSON.stringify({ ms, score, humanizeReport: result.humanizeReport }, null, 2),
    "utf8",
  );
  return { text: result.text, score, humanizeReport: result.humanizeReport, ms };
}

async function main() {
  console.log("=== Verify chapters 6→7→8 continuity ===\n");
  const status = getLlmStatus();
  console.log("LLM:", {
    pref: status.providerPreference,
    nvidia: status.nvidiaConfigured,
    gemini: status.geminiKeys,
    groq: status.groqConfigured,
    depth,
    provider,
    skipLive,
  });

  const offline = offlineChecks();
  const liveChecks: Check[] = [];
  let ch7text = "";
  let ch8text = "";
  let y7: number | null = null;
  let y8: number | null = null;
  let gen7: Awaited<ReturnType<typeof generateChapter>> | null = null;
  let gen8: Awaited<ReturnType<typeof generateChapter>> | null = null;

  const chapters = buildLabyrinthChapters();
  const ch6 = chapters.find((c) => /глава\s*6/i.test(c.title))!;
  const ch7meta = chapters.find((c) => /глава\s*7/i.test(c.title))!;
  const ch8meta = chapters.find((c) => /глава\s*8/i.test(c.title))!;

  if (!skipLive) {
    if (!status.nvidiaConfigured && !status.geminiKeys && !status.groqConfigured) {
      console.error("Нет LLM ключей — live пропущен");
    } else {
      gen7 = await generateChapter(7, ch6, ch7meta.summary, ch7meta.title);
      ch7text = gen7.text;
      liveChecks.push(...continuityChecks(ch7text, 7));
      liveChecks.push(
        check("ch7-aitell-gate", gen7.score.score <= 20, `AI-tell=${gen7.score.score}`),
      );
      y7 = await yandexAiPct(ch7text, "ch7");

      gen8 = await generateChapter(
        8,
        { title: ch7meta.title, content: ch7text },
        ch8meta.summary,
        ch8meta.title,
      );
      ch8text = gen8.text;
      liveChecks.push(...continuityChecks(ch8text, 8));
      liveChecks.push(
        check("ch8-aitell-gate", gen8.score.score <= 22, `AI-tell=${gen8.score.score}`),
      );
      y8 = await yandexAiPct(ch8text, "ch8");
    }
  } else {
    console.log("\n(SKIP_LIVE=1 — seed ch7 как proxy)");
    liveChecks.push(...continuityChecks(ch7meta.content, 7));
  }

  const all = [...offline, ...liveChecks];
  const failed = all.filter((c) => !c.ok);
  const report = {
    createdAt: new Date().toISOString(),
    depth,
    provider,
    skipLive,
    offlinePass: offline.filter((c) => c.ok).length,
    offlineTotal: offline.length,
    livePass: liveChecks.filter((c) => c.ok).length,
    liveTotal: liveChecks.length,
    failed: failed.map((c) => c.id),
    yandex: { ch7: y7, ch8: y8 },
    gen7: gen7
      ? {
          words: countWordsRu(gen7.text),
          score: gen7.score.score,
          burst: gen7.score.burstiness,
          gate: gen7.humanizeReport.gatePassed,
          mode: gen7.humanizeReport.mode,
          ms: gen7.ms,
        }
      : null,
    gen8: gen8
      ? {
          words: countWordsRu(gen8.text),
          score: gen8.score.score,
          burst: gen8.score.burstiness,
          gate: gen8.humanizeReport.gatePassed,
          mode: gen8.humanizeReport.mode,
          ms: gen8.ms,
        }
      : null,
    checks: all,
  };

  fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2), "utf8");

  console.log("\n=== Summary ===");
  console.log(`Offline: ${report.offlinePass}/${report.offlineTotal}`);
  console.log(`Live:    ${report.livePass}/${report.liveTotal}`);
  if (failed.length) {
    console.log("FAILED:", failed.map((c) => c.id).join(", "));
  } else {
    console.log("ALL CHECKS PASSED");
  }
  console.log(`Report: ${path.join(outDir, "report.json")}`);

  // Offline must pass; live soft-fail only if critical continuity fails
  const criticalFail = failed.some((c) =>
    /fallback|keep-manual|merge-keeps|no-rerun-rings|no-false-2pct|dossier|anchors/.test(c.id),
  );
  if (offline.some((c) => !c.ok) || criticalFail) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
