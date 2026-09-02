/**
 * humanStyleEnhanced.test.ts
 *
 * Unit-тесты для server/humanStyleEnhanced.ts
 * Запуск: npm test
 */

import test, { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AI_TELL_CATALOG_EXTENDED,
  detectAiTellsEnhanced,
  aiTellScoreEnhanced,
  paragraphLengthCV,
  passiveVoiceShare,
  uniqueWordRatio200,
  connectorDiversity,
  buildNegativeVoiceProfile,
  runMultiDetectorGate,
  buildRhythmBreakerPrompt,
  buildLexicalDiversifierPrompt,
  buildMicroImperfectionsPrompt,
} from "../server/humanStyleEnhanced";

// ─────────────────────────────────────────────────────────────────────────────
// ТЕКСТЫ ДЛЯ ТЕСТИРОВАНИЯ
// ─────────────────────────────────────────────────────────────────────────────

const AI_TEXT_DENSE = `
Прошло несколько мгновений. Она почувствовала прилив тревоги. Её руки непроизвольно сжались.
Надо сказать, что это был знаковый момент. Важно понять: жизнь уже не будет прежней.
В глубине души знал, что так и есть. Между тем время остановилось.
Волна страха накрыла её. Внутри что-то сжалось.
С одной стороны, ситуация казалась невозможной. Но на самом деле всё было иначе.
`;

const HUMAN_TEXT_CLEAN = `
Нож лежал поперёк стола. Она взяла его — пальцы не дрожали, вот именно.
Семь минут до поезда. Дверь в конце коридора не открывалась уже три дня, а она всё дёргала её ручку.
Дождь барабанил по жести. Подол платья промок до нитки, ну и ладно.
— Ты ведь понимаешь, — сказал он.
Она не ответила. Поставила чашку. Ушла.
`;

// ─────────────────────────────────────────────────────────────────────────────
// ТЕСТЫ: РАСШИРЕННЫЙ КАТАЛОГ
// ─────────────────────────────────────────────────────────────────────────────

describe("AI_TELL_CATALOG_EXTENDED", () => {
  it("должен содержать >= 40 паттернов", () => {
    assert.ok(AI_TELL_CATALOG_EXTENDED.length >= 40);
  });

  it("каждый паттерн имеет id, category, pattern, label, weight", () => {
    for (const pat of AI_TELL_CATALOG_EXTENDED) {
      assert.strictEqual(typeof pat.id, "string");
      assert.ok(pat.id.length > 0);
      assert.match(pat.category, /^(lexical|bureaucratic|structural|sensational|rlhf|interface)$/);
      assert.ok(pat.pattern instanceof RegExp);
      assert.strictEqual(typeof pat.label, "string");
      assert.ok(pat.weight > 0);
      assert.ok(pat.weight <= 3);
    }
  });

  it("все id уникальны", () => {
    const ids = AI_TELL_CATALOG_EXTENDED.map((p) => p.id);
    assert.strictEqual(new Set(ids).size, ids.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ТЕСТЫ: ОБНАРУЖЕНИЕ ПАТТЕРНОВ
// ─────────────────────────────────────────────────────────────────────────────

describe("detectAiTellsEnhanced", () => {
  it("находит паттерны в AI-тексте", () => {
    const hits = detectAiTellsEnhanced(AI_TEXT_DENSE, AI_TELL_CATALOG_EXTENDED, "general");
    assert.ok(hits.length > 3);
  });

  it("находит мало паттернов в HUMAN-тексте", () => {
    const hits = detectAiTellsEnhanced(HUMAN_TEXT_CLEAN, AI_TELL_CATALOG_EXTENDED, "general");
    assert.ok(hits.length < 3);
  });

  it("жанровый мультипликатор снижает вес horror-паттернов в horror жанре", () => {
    const horrorText = "Холодок пробежал по спине. Тишина давила.";
    const hitsGeneral = detectAiTellsEnhanced(horrorText, AI_TELL_CATALOG_EXTENDED, "general");
    const hitsHorror = detectAiTellsEnhanced(horrorText, AI_TELL_CATALOG_EXTENDED, "horror");
    const generalTotal = hitsGeneral.reduce((s, h) => s + h.adjustedWeight, 0);
    const horrorTotal = hitsHorror.reduce((s, h) => s + h.adjustedWeight, 0);
    assert.ok(horrorTotal <= generalTotal);
  });

  it("позиционный мультипликатор усиливает паттерны в начале текста", () => {
    const shortAiText = "Прошло несколько мгновений. " + "Слово ".repeat(100);
    const longAiText = "Слово ".repeat(50) + " Прошло несколько мгновений. " + "Слово ".repeat(50);
    const hitsShort = detectAiTellsEnhanced(shortAiText, AI_TELL_CATALOG_EXTENDED, "general");
    const hitsLong = detectAiTellsEnhanced(longAiText, AI_TELL_CATALOG_EXTENDED, "general");
    if (hitsShort.length > 0 && hitsLong.length > 0) {
      assert.ok(hitsShort[0].adjustedWeight > hitsLong[0].adjustedWeight);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ТЕСТЫ: SCORE
// ─────────────────────────────────────────────────────────────────────────────

describe("aiTellScoreEnhanced", () => {
  it("AI-текст получает score > HUMAN-текст", () => {
    const aiScore = aiTellScoreEnhanced(AI_TEXT_DENSE, AI_TELL_CATALOG_EXTENDED, "general");
    const humanScore = aiTellScoreEnhanced(HUMAN_TEXT_CLEAN, AI_TELL_CATALOG_EXTENDED, "general");
    assert.ok(aiScore > humanScore);
  });

  it("score находится в диапазоне 0–100", () => {
    const score = aiTellScoreEnhanced(AI_TEXT_DENSE, AI_TELL_CATALOG_EXTENDED, "general");
    assert.ok(score >= 0);
    assert.ok(score <= 100);
  });

  it("пустой текст возвращает 0", () => {
    assert.strictEqual(aiTellScoreEnhanced("", AI_TELL_CATALOG_EXTENDED), 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ТЕСТЫ: НОВЫЕ МЕТРИКИ
// ─────────────────────────────────────────────────────────────────────────────

describe("paragraphLengthCV", () => {
  it("монотонные абзацы дают низкий CV", () => {
    const monotone = "Слово один два три.\n\nСлово один два три.\n\nСлово один два три.\n\nСлово один два три.";
    const cv = paragraphLengthCV(monotone);
    assert.ok(cv < 0.3);
  });

  it("разнородные абзацы дают высокий CV", () => {
    const diverse = "Один.\n\nДолгий абзац с многими словами, который описывает сложную ситуацию подробно.\n\nДва.\n\nОчень длинный абзац, который продолжается и продолжается и содержит много деталей о происходящем в этой сцене романа.";
    const cv = paragraphLengthCV(diverse);
    assert.ok(cv > 0.4);
  });
});

describe("passiveVoiceShare", () => {
  it("текст с пассивным залогом даёт повышенную долю", () => {
    const passive = "Книга была прочитана. Дверь была открыта. Письмо было написано. Ответ был получен. Задание было выполнено.";
    assert.ok(passiveVoiceShare(passive) > 0.1);
  });

  it("активный текст даёт низкую долю", () => {
    const active = "Она открыла дверь. Он читал книгу. Ветер качал деревья. Дождь барабанил по стеклу.";
    assert.ok(passiveVoiceShare(active) < 0.15);
  });
});

describe("uniqueWordRatio200", () => {
  it("богатый словарь даёт высокий TTR", () => {
    const richText = Array.from({ length: 250 }, (_, i) => `уникальноесловономер${i}`).join(" ");
    assert.ok(uniqueWordRatio200(richText) > 0.7);
  });

  it("повторяющийся текст даёт низкий TTR", () => {
    const repetitive = "слово слово слово слово слово слово слово слово слово слово ".repeat(20);
    assert.ok(uniqueWordRatio200(repetitive) < 0.3);
  });
});

describe("connectorDiversity", () => {
  it("разнообразные коннекторы дают высокий diversity", () => {
    const varied = "Он пришёл. Однако дверь была закрыта. Тем не менее он постучал. При этом никто не ответил. Впрочем, он не удивился.";
    assert.ok(connectorDiversity(varied) > 0.7);
  });

  it("повторяющиеся коннекторы дают низкий diversity", () => {
    const monotone = "Он пришёл. Однако дверь была закрыта. Однако он не ушёл. Однако никто не ответил.";
    assert.ok(connectorDiversity(monotone) < 0.5);
  });

  it("текст без коннекторов возвращает 1 (нейтральный)", () => {
    const noConnectors = "Он пришёл. Дверь была закрыта. Он постучал. Никто не ответил.";
    assert.strictEqual(connectorDiversity(noConnectors), 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ТЕСТЫ: NEGATIVE PROFILE
// ─────────────────────────────────────────────────────────────────────────────

describe("buildNegativeVoiceProfile", () => {
  it("находит слова, эксклюзивные для AI", () => {
    const human = ["Она взяла нож. Стол был пуст."];
    const ai = ["Она почувствовала прилив тревоги. Осознала важность момента."];
    const profile = buildNegativeVoiceProfile("test", human, ai);
    const allForbidden = [...profile.forbiddenConstructions, ...profile.aiOnlyWords];
    assert.ok(allForbidden.length > 0);
  });

  it("возвращает правильный storyId", () => {
    const profile = buildNegativeVoiceProfile("story-42", [], []);
    assert.strictEqual(profile.storyId, "story-42");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ТЕСТЫ: MULTI-DETECTOR GATE
// ─────────────────────────────────────────────────────────────────────────────

describe("runMultiDetectorGate", () => {
  it("HUMAN-текст проходит gate или получает REVIEW", () => {
    const result = runMultiDetectorGate(HUMAN_TEXT_CLEAN, AI_TELL_CATALOG_EXTENDED, "general");
    assert.ok(["PASS", "REVIEW"].includes(result.verdict));
  });

  it("AI-текст с плотными штампами получает FAIL или REVIEW", () => {
    const result = runMultiDetectorGate(AI_TEXT_DENSE, AI_TELL_CATALOG_EXTENDED, "general");
    assert.ok(["FAIL", "REVIEW"].includes(result.verdict));
  });

  it("результат содержит все метрики", () => {
    const result = runMultiDetectorGate(HUMAN_TEXT_CLEAN, AI_TELL_CATALOG_EXTENDED, "general");
    assert.strictEqual(typeof result.aiTellScore, "number");
    assert.strictEqual(typeof result.paragraphCV, "number");
    assert.strictEqual(typeof result.passiveShare, "number");
    assert.strictEqual(typeof result.ttr200, "number");
    assert.strictEqual(typeof result.connectorDiv, "number");
    assert.ok(Array.isArray(result.details));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ТЕСТЫ: PROMPT BUILDERS
// ─────────────────────────────────────────────────────────────────────────────

describe("buildRhythmBreakerPrompt", () => {
  it("содержит переданный текст", () => {
    const prompt = buildRhythmBreakerPrompt("Тест текст.", "голос");
    assert.ok(prompt.includes("Тест текст."));
  });

  it("содержит burstiness диапазон", () => {
    const prompt = buildRhythmBreakerPrompt("Тест.", "", [0.4, 0.8]);
    assert.ok(prompt.includes("0.40"));
    assert.ok(prompt.includes("0.80"));
  });
});

describe("buildLexicalDiversifierPrompt", () => {
  it("содержит найденные AI-штампы", () => {
    const prompt = buildLexicalDiversifierPrompt("Тест.", "", [], ["«холодок по спине»"]);
    assert.ok(prompt.includes("«холодок по спине»"));
  });

  it("содержит инструкции по частицам", () => {
    const prompt = buildLexicalDiversifierPrompt("Тест.", "", [], []);
    assert.ok(prompt.includes("же"));
    assert.ok(prompt.includes("ведь"));
  });
});

describe("buildMicroImperfectionsPrompt", () => {
  it("содержит переданный текст", () => {
    const prompt = buildMicroImperfectionsPrompt("Тестовый текст.", "");
    assert.ok(prompt.includes("Тестовый текст."));
  });

  it("ограничивает объём правок 8-12%", () => {
    const prompt = buildMicroImperfectionsPrompt("Текст.", "");
    assert.ok(prompt.includes("8–12%"));
  });
});
