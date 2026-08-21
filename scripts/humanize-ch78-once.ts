/**
 * One-shot maximum human rewrite for ch7/ch8 via LLM.
 * npx tsx scripts/humanize-ch78-once.ts ch8
 */
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
dotenv.config({ override: false });

import { llmGenerate, runWithProviderPreference } from "../server/llmProvider";
import { aiTellScore } from "../server/humanStyle";
import { countWordsRu, russianLanguageIssues } from "../server/chapterGenerate";
import {
  LABYRINTH_AUTHOR_SAMPLE,
  LABYRINTH_VOICE_SHEET,
} from "../src/data/labyrinthCanon";

const which = (process.argv[2] || "ch8") as "ch7" | "ch8";
const src =
  which === "ch7"
    ? path.join("src", "data", "labyrinth", "chapter-7.txt")
    : path.join("src", "data", "labyrinth", "chapter-8.txt");
const outDir = path.join("test-artifacts", "ch78-app");
fs.mkdirSync(outDir, { recursive: true });

const text = fs.readFileSync(src, "utf8");
const sample = LABYRINTH_AUTHOR_SAMPLE.slice(0, 7000);

const plot7 =
  "Сюжет гл.7: ~20% после колец; сон (институт-формула → дом/мама/суп → явь); телефон к отпечатку; точки; ошибка ритма → верный; двойная янтарная ладонь; щель; Уровень 2; стена закрылась. Не 2%. Не кольца с нуля.";
const plot8 =
  "Сюжет гл.8: уже Уровень 2, стена закрыта; ~20%; зелёные риски; линия-след; диск-якорь; развилка 3; средняя ниша «Ты уже выбирал не туда»; правый влажный ход; бугорок/закладка не открыта; крючок. Не сон. Не ладонь. Не кольца.";

const system = `Ты — живой редактор. Перепиши главу по-русски так, чтобы нейродетектор (Yandex) дал HUMAN.
Голос строго как авторская глава 1 «Лабиринт»: дневник студента, «однако», «ну, чтож», самоирония («крыса», «подкормились»), бытовые отступления, неровный ритм.
Пиши связной прозой, не квест-логом. Допускай разговорные шероховатости как в образце.
ЗАПРЕЩЕНО: CW/CCW/NFC/level, «обнаружена метка», нумерованные списки 1. 2. 3., рубленые «Сел. Встал. Пошёл.», латиница, UI «шаги:», «статус:», мета «не список не таблица».
${which === "ch7" ? plot7 : plot8}
Длина 1000–1400 слов. Только текст главы, без предисловий.

ОБРАЗЕЦ ГОЛОСА (гл.1):
${sample}

ПРАВИЛА:
${LABYRINTH_VOICE_SHEET.voiceRules.join("\n")}
ИЗБЕГАТЬ: ${LABYRINTH_VOICE_SHEET.avoid.join("; ")}
`;

async function main() {
  const provider = (process.env.LLM_PROVIDER || "gemini") as "gemini" | "nvidia" | "groq" | "auto";
  console.log("provider pref", provider, "words in", countWordsRu(text));

  const r = await runWithProviderPreference(provider, () =>
    llmGenerate({
      model:
        provider === "gemini"
          ? process.env.GEMINI_MODEL || "gemini-2.0-flash"
          : process.env.NVIDIA_DEFAULT_MODEL || "qwen/qwen3.5-122b-a10b",
      systemInstruction: system,
      contents:
        `Перепиши главу ${which === "ch7" ? "7" : "8"} максимально по-человечески, сохранив канон и стыки:\n\n` +
        text,
      temperature: 0.9,
      maxOutputTokens: 8192,
    }),
  );

  let out = (r.text || "").trim();
  // strip fences
  out = out.replace(/^```(?:text|markdown)?\s*/i, "").replace(/\s*```$/i, "").trim();
  // soft anti-ui
  out = out.replace(/\bNFC\b/g, "бесконтакт");
  out = out.replace(/\b(CW|CCW)\b/g, "");
  out = out.replace(/обнаружена\s+новая\s+метка/giu, "телефон коротко бзикнул");
  out = out.replace(/шаги\s*:\s*\d+/giu, "шаги");

  const score = aiTellScore(out);
  const lang = russianLanguageIssues(out);
  const words = countWordsRu(out);
  console.log(
    `out words=${words} aiTell=${score.score} burst=${score.burstiness.toFixed(2)} lang=${lang[0] || "ok"} provider=${r.provider}/${r.model}`,
  );

  const outPath = path.join(outDir, `${which}-llm-human.txt`);
  fs.writeFileSync(outPath, out, "utf8");
  console.log("wrote", outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
