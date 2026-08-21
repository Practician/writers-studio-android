import { llmGenerate } from "../server/llmProvider.js";
import dotenv from "dotenv";

dotenv.config();

async function run() {
  console.log("=== ТЕСТИРОВАНИЕ ЛИМИТОВ (RPM) GEMINI ===");
  console.log("Запускаем 20 параллельных запросов к Gemini, чтобы спровоцировать 429 RPM limit...");
  
  const promises = [];
  for (let i = 0; i < 20; i++) {
    // Небольшая задержка, чтобы запросы не упали по таймауту сети разом, а реально дошли до API
    const delay = i * 200; 
    promises.push(
      new Promise(resolve => setTimeout(resolve, delay)).then(() => {
        console.log(`[Req ${i+1}] Стартуем...`);
        return llmGenerate({
          model: "gemini-2.5-flash",
          contents: `Напиши одно слово: тест ${i}`,
          maxOutputTokens: 10
        }).then(res => {
          console.log(`[Req ${i+1}] УСПЕХ: ${res.text}`);
        }).catch(err => {
          console.log(`[Req ${i+1}] ОШИБКА:`, err.message);
        });
      })
    );
  }

  await Promise.all(promises);
  console.log("=== ТЕСТИРОВАНИЕ ЗАВЕРШЕНО ===");
}

run().catch(console.error);
