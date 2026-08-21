import { llmGenerate, llmLogBus } from "../server/llmProvider.js";
import dotenv from "dotenv";

dotenv.config();

// Подписываемся на события шины логов
llmLogBus.on("log", (event) => {
  const time = new Date(event.ts).toLocaleTimeString("ru");
  const prov = event.provider ? `[${event.provider.toUpperCase()}]` : "";
  console.log(`📡 [LOG BUS ${time}] ${event.level.toUpperCase()} ${prov} ${event.message}`);
});

async function testRotation() {
  console.log("\n==========================================");
  console.log("🚀 ТЕСТИРОВАНИЕ РОТАЦИИ LLM И FAILOVER...");
  console.log("==========================================\n");

  try {
    const result = await llmGenerate({
      model: "auto",
      systemInstruction: "Ты — краткий ассистент.",
      contents: "Напиши ровно 3 коротких предложения на русском языке о космосе.",
      temperature: 0.7,
      maxOutputTokens: 300,
    });

    console.log("\n✅ ТЕСТ УСПЕШНО ЗАВЕРШЁН!");
    console.log(`Провайдер: ${result.provider}`);
    console.log(`Модель: ${result.model}`);
    console.log(`Failover-счётчик: ${result.failoverCount ?? 0}`);
    console.log(`Текст ответа:\n"""\n${result.text}\n"""`);
  } catch (err: any) {
    console.error("\n❌ ОШИБКА ГЕНЕРАЦИИ:", err.message);
  }
}

testRotation();
