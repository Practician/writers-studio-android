import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

// Загружаем переменные окружения
dotenv.config({ override: true });

import { AgentOrchestrator, type AgentTask } from "../server/agent/orchestrator";
import { EpisodicMemory } from "../server/agent/memory";
import { runWithLlmRequestContext } from "../server/llmProvider";
import {
  LABYRINTH_AUTHOR_SAMPLE,
  LABYRINTH_WORLD_BIBLE,
  LABYRINTH_BOOK_PLAN,
  LABYRINTH_VOICE_SHEET,
} from "../src/data/labyrinthCanon";
import { extractContinuityAnchors } from "../src/lib/chapterContext";
import { aiTellScore, sentenceBurstiness, shortSentenceStats } from "../server/humanStyle";
import { countWordsRu, russianLanguageIssues } from "../server/chapterGenerate";

const outDir = path.join("test-artifacts", "ch10-agent");
fs.mkdirSync(outDir, { recursive: true });

// Читаем текст главы 8 в качестве предыдущей главы
const ch8Text = fs.readFileSync(path.join("src", "data", "labyrinth", "chapter-8.txt"), "utf8");
const sample = LABYRINTH_AUTHOR_SAMPLE.slice(0, 7000);

async function main() {
  console.log("\n==========================================");
  console.log("🚀 ТЕСТИРОВАНИЕ АГЕНТСКОЙ ГЕНЕРАЦИИ ГЛАВЫ 10...");
  console.log("==========================================\n");
  
  const provider = (process.env.LLM_PROVIDER || "auto") as any;
  console.log(`Предыдущая глава 8: ${countWordsRu(ch8Text)} слов`);
  
  // Создаём якоря непрерывности (continuity) из главы 8
  const continuity = extractContinuityAnchors(ch8Text, "Глава 8. Уровень 2");
  
  // Конструируем задачу агента
  const taskId = `agent-test-${Date.now()}`;
  const task: AgentTask = {
    id: taskId,
    type: "write_chapter",
    goal: "Написать главу 10. Датчики",
    storyId: "labyrinth",
    config: {
      maxDraftAttempts: 3,
      minCraftScore: 60,
      maxTouchupPasses: 2,
      targetWordCount: [1200, 2000],
      humanizeDepth: "maximum",
      model: "auto",
    },
    input: {
      title: "Лабиринт. Путь домой",
      genre: "психологический триллер / survival / техно-мистика",
      description: "Студент в многоуровневом Лабиринте. Телефон — якорь и интерфейс системы.",
      chapterTitle: "Глава 10. Датчики",
      chapterSummary: "СТЫК с концом главы 8. Герой сидит у круглого отпечатка на стене Уровня 2 с 20% заряда телефона. Внезапно телефон начинает вибрировать, на экране помимо тепловизора и карты активируются новые датчики: магнитометр и барометр. Давление резко падает, стрелка компаса на экране бешено крутится — зона магнитной аномалии. Возникает угроза разгерметизации коридора. Герой пытается сориентироваться по датчикам, находит гермозатвор или вентиль и вручную перекрывает отсек. Повествование от 1 лица, ирония, технический склад ума Андрея.",
      previousChapter: ch8Text,
      worldBible: LABYRINTH_WORLD_BIBLE,
      bookPlan: LABYRINTH_BOOK_PLAN,
      customPrompt: "Не пиши про сон или кольца из Акта 1. Сфокусируйся на датчиках телефона (магнитометр, барометр). Проверь давление и магнитные аномалии. Ирония, технический склад ума Андрея.",
      authorSample: sample,
      voiceSheet: LABYRINTH_VOICE_SHEET,
    }
  };

  const memory = new EpisodicMemory();
  const orchestrator = new AgentOrchestrator(memory);

  // Подписываемся на события агента
  orchestrator.onEvent((event) => {
    const ts = new Date().toLocaleTimeString("ru");
    if (event.type === "state_change") {
      console.log(`\n🔄 [${ts}] СМЕНА СОСТОЯНИЯ: ${event.from} ➔ ${event.to}`);
    } else if (event.type === "reasoning") {
      console.log(`🧠 [${ts}] МЫСЛЬ: ${event.thought}`);
    } else if (event.type === "tool_call") {
      console.log(`🛠️ [${ts}] ВЫЗОВ ИНСТРУМЕНТА: ${event.tool} (аргументы: ${JSON.stringify(event.args).slice(0, 150)}...)`);
    } else if (event.type === "tool_result") {
      console.log(`✅ [${ts}] РЕЗУЛЬТАТ ИНСТРУМЕНТА: ${event.tool} ➔ ${event.summary}`);
    } else if (event.type === "draft_preview") {
      console.log(`📝 [${ts}] ЧЕРНОВИК СГЕНЕРИРОВАН (${event.wordCount} слов)`);
    } else if (event.type === "evaluation") {
      console.log(`📊 [${ts}] ОЦЕНКА: Качество = ${event.craftScore}/100, Замечания = ${event.issues.length ? event.issues.join(", ").slice(0, 150) : "нет"}`);
    } else if (event.type === "correction") {
      console.log(`🔧 [${ts}] КОРРЕКЦИЯ (проход #${event.pass})`);
    }
  });

  try {
    console.log("\n🚀 Запуск выполнения задачи агента...");
    const result = await runWithLlmRequestContext({ preference: provider }, async () => {
      return await orchestrator.execute(task);
    });

    console.log("\n==========================================");
    console.log("🏁 ВЫПОЛНЕНИЕ ЗАДАЧИ АГЕНТА ЗАВЕРШЕНО!");
    console.log("==========================================\n");

    if (result.state === "completed" && result.text) {
      const out = result.text;
      const score = aiTellScore(out);
      const words = countWordsRu(out);
      const lang = russianLanguageIssues(out);

      console.log(`Статус: УСПЕШНО`);
      console.log(`Количество слов: ${words}`);
      console.log(`AI-Tell Score: ${score.score}/100`);
      console.log(`Языковые проблемы: ${lang.length ? lang.join(", ") : "нет"}`);

      // Сохраняем в файлы
      const outPath = path.join(outDir, "chapter-10.txt");
      fs.writeFileSync(outPath, out, "utf8");
      console.log(`\nРезультат сохранён в: ${outPath}`);
    } else {
      console.error(`Статус: СБОЙ`);
      console.error(`Ошибка: ${result.error || "Неизвестная ошибка"}`);
    }
  } catch (err: any) {
    console.error(`\n❌ ФАТАЛЬНАЯ ОШИБКА:`, err.message || err);
  }
}

main().catch(console.error);
