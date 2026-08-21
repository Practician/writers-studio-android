// server/agent/tools.ts
// Декларации инструментов, доступных агенту-оркестратору.
// Каждый инструмент — обёртка над существующей функциональностью.

import type { GenerateFn, ChapterBeat } from "../chapterGenerate";
import { buildBeatPlanPrompt, buildScenePrompt, runTouchupPipeline, beatPlanSchema, countWordsRu } from "../chapterGenerate";
import { aiTellScore, sentenceBurstiness, humanizeGatePassed, resolveHumanizeDepth, type HumanizeDepthConfig } from "../humanStyle";
import { buildAuditPrompt, auditSchema, parseJsonResponse } from "../authorPipeline";

export interface ToolContext {
    generate: GenerateFn;
    model: string;
    storyId: string;
    emit: (event: AgentEvent) => void;
}

export interface ToolResult {
    success: boolean;
    data?: unknown;
    summary: string;
    error?: string;
}

export type AgentEvent = 
    | { type: 'state_change', from: string, to: string }
    | { type: 'reasoning', thought: string }
    | { type: 'tool_call', tool: string, args: Record<string, unknown> }
    | { type: 'tool_result', tool: string, summary: string }
    | { type: 'draft_preview', text: string, wordCount: number }
    | { type: 'evaluation', craftScore: number, burstiness: number, issues: string[] }
    | { type: 'correction', pass: number, improved: string[] }
    | { type: 'completed', result: unknown }
    | { type: 'error', message: string, recoverable: boolean };

export interface AgentTool {
    name: string;
    description: string;
    parameters: Record<string, { type: string; description: string; required?: boolean }>;
    handler: (args: Record<string, unknown>, context: ToolContext) => Promise<ToolResult>;
}

const generateBeatPlanTool: AgentTool = {
    name: 'generateBeatPlan',
    description: 'Генерация плана сцен (битов) для новой главы на основе синопсиса.',
    parameters: {
        synopsis: { type: 'string', description: 'Синопсис главы', required: true },
        previousChapterTail: { type: 'string', description: 'Конец предыдущей главы', required: false }
    },
    handler: async (args, context) => {
        try {
            const synopsis = args.synopsis as string;
            const previousChapterTail = args.previousChapterTail as string | undefined;
            const contents = `Synopsis: ${synopsis}\nPrevious Chapter Tail: ${previousChapterTail || ''}\nGenerate a beat plan for this chapter.`;
            const resultText = await context.generate({ 
                contents, 
                model: context.model,
                systemInstruction: "You are an expert story planner. Generate a beat plan from the synopsis.",
                temperature: 0.35,
                responseMimeType: "application/json",
                responseSchema: beatPlanSchema
            });
            const beats = parseJsonResponse(resultText, 'generateBeatPlanTool') as ChapterBeat[];
            return {
                success: true,
                data: beats,
                summary: `Сгенерирован план из ${beats.length} битов.`
            };
        } catch (e: any) {
            return { success: false, summary: 'Ошибка генерации плана битов.', error: e.message };
        }
    }
};

const draftSceneTool: AgentTool = {
    name: 'draftScene',
    description: 'Написание одной сцены по биту.',
    parameters: {
        beat: { type: 'object', description: 'Данные бита', required: true },
        previousTail: { type: 'string', description: 'Конец предыдущей сцены', required: false },
        styleInstruction: { type: 'string', description: 'Инструкции по стилю', required: true },
        sceneIndex: { type: 'number', description: 'Индекс сцены', required: true },
        totalScenes: { type: 'number', description: 'Всего сцен', required: true }
    },
    handler: async (args, context) => {
        try {
            const beat = args.beat as ChapterBeat;
            const previousTail = args.previousTail as string | undefined;
            const styleInstruction = args.styleInstruction as string;
            const sceneIndex = args.sceneIndex as number;
            const totalScenes = args.totalScenes as number;
            
            const contents = `Write a scene for the following beat.\nBeat: ${JSON.stringify(beat)}\nPrevious Tail: ${previousTail || ''}\nStyle: ${styleInstruction}\nScene ${sceneIndex} of ${totalScenes}`;
            const text = await context.generate({ 
                contents, 
                model: context.model,
                systemInstruction: "You are an expert fiction author. Write a detailed, engaging scene following the style instructions.",
                temperature: 0.7
            });
            const wordCount = countWordsRu(text);
            
            return {
                success: true,
                data: { text, wordCount },
                summary: `Написана сцена (слов: ${wordCount}).`
            };
        } catch (e: any) {
            return { success: false, summary: 'Ошибка написания сцены.', error: e.message };
        }
    }
};

const evaluateCraftTool: AgentTool = {
    name: 'evaluateCraft',
    description: 'Оценка текста на стиль (AiTell) и ритм (Burstiness).',
    parameters: {
        text: { type: 'string', description: 'Текст для оценки', required: true }
    },
    handler: async (args, context) => {
        try {
            const text = args.text as string;
            const scoreResult = aiTellScore(text);
            const burstiness = sentenceBurstiness(text);
            // using default gate values
            const passed = humanizeGatePassed(scoreResult, 60, 3.0);
            
            return {
                success: true,
                data: { score: scoreResult.score, burstiness, hits: scoreResult.hits, passed },
                summary: `Оценка: score=${scoreResult.score.toFixed(1)}, burstiness=${burstiness.toFixed(1)}, passed=${passed}.`
            };
        } catch (e: any) {
            return { success: false, summary: 'Ошибка оценки текста.', error: e.message };
        }
    }
};

const rewriteWeakBlocksTool: AgentTool = {
    name: 'rewriteWeakBlocks',
    description: 'Улучшение слабых участков текста (очистка от AI-штампов).',
    parameters: {
        text: { type: 'string', description: 'Исходный текст', required: true },
        styleInstruction: { type: 'string', description: 'Инструкция по стилю', required: true }
    },
    handler: async (args, context) => {
        try {
            const text = args.text as string;
            const styleInstruction = args.styleInstruction as string;
            
            const improvedText = await runTouchupPipeline(
                text,
                context.generate,
                { model: context.model, personaBlock: styleInstruction, depth: 'medium' as any }
            );
            
            return {
                success: true,
                data: { improvedText },
                summary: `Текст успешно улучшен.`
            };
        } catch (e: any) {
            return { success: false, summary: 'Ошибка при улучшении текста.', error: e.message };
        }
    }
};

const auditFactsTool: AgentTool = {
    name: 'auditFacts',
    description: 'Проверка фактов и консистентности текста (оригинал vs улучшенный).',
    parameters: {
        originalText: { type: 'string', description: 'Исходный текст', required: true },
        improvedText: { type: 'string', description: 'Улучшенный текст', required: true }
    },
    handler: async (args, context) => {
        try {
            const originalText = args.originalText as string;
            const improvedText = args.improvedText as string;
            const contents = `Original text:\n${originalText}\n\nImproved text:\n${improvedText}\n\nCheck for facts and continuity.`;
            const responseText = await context.generate({ 
                contents, 
                model: context.model,
                systemInstruction: "You are an editor checking continuity between original and rewritten text.",
                temperature: 0.1,
                responseMimeType: "application/json",
                responseSchema: auditSchema
            });
            const auditResult = parseJsonResponse(responseText, 'auditFactsTool');
            
            return {
                success: true,
                data: auditResult,
                summary: 'Аудит фактов завершён.'
            };
        } catch (e: any) {
            return { success: false, summary: 'Ошибка при аудите фактов.', error: e.message };
        }
    }
};

const queryLoreTool: AgentTool = {
    name: 'queryLore',
    description: 'Поиск информации в лоре/Библии мира.',
    parameters: {
        query: { type: 'string', description: 'Поисковый запрос', required: true },
        worldBible: { type: 'string', description: 'Лор мира', required: true },
        bookPlan: { type: 'string', description: 'План книги', required: false }
    },
    handler: async (args, context) => {
        try {
            const query = args.query as string;
            const worldBible = args.worldBible as string;
            
            if (!worldBible.trim()) {
                return {
                    success: true,
                    data: { excerpts: "" },
                    summary: "Лор мира пуст."
                };
            }

            const queryLower = query.toLowerCase().trim();
            const lines = worldBible.split('\n');
            const matches = lines.filter(line => line.trim() && line.toLowerCase().includes(queryLower));
            
            if (matches.length > 0) {
                return {
                    success: true,
                    data: { excerpts: matches.join('\n') },
                    summary: `Найдено ${matches.length} совпадений по лору.`
                };
            }

            // Умный поиск через LLM, если точных совпадений подстроки нет (например, передан длинный синопсис)
            const systemInstruction = "You are a research assistant. Extract only the facts and details from the World Lore that are directly relevant to the query/summary. Do not invent anything.";
            const contents = `Запрос/Описание: "${query}"\n\nЛор мира:\n${worldBible}\n\nВыпиши из Лора мира все абзацы, факты или правила, которые относятся к запросу. Не выдумывай ничего от себя. Если ничего релевантного нет, ответь "Нет совпадений".`;
            
            const response = await context.generate({
                contents,
                model: context.model,
                systemInstruction,
                temperature: 0.1
            });

            const text = response.trim();
            if (text === "" || /нет совпадений|no matches/i.test(text)) {
                return {
                    success: true,
                    data: { excerpts: "" },
                    summary: "Найдено 0 совпадений по лору."
                };
            }

            return {
                success: true,
                data: { excerpts: text },
                summary: "Найдена релевантная информация в лоре."
            };
        } catch (e: any) {
            return { success: false, summary: 'Ошибка поиска в лоре.', error: e.message };
        }
    }
};

const extractContinuityTool: AgentTool = {
    name: 'extractContinuity',
    description: 'Извлечение фактов, чисел и состояний из текста главы.',
    parameters: {
        text: { type: 'string', description: 'Текст главы', required: true }
    },
    handler: async (args, context) => {
        try {
            const text = args.text as string;
            const contents = `Извлеки ключевые факты, числа и состояния персонажей из текста:\n\n${text}\n\nВыведи в формате JSON: { "facts": [], "numbers": [], "states": [] }`;
            const response = await context.generate({ 
                contents, 
                model: context.model,
                systemInstruction: "You are an expert continuity editor.",
                temperature: 0.1,
                responseMimeType: "application/json"
            });
            const result = parseJsonResponse(response, 'extractContinuityTool');
            
            return {
                success: true,
                data: result,
                summary: 'Состояние continuity извлечено.'
            };
        } catch (e: any) {
            return { success: false, summary: 'Ошибка извлечения continuity.', error: e.message };
        }
    }
};

const logReasoningTool: AgentTool = {
    name: 'logReasoning',
    description: 'Логирование рассуждений агента.',
    parameters: {
        thought: { type: 'string', description: 'Мысль или рассуждение', required: true }
    },
    handler: async (args, context) => {
        try {
            const thought = args.thought as string;
            context.emit({ type: 'reasoning', thought });
            return {
                success: true,
                summary: 'Рассуждение записано.'
            };
        } catch (e: any) {
            return { success: false, summary: 'Ошибка логирования.', error: e.message };
        }
    }
};

export const AGENT_TOOLS: AgentTool[] = [
    generateBeatPlanTool,
    draftSceneTool,
    evaluateCraftTool,
    rewriteWeakBlocksTool,
    auditFactsTool,
    queryLoreTool,
    extractContinuityTool,
    logReasoningTool
];

export async function executeTool(toolName: string, args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const tool = AGENT_TOOLS.find(t => t.name === toolName);
    if (!tool) {
        return {
            success: false,
            summary: `Инструмент ${toolName} не найден.`,
            error: `Tool ${toolName} not found`
        };
    }
    
    context.emit({ type: 'tool_call', tool: toolName, args });
    
    try {
        const result = await tool.handler(args, context);
        context.emit({ type: 'tool_result', tool: toolName, summary: result.summary });
        return result;
    } catch (e: any) {
        const errorResult: ToolResult = {
            success: false,
            summary: `Сбой при выполнении ${toolName}.`,
            error: e.message || String(e)
        };
        context.emit({ type: 'tool_result', tool: toolName, summary: errorResult.summary });
        return errorResult;
    }
}
