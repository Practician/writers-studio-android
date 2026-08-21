/**
 * Генерация главы 6 с очеловечиванием + тесты + Word.
 * npx tsx scripts/generate-chapter6-docx.ts
 */
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
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
import {
  countWordsRu,
  generateHumanizedChapter,
  rewriteDetectorAiSegments,
  russianLanguageIssues,
} from "../server/chapterGenerate";
import { llmGenerate } from "../server/llmProvider";

dotenv.config({ override: true });

const root = path.resolve(process.cwd(), "..");
const outDir = path.join(root, "Главы", "Глава-6-Число-20-очеловеченная");
const samplePath = path.join(root, "лабиринт_.txt");
const model = process.env.NVIDIA_DEFAULT_MODEL || "meta/llama-3.1-70b-instruct";

const generate = async (params: any) => {
  const r = await llmGenerate({ ...params, model: params.model || model });
  console.log(`  [llm ${r.provider}/${r.model}]`);
  return r.text;
};

async function yandexCheck(name: string, text: string) {
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
  const labels: Record<string, number> = {};
  for (const s of report.segments || []) {
    total += s.len || 0;
    labels[s.label] = (labels[s.label] || 0) + 1;
    if (s.label === "AI" || s.label === "LIKELY_AI") aiChars += s.len || 0;
  }
  const pct = total ? (100 * aiChars) / total : 0;
  console.log(
    `  Yandex ${name}: AI/LAI=${(st.AI_count || 0) + (st.LIKELY_AI_count || 0)} HUM=${(st.HUMAN_count || 0) + (st.LIKELY_HUMAN_count || 0)} AI%=${pct.toFixed(1)} labels=${JSON.stringify(labels)}`,
  );
  return { report, pct, labels, stats: st };
}

function p(text: string, opts: { bold?: boolean; size?: number; after?: number } = {}) {
  return new Paragraph({
    spacing: { after: opts.after ?? 200, line: 360 },
    children: [
      new TextRun({
        text,
        font: "Times New Roman",
        size: opts.size ?? 24, // 12pt
        bold: opts.bold,
      }),
    ],
  });
}

function h1(text: string) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 240, after: 240 },
    children: [new TextRun({ text, font: "Times New Roman", size: 32, bold: true })],
  });
}

function h2(text: string) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 280, after: 160 },
    children: [new TextRun({ text, font: "Times New Roman", size: 28, bold: true })],
  });
}

function bodyParagraphs(text: string): Paragraph[] {
  return text
    .replace(/\r\n/g, "\n")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const isDialogue = /^[—–\-]\s/.test(line);
      return new Paragraph({
        spacing: { after: 200, line: 360 },
        indent: isDialogue ? { firstLine: 0 } : { firstLine: 708 },
        children: [new TextRun({ text: line, font: "Times New Roman", size: 24 })],
      });
    });
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  console.log("=== Глава 6: Число 20 (gen + humanize + tests + docx) ===\n");
  console.log("model:", model);
  console.log("out:", outDir);

  const sample = fs.existsSync(samplePath) ? fs.readFileSync(samplePath, "utf8") : "";
  // Контекст «после главы 5»: ходил кругами, жажда, выбрал неисследованный коридор / пандус
  const previousChapter = `
Глава 5. Первый круг

Я вернулся к своей метке — ключу на полу. Значит, ходил кругами. Жажда уже не шутка, голод тоже. Телефон на последних процентах. Остался один коридор, куда я ещё не сворачивал. Пошёл туда. Пол будто начал уходить вниз — пандус. Вдали — слабое свечение. Я ускорился, хотя ноги уже не слушались.
`.trim();

  const worldBible = `
Уровень 1: темнота, мягкие дымчатые стены, чёрный пол. Телефон: «Уровень 1», тепловизор, заряд критичен.
Метки ключом могут светиться. Правило левой руки — земной алгоритм, не всегда работает.
В тупиках бывают ресурсы: число в воздухе, питательная масса (мята/мёд), беспроводная зарядка рядом с числом.
Ресурс — это выбор. Лабиринт запоминает.
`.trim();

  console.log("\n1) Генерация с очеловечиванием (Баланс, best-of-2)…");
  const t0 = Date.now();
  const generated = await generateHumanizedChapter(
    {
      title: "Лабиринт. Путь домой",
      genre: "психологический триллер / survival / попаданство",
      description: "Студент в Лабиринте. Телефон — единственный якорь. Уровень 1.",
      currentChapterTitle: "Глава 6. Число 20",
      currentChapterSummary:
        "Герой спускается по пандусу к тусклому свечению. В тупике — зеленоватое число 20 в воздухе и блинообразная дымчатая ёмкость с густой мятно-медовой массой. Он пробует, ест, голод и жажда уходят. Кладёт телефон на структуру — беспроводная зарядка, число тает до 0, заряд телефона ~20%. Увидит на тупиковой стене смутный отпечаток ладони. (Саму активацию ладони можно наметить, но кульминация перехода — на грани со следующей главой.)",
      previousChapter,
      worldBible,
      bookPlan: "Глава 6 — Число 20: ресурс, еда, заряд. Глава 7 — отпечаток ладони и переход на Уровень 2.",
      canonDossier:
        "Герой один. Одежда: футболка, джинсы, кроссовки. Связка ключей, смартфон с тепловизором. Уровень 1. Заряд перед сценой очень низкий (порядка 1%). Нет других людей. Нет магии-заклинаний. Тон: сухой, инженерный, от 1 лица, с бытовой иронией как в главе 1.",
      customPrompt:
        "Полноценная глава 2000–2800 слов (не короче 1800). Только русский язык, без английских слов и латиницы. " +
        "Сохрани конкретику: спуск, свечение, число 20, мятно-медовая масса, еда, заряд телефона примерно до 20%, отпечаток ладони. " +
        "Разверни: путь по пандусу, сомнения, ощущения тела, решение есть, процесс еды, зарядка, мысли, подход к отпечатку. " +
        "Не разжёвывай правила лекции. Без штампов «волна ужаса / время остановилось». Без слов level, phone, wall, ok, corridor.",
      authorSample: sample.slice(0, 8000),
      voicePreset: "conversational",
      humanizeDepth: "balanced",
      // Один полный длинный прогон (6–7 сцен × 350–480 слов) надёжнее, чем 2 коротких
      chapterCandidates: 1,
      model,
    },
    generate,
  );
  const elapsedSec = Math.round((Date.now() - t0) / 1000);

  const chapterText = generated.text.trim();
  const wordCount = countWordsRu(chapterText);
  const langIssues = russianLanguageIssues(chapterText);
  const score = aiTellScore(chapterText);
  console.log(
    `  candidates: ${generated.humanizeReport.candidateScores?.join(", ")} → #${(generated.humanizeReport.chosenCandidate ?? 0) + 1}`,
  );
  console.log(
    `  words=${wordCount}, langIssues=${langIssues.length ? langIssues.join("; ") : "none"}`,
  );
  console.log(
    `  AI-tell: ${generated.humanizeReport.scoreBefore} → ${score.score}, burst=${score.burstiness.toFixed(2)}, gate=${generated.humanizeReport.gatePassed}, scenes=${generated.humanizeReport.scenesGenerated}, ${elapsedSec}s`,
  );
  if (wordCount < 1500) {
    console.warn(`  WARNING: chapter still short (${wordCount} words)`);
  }

  fs.writeFileSync(path.join(outDir, "глава-6.txt"), chapterText, "utf8");
  fs.writeFileSync(
    path.join(outDir, "глава-6-humanize.report.json"),
    JSON.stringify({ score, report: generated.humanizeReport, elapsedSec, model }, null, 2),
    "utf8",
  );

  console.log("\n2) Яндекс Нейродетектор…");
  let yandex = await yandexCheck("gen", chapterText);
  let finalText = chapterText;
  let detectorRewrite: any = null;

  const aiSegs = (yandex.report.segments || []).filter(
    (s: any) => s.label === "AI" || s.label === "LIKELY_AI",
  ).length;

  if (aiSegs > 0) {
    console.log(`\n3) Detector rewrite (AI-сегментов: ${aiSegs})…`);
    const segments = (yandex.report.segments || []).map((s: any) => ({
      text: s.text,
      label: s.label,
    }));
    detectorRewrite = await rewriteDetectorAiSegments(segments, generate, {
      model,
      personaBlock:
        "Рассказчик — студент-инженер от первого лица, сухо, конкретно, с лёгкой иронией как в главе 1 «Лабиринт».",
      humanizeDepth: "balanced",
    });
    finalText = detectorRewrite.text;
    const after = aiTellScore(finalText);
    console.log(
      `  rewritten=${detectorRewrite.rewrittenCount} AI-tell ${detectorRewrite.humanizeReport.scoreBefore}→${after.score} gate=${detectorRewrite.humanizeReport.gatePassed}`,
    );
    fs.writeFileSync(path.join(outDir, "глава-6-после-детектор.txt"), finalText, "utf8");
    fs.writeFileSync(
      path.join(outDir, "глава-6-детектор.report.json"),
      JSON.stringify({ after, report: detectorRewrite.humanizeReport }, null, 2),
      "utf8",
    );
    console.log("\n4) Яндекс после detector rewrite…");
    yandex = await yandexCheck("после-детектор", finalText);
  } else {
    console.log("\n3) AI-сегментов нет — detector rewrite не нужен.");
  }

  const finalScore = aiTellScore(finalText);
  const finalWords = countWordsRu(finalText);
  const finalLang = russianLanguageIssues(finalText);
  const kpiPass =
    finalScore.score <= 12
    && finalScore.hits.length === 0
    && yandex.pct <= 40
    && finalWords >= 1500
    && finalLang.length === 0;

  const testLines = [
    `Дата: ${new Date().toISOString()}`,
    `Модель: ${model}`,
    `Режим: balanced, chapterCandidates=1, сцены 5–7 × 320–480 слов`,
    `Время генерации: ${elapsedSec} с`,
    ``,
    `Объём: ${finalWords} слов / ${finalText.length} знаков (цель ≥ 1500–1800 слов)`,
    `Язык: ${finalLang.length ? "ПРОБЛЕМЫ: " + finalLang.join("; ") : "только русский (OK)"}`,
    ``,
    `Локальный AI-tell (после touchup): ${generated.humanizeReport.scoreBefore} → ${score.score}`,
    `Burstiness: ${finalScore.burstiness.toFixed(2)} (цель ≥ 0.45)`,
    `Штампы (hits): ${finalScore.hits.length}`,
    `Gate: ${generated.humanizeReport.gatePassed}`,
    `Кандидаты AI-tell: [${(generated.humanizeReport.candidateScores || []).join(", ")}] → #${(generated.humanizeReport.chosenCandidate ?? 0) + 1}`,
    `Сцены: ${generated.humanizeReport.scenesGenerated}`,
    `Правка абзацев: ${generated.humanizeReport.refinedBlocks}`,
    ``,
    `Яндекс (финал): AI-символы ${yandex.pct.toFixed(1)}%`,
    `  AI_count=${yandex.stats.AI_count ?? 0}, LIKELY_AI=${yandex.stats.LIKELY_AI_count ?? 0}`,
    `  HUMAN=${yandex.stats.HUMAN_count ?? 0}, LIKELY_HUMAN=${yandex.stats.LIKELY_HUMAN_count ?? 0}`,
    `  labels: ${JSON.stringify(yandex.labels)}`,
    detectorRewrite
      ? `Detector rewrite: сегментов ${detectorRewrite.rewrittenCount}`
      : `Detector rewrite: не применялся`,
    ``,
    `KPI (слова≥1500, RU only, AI-tell≤12, hits=0, Yandex AI%≤40): ${kpiPass ? "PASS" : "REVIEW"}`,
  ];

  fs.writeFileSync(path.join(outDir, "отчёт-тестов.txt"), testLines.join("\n"), "utf8");
  fs.writeFileSync(path.join(outDir, "глава-6-финал.txt"), finalText, "utf8");

  console.log("\n5) Word .docx…");
  const children: Paragraph[] = [
    h1("Лабиринт. Путь домой"),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
      children: [
        new TextRun({
          text: "Глава 6. Число 20",
          font: "Times New Roman",
          size: 28,
          bold: true,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
      border: {
        bottom: { style: BorderStyle.SINGLE, size: 6, color: "666666", space: 1 },
      },
      children: [
        new TextRun({
          text: "Черновик с очеловечиванием (Writer's Studio) · тест " + new Date().toISOString().slice(0, 10),
          font: "Times New Roman",
          size: 18,
          italics: true,
          color: "666666",
        }),
      ],
    }),
    ...bodyParagraphs(finalText),
    new Paragraph({ children: [new PageBreak()] }),
    h1("Отчёт тестов очеловечивания"),
    h2("Параметры прогона"),
    p(`Модель: ${model}`),
    p(`Режим: balanced · 5–7 сцен × 320–480 слов · touchup`),
    p(`Время: ${elapsedSec} с`),
    p(`Объём: ${finalWords} слов (${finalText.length} знаков)`),
    p(`Язык: ${finalLang.length ? finalLang.join("; ") : "только русский"}`),
    p(`Образец голоса: лабиринт_.txt (глава 1 автора), ${sample.length} знаков`),
    h2("Локальные метрики (AI-tell)"),
    p(
      `Score: ${generated.humanizeReport.scoreBefore} → ${finalScore.score} (0 — человечно, 100 — генеративно)`,
    ),
    p(`Burstiness: ${finalScore.burstiness.toFixed(2)} (живая проза ориентир ≥ 0.45–0.55)`),
    p(`Штампы (hits): ${finalScore.hits.length}${finalScore.hits.length ? " — " + [...new Set(finalScore.hits.map((h) => h.label))].join("; ") : ""}`),
    p(`Gate: ${generated.humanizeReport.gatePassed ? "пройден" : "не пройден"}`),
    p(
      `Кандидаты главы (AI-tell): ${(generated.humanizeReport.candidateScores || []).join(", ")} → выбран #${(generated.humanizeReport.chosenCandidate ?? 0) + 1}`,
    ),
    p(`Сцен: ${generated.humanizeReport.scenesGenerated} · доводка абзацев: ${generated.humanizeReport.refinedBlocks}`),
    h2("Яндекс Нейродетектор"),
    p(`Доля AI-символов (AI + LIKELY_AI): ${yandex.pct.toFixed(1)}%`),
    p(
      `Сегменты: AI=${yandex.stats.AI_count ?? 0}, LIKELY_AI=${yandex.stats.LIKELY_AI_count ?? 0}, HUMAN=${yandex.stats.HUMAN_count ?? 0}, LIKELY_HUMAN=${yandex.stats.LIKELY_HUMAN_count ?? 0}`,
    ),
    p(`Разбивка меток: ${JSON.stringify(yandex.labels)}`),
    p(
      detectorRewrite
        ? `Точечная правка AI-сегментов: переписано ${detectorRewrite.rewrittenCount}, затем повторная проверка.`
        : "Точечная правка AI-сегментов не применялась (AI-сегментов не было или проверка не нашла).",
    ),
    h2("KPI"),
    p(
      kpiPass
        ? "PASS: объём ≥ 1500 слов, только русский, AI-tell ≤ 12, штампы 0, Яндекс AI% ≤ 40."
        : "REVIEW: один или несколько порогов не достигнуты — см. цифры выше. Текст главы всё равно сохранён для ручной доводки.",
    ),
    h2("Синопсис (задание генерации)"),
    p(
      "Герой спускается к свечению, находит число 20 и мятно-медовую массу, ест, заряжает телефон примерно до 20%, замечает отпечаток ладони.",
    ),
    h2("Файлы рядом с этим документом"),
    p("глава-6-финал.txt — чистый текст"),
    p("глава-6-humanize.report.json — отчёт пайплайна"),
    p("яндекс-*.json — отчёты нейродетектора"),
    p("отчёт-тестов.txt — краткий текстовый лог"),
  ];

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: "Times New Roman", size: 24 },
        },
      },
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
        {
          id: "Heading2",
          name: "Heading 2",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { size: 28, bold: true, font: "Times New Roman" },
          paragraph: { spacing: { before: 200, after: 160 }, outlineLevel: 1 },
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 }, // A4
            margin: { top: 1134, right: 850, bottom: 1134, left: 1134 },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: "Лабиринт. Путь домой — Глава 6",
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

  const buffer = await Packer.toBuffer(doc);
  const docxPath = path.join(outDir, "Лабиринт-Глава-6-Число-20-очеловеченная.docx");
  fs.writeFileSync(docxPath, buffer);
  console.log("\nDOCX:", docxPath);
  console.log("KPI:", kpiPass ? "PASS" : "REVIEW");
  console.log("\n=== SUMMARY ===");
  console.log(testLines.join("\n"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
