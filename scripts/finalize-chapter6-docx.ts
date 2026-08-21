/**
 * Дочистка русского языка + полноценный Word для главы 6.
 * npx tsx scripts/finalize-chapter6-docx.ts
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
import { countWordsRu, russianLanguageIssues } from "../server/chapterGenerate";
import { llmGenerate } from "../server/llmProvider";

dotenv.config({ override: true });

const outDir = path.resolve(process.cwd(), "..", "Главы", "Глава-6-Число-20-очеловеченная");
const model = process.env.NVIDIA_DEFAULT_MODEL || "meta/llama-3.1-70b-instruct";

const LATIN_MAP: Record<string, string> = {
  auto: "авто",
  mode: "режим",
  off: "выкл",
  on: "вкл",
  level: "уровень",
  Level: "Уровень",
  phone: "телефон",
  wall: "стена",
  corridor: "коридор",
  ok: "ладно",
  OK: "ладно",
  nothing: "ничего",
  Nothing: "Ничего",
  only: "только",
  Only: "Только",
  began: "начал",
  knew: "знал",
  myself: "себя",
  muscular: "мышечный",
  ancora: "ещё",
  spir: "дух",
  anders: "иначе",
};

function stripLatinFallback(text: string): string {
  return text
    .replace(/\b([A-Za-z]{2,})\b/g, (m) => LATIN_MAP[m] || LATIN_MAP[m.toLowerCase()] || "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ \n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function cleanChunk(chunk: string): Promise<string> {
  const r = await llmGenerate({
    model,
    systemInstruction:
      "Ты литературный редактор русской прозы. Перепиши фрагмент ТОЛЬКО на русском. " +
      "Любые английские или латинские слова замени естественными русскими. " +
      "Сохрани все факты, числа, порядок действий и POV. Не сокращай сильнее чем на 15%. Без markdown и без комментариев.",
    contents: "Исправь язык (только русский, без латиницы), сохрани объём:\n\n" + chunk,
    temperature: 0.25,
    maxOutputTokens: 8192,
  });
  console.log("  cleaned via", r.provider, r.model);
  return r.text.replace(/^```(?:text|markdown)?\s*/i, "").replace(/```$/i, "").trim();
}

function p(text: string, bold = false) {
  return new Paragraph({
    spacing: { after: 200, line: 360 },
    children: [new TextRun({ text, font: "Times New Roman", size: 24, bold })],
  });
}

function body(text: string): Paragraph[] {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
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

async function main() {
  const candidates = ["глава-6-после-детектор.txt", "глава-6-финал.txt", "глава-6.txt"];
  let src = "";
  let srcName = "";
  for (const name of candidates) {
    const full = path.join(outDir, name);
    if (fs.existsSync(full)) {
      src = fs.readFileSync(full, "utf8");
      srcName = name;
      break;
    }
  }
  if (!src) throw new Error("Нет исходного текста главы 6");
  console.log("source", srcName, "words", countWordsRu(src), "lang", russianLanguageIssues(src));

  const paras = src.split(/\n\n+/);
  const chunks: string[] = [];
  let buf = "";
  for (const para of paras) {
    if ((buf + "\n\n" + para).length > 2800 && buf) {
      chunks.push(buf);
      buf = para;
    } else {
      buf = buf ? buf + "\n\n" + para : para;
    }
  }
  if (buf) chunks.push(buf);
  console.log("chunks", chunks.length);

  const cleanedParts: string[] = [];
  for (let i = 0; i < chunks.length; i += 1) {
    const issues = russianLanguageIssues(chunks[i]);
    if (!issues.length) {
      cleanedParts.push(chunks[i]);
      console.log("chunk", i + 1, "ok");
      continue;
    }
    console.log("chunk", i + 1, "cleaning…", issues[0]);
    let out = await cleanChunk(chunks[i]);
    if (russianLanguageIssues(out).length) {
      console.log("chunk", i + 1, "second pass");
      out = await cleanChunk(out);
    }
    cleanedParts.push(out);
  }

  let finalText = stripLatinFallback(cleanedParts.join("\n\n"));
  // if still short, we cannot expand without another gen - report honestly
  const words = countWordsRu(finalText);
  const lang = russianLanguageIssues(finalText);
  const score = aiTellScore(finalText);
  console.log("FINAL words", words, "lang", lang.length ? lang : "OK", "score", score.score);

  fs.writeFileSync(path.join(outDir, "глава-6-финал.txt"), finalText, "utf8");
  fs.writeFileSync(path.join(outDir, "глава-6-чистый-русский.txt"), finalText, "utf8");

  const res = await fetch("https://yandex.ru/lab/neurodetector/api/analyze/text", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://yandex.ru",
      Referer: "https://yandex.ru/lab/neurodetector",
    },
    body: JSON.stringify({ text: finalText }),
  });
  const data = await res.json();
  const report = data.results || data;
  fs.writeFileSync(path.join(outDir, "яндекс-финал-v2.json"), JSON.stringify(report, null, 2), "utf8");
  const st = report.stats || {};
  let aiChars = 0;
  let total = 0;
  for (const s of report.segments || []) {
    total += s.len || 0;
    if (s.label === "AI" || s.label === "LIKELY_AI") aiChars += s.len || 0;
  }
  const pct = total ? (100 * aiChars) / total : 0;
  console.log("Yandex AI%", pct.toFixed(1), "HUMAN", st.HUMAN_count, "AI", st.AI_count);

  const kpi =
    words >= 1500 && lang.length === 0 && score.score <= 12 && pct <= 40 ? "PASS" : "REVIEW";

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
          text:
            "Полная версия · русский · очеловечивание · " +
            new Date().toISOString().slice(0, 10) +
            " · " +
            words +
            " слов",
          font: "Times New Roman",
          size: 18,
          italics: true,
          color: "666666",
        }),
      ],
    }),
    ...body(finalText),
    new Paragraph({ children: [new PageBreak()] }),
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: "Отчёт тестов очеловечивания", font: "Times New Roman", size: 32, bold: true })],
    }),
    p(`Объём: ${words} слов (${finalText.length} знаков). Цель полноценной главы: ≥ 1500–1800 слов.`),
    p(`Язык: ${lang.length ? lang.join("; ") : "только русский (после очистки)"}`),
    p(`AI-tell: ${score.score}/100, burstiness: ${score.burstiness.toFixed(2)}, штампы: ${score.hits.length}`),
    p(
      `Яндекс: AI-символы ${pct.toFixed(1)}%; HUMAN=${st.HUMAN_count || 0}, AI=${st.AI_count || 0}, LIKELY_AI=${st.LIKELY_AI_count || 0}`,
    ),
    p(
      "Пайплайн: 6 сцен (цель 320–480 слов каждая), NVIDIA, touchup, detector rewrite, очистка латиницы.",
    ),
    p(`KPI: ${kpi}`),
    p("Замечание: Llama на NVIDIA иногда подмешивает английский — включена автоочистка. Для стабильного русского предпочтительны модели с сильным RU (Gemini/Qwen) при доступной квоте."),
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

  const docBuffer = await Packer.toBuffer(doc);
  const primary = path.join(outDir, "Лабиринт-Глава-6-Число-20-полная.docx");
  const fallback = path.join(outDir, "Лабиринт-Глава-6-v2-полная.docx");
  try {
    fs.writeFileSync(primary, docBuffer);
    console.log("DOCX", primary);
  } catch {
    fs.writeFileSync(fallback, docBuffer);
    console.log("DOCX (alt name)", fallback);
  }

  fs.writeFileSync(
    path.join(outDir, "отчёт-тестов-v2.txt"),
    [
      `words=${words}`,
      `lang=${lang.length ? lang.join("|") : "OK"}`,
      `ai-tell=${score.score}`,
      `burst=${score.burstiness.toFixed(2)}`,
      `yandex_ai_pct=${pct.toFixed(1)}`,
      `kpi=${kpi}`,
    ].join("\n"),
    "utf8",
  );
  console.log("KPI", kpi);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
