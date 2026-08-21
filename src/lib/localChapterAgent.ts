import type { AuthorVoiceSheet, Chapter, Story } from "../types";
import { directGenerate, type DirectProvider } from "./directLlmClient";

export type LocalAgentState = "planning" | "context" | "evaluating" | "correcting" | "auditing" | "completed";

export interface LocalAgentEvent {
  state: LocalAgentState;
  message: string;
}

export interface LocalAgentReview {
  craftScore: number;
  issues: string[];
  strengths: string[];
  nextStep: string;
}

export interface LocalAgentResult {
  text: string;
  review: LocalAgentReview;
  duration: string;
  wordCount: number;
}

export interface LocalAgentInput {
  story: Story;
  chapter?: Chapter;
  currentDraft: string;
  provider: DirectProvider;
  model?: string;
  apiKeys: Record<string, unknown>;
  voiceSheet?: AuthorVoiceSheet;
  authorSample?: string;
  depth: "fast" | "balanced" | "maximum";
}

function asKeys(input: Record<string, unknown>): any {
  return {
    gemini: typeof input.gemini === "string" ? input.gemini : "",
    groq: typeof input.groq === "string" ? input.groq : "",
    nvidia: typeof input.nvidia === "string" ? input.nvidia : "",
    openrouter: typeof input.openrouter === "string" ? input.openrouter : "",
  };
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value.replace(/^```json\s*|```$/g, "").trim()) as T;
  } catch {
    return fallback;
  }
}

function priorChapter(story: Story, chapter?: Chapter): Chapter | undefined {
  if (!chapter) return undefined;
  const index = story.chapters.findIndex((candidate) => candidate.id === chapter.id);
  return index > 0 ? story.chapters[index - 1] : undefined;
}

function bookContext(input: LocalAgentInput): string {
  const previous = priorChapter(input.story, input.chapter);
  const rules = input.story.worldBible || input.story.worldRules.map((rule) => `[${rule.title}] ${rule.content}`).join("\n");
  return [
    `Книга: ${input.story.title}`,
    `Жанр: ${input.story.genre}`,
    input.story.description && `Замысел: ${input.story.description}`,
    input.chapter && `Глава: ${input.chapter.title}`,
    input.chapter?.summary && `Синопсис главы: ${input.chapter.summary}`,
    previous?.content && `Финал предыдущей главы:\n${previous.content.slice(-6000)}`,
    rules && `Канон и лор:\n${rules.slice(0, 8000)}`,
    input.story.bookPlan && `План книги:\n${input.story.bookPlan.slice(0, 6000)}`,
    input.voiceSheet && `Паспорт голоса: ${input.voiceSheet.summary}\nПравила: ${input.voiceSheet.voiceRules.join("; ")}`,
    input.authorSample && `Образец автора:\n${input.authorSample.slice(0, 6000)}`,
  ].filter(Boolean).join("\n\n");
}

export async function runLocalChapterAgent(input: LocalAgentInput, emit: (event: LocalAgentEvent) => void, signal?: AbortSignal): Promise<LocalAgentResult> {
  if (!input.currentDraft.trim()) throw new Error("Агенту нужна непустая глава для подготовки к следующему шагу.");
  const started = Date.now();
  const keys = asKeys(input.apiKeys);
  const context = bookContext(input);
  const passes = input.depth === "fast" ? 1 : input.depth === "balanced" ? 2 : 3;

  const generate = (prompt: string, system: string, json = false) => directGenerate({
    provider: input.provider,
    model: input.model,
    apiKeys: keys,
    prompt,
    system,
    json,
    temperature: input.depth === "maximum" ? 0.7 : 0.55,
    signal,
  });

  emit({ state: "planning", message: "Определяю редакторскую цель и границы правки." });
  emit({ state: "context", message: "Собираю синопсис, канон, план и голос автора." });

  emit({ state: "evaluating", message: "Проверяю главу на ясность, канон, сцену и голос." });
  const reviewRaw = await generate(
    `${context}\n\nТЕКСТ ГЛАВЫ:\n${input.currentDraft}\n\nПроведи редакторскую диагностику. Верни только JSON: {"craftScore":0,"issues":[""],"strengths":[""],"nextStep":""}. Не переписывай текст на этом шаге.`,
    "Ты ведущий редактор художественной прозы. Ищешь только значимые, конкретные проблемы.",
    true,
  );
  const review = parseJson<LocalAgentReview>(reviewRaw, {
    craftScore: 70,
    issues: ["Диагностика пришла в свободном формате; проверьте редакторское письмо ниже."],
    strengths: [],
    nextStep: "Просмотреть подготовленную версию и принять изменения вручную.",
  });

  emit({ state: "correcting", message: "Готовлю бережную редакторскую версию без изменения канона." });
  let revised = input.currentDraft;
  for (let pass = 0; pass < passes; pass += 1) {
    revised = await generate(
      `${context}\n\nДИАГНОСТИКА:\n${JSON.stringify(review)}\n\nТЕКСТ ДЛЯ БЕРЕЖНОЙ ПРАВКИ:\n${revised}\n\nВыполни проход ${pass + 1}/${passes}. Исправь только диагностированные проблемы. Не меняй события, имена, факты и точку зрения. Сохрани голос автора. Верни только готовый текст главы.`,
      "Ты бережный литературный редактор. Автор всегда принимает правки вручную.",
    );
  }

  emit({ state: "auditing", message: "Провожу финальную проверку и формирую редакторское письмо." });
  const finalRaw = await generate(
    `${context}\n\nИСХОДНИК:\n${input.currentDraft}\n\nПОДГОТОВЛЕННАЯ ВЕРСИЯ:\n${revised}\n\nВерни только JSON: {"craftScore":0,"issues":[""],"strengths":[""],"nextStep":""}. Оцени только готовность версии; не предлагай новые самостоятельные главы.`,
    "Ты строгий, но конструктивный выпускающий редактор.",
    true,
  );
  const finalReview = parseJson<LocalAgentReview>(finalRaw, review);
  emit({ state: "completed", message: "Глава подготовлена. Автор может просмотреть и применить версию вручную." });

  return {
    text: revised,
    review: finalReview,
    wordCount: revised.trim().split(/\s+/).filter(Boolean).length,
    duration: `${Math.max(1, Math.round((Date.now() - started) / 1000))} с`,
  };
}
