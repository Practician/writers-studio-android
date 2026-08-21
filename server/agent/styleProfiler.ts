// server/agent/styleProfiler.ts
// Глубокий стилометрический анализ авторских образцов ("паспорт автора").
// Расширяет AuthorVoiceSheet количественными метриками и few-shot примерами.

import { Type } from "@google/genai";
import type { AuthorVoiceSheet } from "../../src/types";
import { aiTellScore, sentenceBurstiness, detectAiTells } from "../humanStyle";
import { parseJsonResponse, selectStyleExcerpts, voiceSheetSchema, buildProfilePrompt } from "../authorPipeline";
import { llmGenerate, llmTextOrThrow } from "../llmProvider";

export interface PunctuationProfile {
  emDashes: number;
  semiColons: number;
  colons: number;
  ellipses: number;
  quotes: number;
  exclamationMarks: number;
  questionMarks: number;
}

export interface StyleMetrics {
  avgSentenceLength: number;
  sentenceLengthVariance: number;
  avgParagraphLength: number;
  dialogueToNarrativeRatio: number;
  uniqueWordRatio: number;
  punctuationProfile: PunctuationProfile;
  topNGrams: string[];
  burstiness: number;
}

export interface StylePatterns {
  openingStyles: string[];
  transitionPhrases: string[];
  dialogueTags: string[];
  sensoryPreferences: string[];
  metaphorTypes: string[];
  narrativePace: string;
  emotionalRange: string;
  avoidances: string[];
  frequentVerbs: string[];
  frequentAdverbs: string[];
}

export interface StyleExemplar {
  category: 'action' | 'dialogue' | 'description' | 'internal' | 'transition';
  text: string;
  annotation: string;
}

export interface DeepStyleProfile {
  voiceSheet: AuthorVoiceSheet;
  metrics: StyleMetrics;
  patterns: StylePatterns;
  exemplars: StyleExemplar[];
  version: number;
  createdAt: string;
  updatedAt: string;
  sampleCharCount: number;
}

/**
 * Вычисляет статистические/количественные метрики текста (без LLM)
 */
export function computeStyleMetrics(text: string): StyleMetrics {
  // Разбиваем на предложения
  const sentences = text.split(/[.!?…]+\s+/).filter(s => s.trim().length > 0);
  const sentenceLengths = sentences.map(s => s.trim().split(/\s+/).length);
  const avgSentenceLength = sentenceLengths.length > 0 ? sentenceLengths.reduce((a, b) => a + b, 0) / sentenceLengths.length : 0;
  
  let variance = 0;
  if (sentenceLengths.length > 0) {
    variance = sentenceLengths.reduce((a, b) => a + Math.pow(b - avgSentenceLength, 2), 0) / sentenceLengths.length;
  }

  // Разбиваем на абзацы
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim().length > 0);
  const paragraphLengths = paragraphs.map(p => p.trim().split(/\s+/).length);
  const avgParagraphLength = paragraphLengths.length > 0 ? paragraphLengths.reduce((a, b) => a + b, 0) / paragraphLengths.length : 0;

  // Диалоги
  const dialogueLines = paragraphs.filter(p => p.trim().startsWith('—') || p.trim().startsWith('«') || p.trim().startsWith('"'));
  const dialogueToNarrativeRatio = paragraphs.length > 0 ? dialogueLines.length / paragraphs.length : 0;

  // Уникальные слова
  const words = text.match(/[а-яА-ЯёЁa-zA-Z]+/g) || [];
  const uniqueWords = new Set(words.map(w => w.toLowerCase()));
  const uniqueWordRatio = words.length > 0 ? uniqueWords.size / words.length : 0;

  // Профиль пунктуации
  const punctuationProfile: PunctuationProfile = {
    emDashes: (text.match(/—/g) || []).length,
    semiColons: (text.match(/;/g) || []).length,
    colons: (text.match(/:/g) || []).length,
    ellipses: (text.match(/\.\.\.|…/g) || []).length,
    quotes: (text.match(/[«»""]/g) || []).length,
    exclamationMarks: (text.match(/!/g) || []).length,
    questionMarks: (text.match(/\?/g) || []).length,
  };

  // N-граммы (символьные триграммы для фингерпринта)
  const trigramCounts = new Map<string, number>();
  for (let i = 0; i < text.length - 2; i++) {
    const trigram = text.substring(i, i + 3).toLowerCase();
    trigramCounts.set(trigram, (trigramCounts.get(trigram) || 0) + 1);
  }
  const topNGrams = Array.from(trigramCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(e => e[0]);

  // Burstiness
  const burstiness = sentenceBurstiness(text);

  return {
    avgSentenceLength,
    sentenceLengthVariance: variance,
    avgParagraphLength,
    dialogueToNarrativeRatio,
    uniqueWordRatio,
    punctuationProfile,
    topNGrams,
    burstiness
  };
}

/**
 * Извлекает качественные стилистические паттерны с помощью LLM
 */
export async function extractStylePatterns(text: string, model: string): Promise<StylePatterns> {
  const prompt = `Проанализируй предоставленный текст и выдели качественные паттерны авторского стиля.

Текст:
${text}
`;

  const schema = {
    type: Type.OBJECT,
    properties: {
      openingStyles: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Как автор начинает сцены и абзацы (первые 2-3 слова)" },
      transitionPhrases: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Фразы-связки между абзацами и сценами" },
      dialogueTags: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Стиль атрибуции диалогов (как автор вводит прямую речь)" },
      sensoryPreferences: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Какие органы чувств доминируют в описаниях (зрение, слух, осязание и т.д.)" },
      metaphorTypes: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Типы используемых метафор и сравнений" },
      narrativePace: { type: Type.STRING, description: "Оценка темпа повествования (быстрый, медленный, рваный, плавный)" },
      emotionalRange: { type: Type.STRING, description: "Эмоциональный диапазон текста" },
      avoidances: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Чего автор сознательно избегает (например, длинных описаний, определенных слов)" },
      frequentVerbs: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Специфичные, характерные глаголы, которые часто использует автор" },
      frequentAdverbs: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Характерные наречия, которые использует автор" },
    },
    required: ["openingStyles", "transitionPhrases", "dialogueTags", "sensoryPreferences", "metaphorTypes", "narrativePace", "emotionalRange", "avoidances", "frequentVerbs", "frequentAdverbs"]
  };

  const response = await llmGenerate({
    model,
    systemInstruction: "Ты — эксперт-литературовед и стилометрист. Твоя задача — глубокий анализ авторского стиля.",
    contents: prompt,
    responseMimeType: "application/json",
    responseSchema: schema
  });

  const responseText = llmTextOrThrow(response, "StylePatterns");
  return parseJsonResponse<StylePatterns>(responseText, "StylePatterns");
}

/**
 * Отбирает репрезентативные фрагменты из текста для few-shot промптинга
 */
export async function selectExemplars(text: string, model: string): Promise<StyleExemplar[]> {
  const prompt = `Проанализируй текст и выбери 8-12 репрезентативных фрагментов, которые лучше всего отражают стиль автора.
Для каждого фрагмента определи его категорию и напиши короткую аннотацию, объясняющую, почему он характерен для этого стиля.

Текст:
${text}
`;

  const schema = {
    type: Type.ARRAY,
    items: {
      type: Type.OBJECT,
      properties: {
        category: { type: Type.STRING, enum: ['action', 'dialogue', 'description', 'internal', 'transition'] },
        text: { type: Type.STRING, description: "Сам фрагмент текста, слово в слово" },
        annotation: { type: Type.STRING, description: "Почему этот фрагмент характерен для стиля автора" }
      },
      required: ["category", "text", "annotation"]
    }
  };

  const response = await llmGenerate({
    model,
    systemInstruction: "Ты — эксперт-литературовед. Отбирай самые показательные фрагменты, раскрывающие уникальность авторского голоса.",
    contents: prompt,
    responseMimeType: "application/json",
    responseSchema: schema
  });

  const responseText = llmTextOrThrow(response, "StyleExemplars");
  return parseJsonResponse<StyleExemplar[]>(responseText, "StyleExemplars");
}

/**
 * Основная функция для построения полного паспорта стиля автора
 */
export async function buildDeepStyleProfile(sample: string, model: string, existingVoiceSheet?: AuthorVoiceSheet): Promise<DeepStyleProfile> {
  const metrics = computeStyleMetrics(sample);
  
  const patternsPromise = extractStylePatterns(sample, model);
  const exemplarsPromise = selectExemplars(sample, model);
  
  let voiceSheet: AuthorVoiceSheet;
  if (existingVoiceSheet) {
    voiceSheet = existingVoiceSheet;
  } else {
    const vsPrompt = buildProfilePrompt({ action: "profile", sample, styleDescription: "" });
    const vsResponse = await llmGenerate({
      model,
      systemInstruction: "Ты — опытный литературный редактор. Твоя задача — формализовать стилистический профиль голоса автора.",
      contents: vsPrompt,
      responseMimeType: "application/json",
      responseSchema: voiceSheetSchema
    });
    voiceSheet = parseJsonResponse<AuthorVoiceSheet>(llmTextOrThrow(vsResponse, "AuthorVoiceSheet"), "AuthorVoiceSheet");
  }

  const [patterns, exemplars] = await Promise.all([patternsPromise, exemplarsPromise]);

  return {
    voiceSheet,
    metrics,
    patterns,
    exemplars,
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sampleCharCount: sample.length
  };
}

/**
 * Обновляет и расширяет существующий профиль при добавлении новых текстов автора
 */
export async function mergeProfiles(existing: DeepStyleProfile, newSample: string, model: string): Promise<DeepStyleProfile> {
  const newMetrics = computeStyleMetrics(newSample);
  const newPatterns = await extractStylePatterns(newSample, model);
  const newExemplars = await selectExemplars(newSample, model);

  // Усредняем метрики (можно добавить весовые коэффициенты на основе объёма текста)
  const mergedMetrics: StyleMetrics = {
    avgSentenceLength: (existing.metrics.avgSentenceLength + newMetrics.avgSentenceLength) / 2,
    sentenceLengthVariance: (existing.metrics.sentenceLengthVariance + newMetrics.sentenceLengthVariance) / 2,
    avgParagraphLength: (existing.metrics.avgParagraphLength + newMetrics.avgParagraphLength) / 2,
    dialogueToNarrativeRatio: (existing.metrics.dialogueToNarrativeRatio + newMetrics.dialogueToNarrativeRatio) / 2,
    uniqueWordRatio: (existing.metrics.uniqueWordRatio + newMetrics.uniqueWordRatio) / 2,
    punctuationProfile: {
      emDashes: existing.metrics.punctuationProfile.emDashes + newMetrics.punctuationProfile.emDashes,
      semiColons: existing.metrics.punctuationProfile.semiColons + newMetrics.punctuationProfile.semiColons,
      colons: existing.metrics.punctuationProfile.colons + newMetrics.punctuationProfile.colons,
      ellipses: existing.metrics.punctuationProfile.ellipses + newMetrics.punctuationProfile.ellipses,
      quotes: existing.metrics.punctuationProfile.quotes + newMetrics.punctuationProfile.quotes,
      exclamationMarks: existing.metrics.punctuationProfile.exclamationMarks + newMetrics.punctuationProfile.exclamationMarks,
      questionMarks: existing.metrics.punctuationProfile.questionMarks + newMetrics.punctuationProfile.questionMarks,
    },
    topNGrams: Array.from(new Set([...existing.metrics.topNGrams, ...newMetrics.topNGrams])).slice(0, 20),
    burstiness: (existing.metrics.burstiness + newMetrics.burstiness) / 2
  };

  // Объединяем паттерны
  const mergedPatterns: StylePatterns = {
    openingStyles: Array.from(new Set([...existing.patterns.openingStyles, ...newPatterns.openingStyles])).slice(0, 10),
    transitionPhrases: Array.from(new Set([...existing.patterns.transitionPhrases, ...newPatterns.transitionPhrases])).slice(0, 10),
    dialogueTags: Array.from(new Set([...existing.patterns.dialogueTags, ...newPatterns.dialogueTags])).slice(0, 10),
    sensoryPreferences: Array.from(new Set([...existing.patterns.sensoryPreferences, ...newPatterns.sensoryPreferences])),
    metaphorTypes: Array.from(new Set([...existing.patterns.metaphorTypes, ...newPatterns.metaphorTypes])),
    narrativePace: existing.patterns.narrativePace + " / " + newPatterns.narrativePace,
    emotionalRange: existing.patterns.emotionalRange + " / " + newPatterns.emotionalRange,
    avoidances: Array.from(new Set([...existing.patterns.avoidances, ...newPatterns.avoidances])),
    frequentVerbs: Array.from(new Set([...(existing.patterns.frequentVerbs ?? []), ...(newPatterns.frequentVerbs ?? [])])).slice(0, 20),
    frequentAdverbs: Array.from(new Set([...(existing.patterns.frequentAdverbs ?? []), ...(newPatterns.frequentAdverbs ?? [])])).slice(0, 20),
  };

  // Объединяем фрагменты
  let mergedExemplars = [...existing.exemplars, ...newExemplars];
  if (mergedExemplars.length > 20) {
    // Оставляем последние добавленные
    mergedExemplars = mergedExemplars.slice(-20);
  }

  return {
    ...existing,
    metrics: mergedMetrics,
    patterns: mergedPatterns,
    exemplars: mergedExemplars,
    version: existing.version + 1,
    updatedAt: new Date().toISOString(),
    sampleCharCount: existing.sampleCharCount + newSample.length
  };
}

/**
 * Генерирует текстовый блок инструкций для LLM на основе глубокого профиля
 */
export function buildStyleInstructionBlock(profile: DeepStyleProfile): string {
  const lines: string[] = [];

  lines.push("=== ПАСПОРТ АВТОРСКОГО СТИЛЯ ===\n");

  // Voice Sheet
  lines.push("[ОСНОВНЫЕ ХАРАКТЕРИСТИКИ (Voice Sheet)]");
  lines.push(`- Резюме голоса: ${profile.voiceSheet.summary}`);
  if (profile.voiceSheet.voiceRules.length) {
    lines.push("- Правила голоса:");
    for (const rule of profile.voiceSheet.voiceRules) {
      lines.push(`  * ${rule}`);
    }
  }
  if (profile.voiceSheet.avoid.length) {
    lines.push("- Избегать:");
    for (const item of profile.voiceSheet.avoid) {
      lines.push(`  * ${item}`);
    }
  }
  lines.push("");

  // Количественные метрики
  lines.push("[КОЛИЧЕСТВЕННЫЕ ЦЕЛЕВЫЕ ПОКАЗАТЕЛИ]");
  lines.push(`- Средняя длина предложения: ~${profile.metrics.avgSentenceLength.toFixed(1)} слов`);
  lines.push(`- Вариативность длины предложений (burstiness): ${profile.metrics.burstiness.toFixed(2)}`);
  lines.push(`- Отношение диалогов к описаниям: ${(profile.metrics.dialogueToNarrativeRatio * 100).toFixed(0)}%`);
  lines.push(`- Лексическое разнообразие (TTR): ${(profile.metrics.uniqueWordRatio * 100).toFixed(1)}%`);
  lines.push("");

  // Паттерны
  lines.push("[СТИЛИСТИЧЕСКИЕ ПАТТЕРНЫ]");
  if (profile.patterns.openingStyles.length) {
    lines.push(`- Начала сцен/абзацев: ${profile.patterns.openingStyles.join(" | ")}`);
  }
  if (profile.patterns.transitionPhrases.length) {
    lines.push(`- Переходы: ${profile.patterns.transitionPhrases.join(" | ")}`);
  }
  if (profile.patterns.dialogueTags.length) {
    lines.push(`- Атрибуция диалогов: ${profile.patterns.dialogueTags.join(" | ")}`);
  }
  if (profile.patterns.sensoryPreferences.length) {
    lines.push(`- Сенсорные акценты: ${profile.patterns.sensoryPreferences.join(" | ")}`);
  }
  if (profile.patterns.avoidances.length) {
    lines.push(`- Чего категорически избегать: ${profile.patterns.avoidances.join(" | ")}`);
  }
  if (profile.patterns.frequentVerbs && profile.patterns.frequentVerbs.length) {
    lines.push(`- Характерные глаголы (лексикон): ${profile.patterns.frequentVerbs.join(", ")}`);
  }
  if (profile.patterns.frequentAdverbs && profile.patterns.frequentAdverbs.length) {
    lines.push(`- Характерные наречия (лексикон): ${profile.patterns.frequentAdverbs.join(", ")}`);
  }
  lines.push(`- Темп повествования: ${profile.patterns.narrativePace}`);
  lines.push("");

  // Few-shot примеры
  lines.push("[ЭТАЛОННЫЕ ПРИМЕРЫ (Few-Shot)]");
  const exemplarSlice = profile.exemplars.slice(0, 5);
  exemplarSlice.forEach((ex, i) => {
    lines.push(`Пример ${i + 1} (${ex.category}):`);
    lines.push(`"${ex.text}"`);
    lines.push(`(Суть: ${ex.annotation})\n`);
  });

  lines.push("ИНСТРУКЦИЯ: При генерации текста строго придерживайся этих метрик, паттернов и правил. Твоя задача — создать текст, который статистически и стилистически будет неотличим от представленного авторского профиля.");

  return lines.join("\n");
}
