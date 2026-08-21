import { readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";

const baseUrl = process.env.WRITER_STUDIO_URL || "http://127.0.0.1:3000";
const sourcePath = process.env.CHAPTER5_SOURCE;
const samplePath = process.env.AUTHOR_SAMPLE;
const outputDir = process.env.CHAPTER5_OUTPUT;
const strength = process.env.CHAPTER5_STRENGTH || "balanced";

if (!sourcePath || !samplePath || !outputDir) {
  throw new Error("CHAPTER5_SOURCE, AUTHOR_SAMPLE and CHAPTER5_OUTPUT are required");
}

const [sourceText, authorSample] = await Promise.all([
  readFile(sourcePath, "utf8"),
  readFile(samplePath, "utf8"),
]);

const requestBody = JSON.stringify({
    action: "rewrite",
    sourceText,
    authorSample,
    styleDescription: "Русская психологическая проза от первого лица. Сохранить нервный, прямой голос автора, обрывистые внутренние реакции и бытовую конкретику. Не добавлять событий и не украшать текст ради красоты.",
    protectedTerms: ["Лабиринт", "Уровень 1", "Правило левой руки", "смартфон"],
    strength,
    instructions: "Сделать текст естественнее и ближе к исходному голосу автора. Убрать шаблонную гладкость и повторы только там, где это не меняет смысл, факты, числа и последовательность действий.",
    context: {
      title: "Лабиринт",
      genre: "психологическая фантастика, триллер",
      description: "Герой оказывается в изменчивом Лабиринте и пытается выжить, опираясь на наблюдения, правила и ограниченные ресурсы.",
      chapterTitle: "Глава 5",
      chapterSummary: "Герой исследует первый уровень по правилу левой руки, обнаруживает изменение геометрии и решает войти в правое ответвление.",
      worldBible: "",
      bookPlan: "",
      previousChapter: "",
      nextChapterSummary: "",
    },
    model: process.env.CHAPTER5_MODEL || "gemini-2.5-flash",
});

const startedAt = Date.now();
const { status, raw } = await new Promise((resolve, reject) => {
  const url = new URL("/api/writer/author", baseUrl);
  const request = http.request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(requestBody),
    },
  }, (response) => {
    const chunks = [];
    response.on("data", (chunk) => chunks.push(chunk));
    response.on("end", () => resolve({
      status: response.statusCode || 0,
      raw: Buffer.concat(chunks).toString("utf8"),
    }));
  });
  request.on("error", reject);
  request.end(requestBody);
});

if (status < 200 || status >= 300) {
  throw new Error(`Author API ${status}: ${raw}`);
}

const payload = JSON.parse(raw);
await Promise.all([
  writeFile(path.join(outputDir, "chapter5_result.txt"), payload.result, "utf8"),
  writeFile(path.join(outputDir, "chapter5_response.json"), JSON.stringify(payload, null, 2), "utf8"),
]);

console.log(JSON.stringify({
  model: payload.model,
  sourceCharacters: sourceText.length,
  resultCharacters: payload.result.length,
  auditPassed: payload.audit?.passed,
  factIssues: payload.audit?.factIssues?.length,
  protectedTermIssues: payload.audit?.protectedTermIssues?.length,
  missingNumbers: payload.checks?.missingNumbers?.length,
  addedNumbers: payload.checks?.addedNumbers?.length,
  missingTerms: payload.checks?.missingTerms?.length,
  elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
}));
