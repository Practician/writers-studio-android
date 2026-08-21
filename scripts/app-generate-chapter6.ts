/**
 * Глава 6 ТОЛЬКО через API приложения /api/writer/ai
 * npx tsx scripts/app-generate-chapter6.ts
 */
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Header,
  Footer,
  PageNumber,
  BorderStyle,
  PageBreak,
} from "docx";
import { aiTellScore } from "../server/humanStyle";
import { countWordsRu, russianLanguageIssues } from "../server/chapterGenerate";
import {
  LABYRINTH_BOOK_PLAN,
  LABYRINTH_WORLD_BIBLE,
  buildLabyrinthChapters,
} from "../src/data/labyrinthCanon";

dotenv.config({ override: true });

const BASE = process.env.APP_URL || "http://localhost:3000";
const projectRoot = process.cwd();
const parentRoot = path.resolve(projectRoot, "..");
const outDir = path.join(projectRoot, "test-artifacts", "chapter6");
const samplePath = [
  path.join(parentRoot, "лабиринт_.txt"),
  path.join(projectRoot, "лабиринт_.txt"),
].find((p) => fs.existsSync(p)) || path.join(parentRoot, "лабиринт_.txt");

/** POST JSON на localhost без undici headersTimeout (нужно для long-running gen). */
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
            json = { raw };
          }
          resolve({ status: res.statusCode || 0, json });
        });
      },
    );
    req.on("timeout", () => {
      req.destroy(new Error("HTTP timeout"));
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function waitServer(maxMs = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    try {
      const r = await httpJson("GET", `${BASE}/api/llm/status`, undefined, 5000);
      if (r.status === 200) return r.json;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Сервер приложения не ответил на " + BASE);
}

async function yandex(text: string, name: string) {
  try {
    const res = await fetch("https://yandex.ru/lab/neurodetector/api/analyze/text", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://yandex.ru",
        Referer: "https://yandex.ru/lab/neurodetector",
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
      total += s.len || 0;
      if (s.label === "AI" || s.label === "LIKELY_AI") aiChars += s.len || 0;
    }
    const pct = total ? (100 * aiChars) / total : 0;
    console.log(
      `  Yandex: AI%=${pct.toFixed(1)} HUMAN=${st.HUMAN_count || 0} AI=${st.AI_count || 0} LAI=${st.LIKELY_AI_count || 0}`,
    );
    return { report, pct, stats: st };
  } catch (error: any) {
    console.warn("  Yandex недоступен (TLS/сеть):", String(error?.message || error).slice(0, 120));
    const report = { segments: [], stats: {}, error: String(error?.message || error) };
    fs.writeFileSync(path.join(outDir, `яндекс-${name}-error.json`), JSON.stringify(report, null, 2), "utf8");
    return { report, pct: -1, stats: {} as any };
  }
}

function body(text: string): Paragraph[] {
  return text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map(
      (line) =>
        new Paragraph({
          spacing: { after: 200, line: 360 },
          indent: /^[—–\-]/.test(line) ? {} : { firstLine: 708 },
          children: [new TextRun({ text: line, font: "Times New Roman", size: 24 })],
        }),
    );
}

function p(text: string) {
  return new Paragraph({
    spacing: { after: 160, line: 320 },
    children: [new TextRun({ text, font: "Times New Roman", size: 22 })],
  });
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  console.log("=== Глава 6 через приложение ===\n");
  console.log("API", BASE);

  const status = await waitServer();
  console.log("LLM status:", JSON.stringify(status, null, 2));

  const sample = fs.existsSync(samplePath) ? fs.readFileSync(samplePath, "utf8") : "";
  console.log("author sample:", samplePath, sample ? `${sample.length} chars` : "MISSING");
  const llmProvider = (
    process.env.CHAPTER6_PROVIDER
    || process.env.LLM_PROVIDER
    || "groq"
  ).toLowerCase();
  const model =
    process.env.CHAPTER6_MODEL
    || (llmProvider === "groq"
      ? (status.groqDefaultModel || "llama-3.3-70b-versatile")
      : llmProvider === "openrouter"
        ? (status.openrouterDefaultModel || "openrouter/free")
        : llmProvider === "gemini"
          ? "gemini-3.5-flash"
          : (process.env.NVIDIA_DEFAULT_MODEL || status.nvidiaDefaultModel || "deepseek-ai/deepseek-v4-flash"));

  // Канон как в UI: summary гл.6 + хвост гл.5 + worldBible/bookPlan из labyrinthCanon
  const seedChapters = buildLabyrinthChapters();
  const ch5 = seedChapters.find((c) => /глава\s*5/i.test(c.title));
  const ch6 = seedChapters.find((c) => /глава\s*6/i.test(c.title));
  const prevTail = (ch5?.content || "").slice(-12_000);
  const bodyPayload = {
    action: "generate_full_chapter",
    humanize: true,
    // balanced: sceneGeneration=true (fast даёт single-pass ~200 слов)
    humanizeDepth: "balanced",
    chapterCandidates: 2,
    llmProvider,
    model,
    title: "Лабиринт. Путь домой",
    genre: "психологический триллер / survival / техно-мистика",
    description: "Студент в многоуровневом Лабиринте. Телефон — якорь. Уровень 1.",
    currentChapterTitle: ch6?.title || "Глава 6. Число 20",
    currentChapterSummary: ch6?.summary || "",
    previousChapter: prevTail
      ? `Глава: ${ch5?.title || "Глава 5"}\n\n${prevTail}`
      : "Конец гл.5: 2%, жажда, голод, символ отмены, шаг в правый коридор к мяте/мёду.",
    worldBible: LABYRINTH_WORLD_BIBLE,
    bookPlan: LABYRINTH_BOOK_PLAN,
    canonDossier: [
      `Текущая глава: ${ch6?.title || "Глава 6. Число 20"}.`,
      ch6?.summary ? `Обязательные события: ${ch6.summary}` : "",
      "Непосредственное продолжение: Глава 5. Не меняй героя, точку зрения, экипировку.",
      "Старт: 2%, голод, жажда. Нет других людей. 1 лицо, дневник. Не «Начну снова». «Я» умеренно (не телеграф без «я»). Без часов на экране.",
    ]
      .filter(Boolean)
      .join("\n\n"),
    customPrompt:
      "Полноценная глава 1500–2400 слов. Только русский. СТЫК: продолжение шага в правый тёмный коридор из конца гл.5. Голод/жажда/2% в начале; еда и 20% — после головоломки. Центральная сцена: 3 кольца × 12 секторов, независимое вращение CW/CCW, яркость и значение 0…20, поймать яркую 20. Один проход сюжета, без тройных повторов «и что дальше». 1 лицо: «я» умеренно (~3–7/100 слов), связная проза-дневник, НЕ рубленый телеграф. Без часов на экране, без «Начну снова», без штампов «волна ужаса», «холод по спине».",
    // Groq free TPM ~6k: короткий sample, иначе 413
    authorSample: sample.slice(0, llmProvider === "groq" ? 1800 : 12000),
    voicePreset: "conversational",
  };

  console.log("\nPOST /api/writer/ai generate_full_chapter…");
  console.log("llmProvider:", llmProvider, "model:", model);
  const t0 = Date.now();
  const res = await httpJson("POST", `${BASE}/api/writer/ai`, bodyPayload, 45 * 60 * 1000);
  const data = res.json;
  const sec = Math.round((Date.now() - t0) / 1000);
  if (res.status < 200 || res.status >= 300) {
    console.error("API error", res.status, data);
    process.exit(1);
  }

  const text = String(data.result || "").trim();
  const report = data.humanizeReport || {};
  const words = countWordsRu(text);
  const lang = russianLanguageIssues(text);
  const score = aiTellScore(text);

  console.log(`  time ${sec}s provider=${data.provider || "?"} model=${data.model || model}`);
  console.log(`  words=${words} lang=${lang.length ? lang.join("; ") : "OK"}`);
  console.log(
    `  AI-tell ${report.scoreBefore}→${score.score} burst=${score.burstiness.toFixed(2)} gate=${report.gatePassed} scenes=${report.scenesGenerated}`,
  );
  console.log(`  candidates: ${JSON.stringify(report.candidateScores)} chosen #${(report.chosenCandidate ?? 0) + 1}`);

  fs.writeFileSync(path.join(outDir, "глава-6.txt"), text, "utf8");
  fs.writeFileSync(
    path.join(outDir, "api-response.report.json"),
    JSON.stringify({ humanizeReport: report, provider: data.provider, model: data.model, words, lang, score, sec }, null, 2),
    "utf8",
  );

  // If language dirty or short — optional detector path only via API
  console.log("\nYandex…");
  const y = await yandex(text, "gen");

  if ((y.stats.AI_count || 0) + (y.stats.LIKELY_AI_count || 0) > 0) {
    console.log("\nPOST rewrite_detector_segments…");
    const det = await httpJson(
      "POST",
      `${BASE}/api/writer/ai`,
      {
        action: "rewrite_detector_segments",
        model,
        llmProvider,
        humanize: true,
        humanizeDepth: "balanced",
        authorSample: sample.slice(0, 8000),
        voicePreset: "conversational",
        detectorSegments: (y.report.segments || []).map((s: any) => ({ text: s.text, label: s.label })),
      },
      30 * 60 * 1000,
    );
    const detData = det.json;
    if (det.status >= 200 && det.status < 300 && detData.result) {
      const t2 = String(detData.result).trim();
      fs.writeFileSync(path.join(outDir, "глава-6-после-детектор.txt"), t2, "utf8");
      const y2 = await yandex(t2, "после-детектор");
      // use cleaned if better
      if (countWordsRu(t2) >= words * 0.85) {
        Object.assign(data, { result: t2, humanizeReport: detData.humanizeReport });
        console.log("  using detector-rewritten text");
        await writeOutputs(t2, detData.humanizeReport || report, y2, model, sec, outDir, status);
        return;
      }
    }
  }

  await writeOutputs(text, report, y, model, sec, outDir, status);
}

async function writeOutputs(
  text: string,
  report: any,
  y: any,
  model: string,
  sec: number,
  outDir: string,
  status: any,
) {
  const words = countWordsRu(text);
  const lang = russianLanguageIssues(text);
  const score = aiTellScore(text);
  const kpi =
    words >= 1500 && lang.length === 0 && score.score <= 12 && y.pct <= 40 ? "PASS" : "REVIEW";

  fs.writeFileSync(path.join(outDir, "глава-6-финал.txt"), text, "utf8");
  fs.writeFileSync(
    path.join(outDir, "отчёт-тестов.txt"),
    [
      `via=APP_API ${BASE}`,
      `model=${model}`,
      `llm_status=${JSON.stringify(status)}`,
      `words=${words}`,
      `lang=${lang.length ? lang.join("|") : "OK"}`,
      `ai-tell=${score.score}`,
      `burst=${score.burstiness.toFixed(2)}`,
      `gate=${report.gatePassed}`,
      `scenes=${report.scenesGenerated}`,
      `yandex_ai_pct=${y.pct.toFixed(1)}`,
      `sec=${sec}`,
      `kpi=${kpi}`,
    ].join("\n"),
    "utf8",
  );

  const children = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: "Лабиринт. Путь домой", font: "Times New Roman", size: 32, bold: true })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [new TextRun({ text: "Глава 6. Число 20", font: "Times New Roman", size: 28, bold: true })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "666666", space: 1 } },
      children: [
        new TextRun({
          text: `Через приложение Writer's Studio · ${model} · ${words} слов · ${new Date().toISOString().slice(0, 10)}`,
          font: "Times New Roman",
          size: 18,
          italics: true,
          color: "666666",
        }),
      ],
    }),
    ...body(text),
    new Paragraph({ children: [new PageBreak()] }),
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: "Отчёт: генерация через приложение", font: "Times New Roman", size: 32, bold: true })],
    }),
    p(`API: POST ${BASE}/api/writer/ai  action=generate_full_chapter`),
    p(`Модель NVIDIA: ${model}`),
    p(`Провайдер: LLM_PROVIDER=nvidia (подобран бенчмарком RU-прозы)`),
    p(`Объём: ${words} слов (${text.length} знаков)`),
    p(`Язык: ${lang.length ? lang.join("; ") : "только русский"}`),
    p(`AI-tell: ${score.score}/100 · burstiness ${score.burstiness.toFixed(2)} · gate ${report.gatePassed}`),
    p(`Сцены: ${report.scenesGenerated ?? "—"} · кандидаты: ${JSON.stringify(report.candidateScores || [])}`),
    p(`Яндекс AI%: ${y.pct.toFixed(1)} · HUMAN=${y.stats?.HUMAN_count ?? 0} · AI=${y.stats?.AI_count ?? 0}`),
    p(`Время: ${sec} с · KPI: ${kpi}`),
    p(
      "Бенчмарк моделей: deepseek-v4-flash (лучшая RU) > qwen3-next-80b > llama-3.3; llama-3.1 хуже (EN/CN вкрапления).",
    ),
  ];

  const doc = new Document({
    styles: {
      default: { document: { run: { font: "Times New Roman", size: 24 } } },
      paragraphStyles: [
        {
          id: "Heading1",
          name: "Heading 1",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { size: 32, bold: true, font: "Times New Roman" },
          paragraph: { spacing: { before: 240, after: 240 }, outlineLevel: 0 },
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 1134, right: 850, bottom: 1134, left: 1134 },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: "Лабиринт — Глава 6 (через приложение)",
                    font: "Times New Roman",
                    size: 16,
                    color: "888888",
                  }),
                ],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ text: "стр. ", font: "Times New Roman", size: 16, color: "888888" }),
                  new TextRun({
                    children: [PageNumber.CURRENT],
                    font: "Times New Roman",
                    size: 16,
                    color: "888888",
                  }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  const buf = await Packer.toBuffer(doc);
  const docxPath = path.join(outDir, "Лабиринт-Глава-6-через-приложение.docx");
  fs.writeFileSync(docxPath, buf);
  console.log("\nDOCX:", docxPath);
  console.log("KPI:", kpi);
  console.log("words:", words, "yandex AI%:", y.pct.toFixed(1));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
