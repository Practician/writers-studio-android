/**
 * Генерация главы 8 с учётом исправленной главы 7.
 * npx tsx scripts/generate-ch8-from-ch7.ts
 */
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
dotenv.config({ override: false });

import { llmGenerate, runWithProviderPreference } from "../server/llmProvider";
import { aiTellScore, humanStyleDirectives, sentenceBurstiness, shortSentenceStats } from "../server/humanStyle";
import { countWordsRu, russianLanguageIssues, generateHumanizedChapter, type ChapterGenerateInput } from "../server/chapterGenerate";
import {
  LABYRINTH_AUTHOR_SAMPLE,
  LABYRINTH_VOICE_SHEET,
  LABYRINTH_WORLD_BIBLE,
  LABYRINTH_BOOK_PLAN,
} from "../src/data/labyrinthCanon";
import { extractContinuityAnchors } from "../src/lib/chapterContext";

const outDir = path.join("test-artifacts", "ch78-app");
fs.mkdirSync(outDir, { recursive: true });

// Read updated chapter 7
const ch7Text = fs.readFileSync(path.join("src", "data", "labyrinth", "chapter-7.txt"), "utf8");
const sample = LABYRINTH_AUTHOR_SAMPLE.slice(0, 7000);

async function main() {
  const provider = (process.env.LLM_PROVIDER || "auto") as any;
  console.log(`Генерация главы 8 из исправленной главы 7 (provider: ${provider})`);
  console.log(`Глава 7: ${countWordsRu(ch7Text)} слов`);

  // Build continuity anchors from ch7
  const continuity = extractContinuityAnchors(ch7Text, "Глава 7. Отпечаток ладони");
  console.log(`\nЯкоря стыка:\n${continuity.slice(0, 500)}...`);

  const input: ChapterGenerateInput = {
    title: "Лабиринт. Путь домой",
    genre: "психологический триллер / survival / техно-мистика",
    description: "Студент в многоуровневом Лабиринте. Телефон — якорь и интерфейс системы.",
    currentChapterTitle: "Глава 8. Уровень 2",
    currentChapterSummary: "СТЫК с концом 7: уже за щелью, «Уровень 2» на стене, ~20%, кольца/ладонь позади (проход мог закрыться). НЕ сон, НЕ активация ладони, НЕ кольца с нуля, НЕ 2%. Сцена: зелёные риски, развилки, первые метки ключом/телефоном, появление карты и датчиков (шаги/статус), диск-якорь или узел. Крючок на скрытую закладку/пропуск. 1 лицо, голос гл.6–7.",
    previousChapter: ch7Text,
    worldBible: LABYRINTH_WORLD_BIBLE,
    bookPlan: LABYRINTH_BOOK_PLAN,
    canonDossier: continuity,
    customPrompt: "Не повторяй сюжет главы 7. Не описывай сон, ладонь, кольца. Герой уже на Уровне 2. Голос как дневник: «однако», «ну, чтож», бытовая ирония. Без UI-лога (шаги: 41, статус: ок). Риски на стенах — конкретика, не инвентарь.",
    authorSample: sample,
    humanizeDepth: "maximum",
    model: "auto",
  };

  try {
    const generate = async (params: {
      model: string;
      contents: string;
      systemInstruction: string;
      temperature: number;
      responseMimeType?: string;
      responseSchema?: unknown;
      maxOutputTokens?: number;
    }): Promise<string> => {
      const result = await runWithProviderPreference(provider, () =>
        llmGenerate({
          model: params.model === "auto" ? undefined : params.model,
          systemInstruction: params.systemInstruction,
          contents: params.contents,
          temperature: params.temperature,
          maxOutputTokens: params.maxOutputTokens ?? 16384,
        }),
      );
      return (result.text || "").replace(/^```(?:text|markdown)?\s*/i, "").replace(/```$/i, "").trim();
    };

    console.log("\nГенерация через generateHumanizedChapter (maximum mode)...");
    const result = await generateHumanizedChapter(input, generate);

    const out = result.text;
    const score = aiTellScore(out);
    const words = countWordsRu(out);
    const burst = sentenceBurstiness(out);
    const short = shortSentenceStats(out, 4);
    const lang = russianLanguageIssues(out);

    console.log(`\n=== РЕЗУЛЬТАТ ===`);
    console.log(`Слов: ${words}`);
    console.log(`AI-Tell Score: ${score.score}/100`);
    console.log(`Burstiness: ${burst.toFixed(3)}`);
    console.log(`ShortShare: ${(short.share * 100).toFixed(1)}%`);
    console.log(`MaxChain: ${short.maxChain}`);
    console.log(`Языковые проблемы: ${lang.length ? lang.join(", ") : "нет"}`);
    console.log(`Hits: ${score.hits.length}`);
    for (const h of score.hits) {
      console.log(`  [${h.category}] ${h.label}`);
    }
    console.log(`\nPipeline report:`);
    console.log(`  scoreBefore: ${result.humanizeReport.scoreBefore}`);
    console.log(`  scoreAfter: ${result.humanizeReport.scoreAfter}`);
    console.log(`  refinedBlocks: ${result.humanizeReport.refinedBlocks}`);
    console.log(`  passesRun: ${result.humanizeReport.passesRun}`);
    console.log(`  gatePassed: ${result.humanizeReport.gatePassed}`);
    console.log(`  depth: ${result.humanizeReport.depth}`);

    // Save
    const outPath = path.join(outDir, "ch8-generated-v2.txt");
    fs.writeFileSync(outPath, out, "utf8");
    console.log(`\nСохранено: ${outPath}`);

    // Also save a copy in chapter7 artifacts for comparison
    const artifactPath = path.join("test-artifacts", "chapter7", "ch8-from-ch7.txt");
    fs.writeFileSync(artifactPath, out, "utf8");
    console.log(`Сохранено: ${artifactPath}`);

  } catch (error: any) {
    console.error(`\nОШИБКА: ${error.message}`);
    if (error.message.includes("нет ключа") || error.message.includes("not configured")) {
      console.log("\nНужен API-ключ. Установите GEMINI_API_KEY или NVIDIA_API_KEY в .env");
    }
  }
}

main();
