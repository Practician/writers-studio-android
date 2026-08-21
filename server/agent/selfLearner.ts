// server/agent/selfLearner.ts
// Модуль самообучения агента на основе авторских правок.
// Анализирует diff между черновиком агента и финальной версией автора.
// Извлекает паттерны правок и обновляет DeepStyleProfile.

import { Type } from "@google/genai";
import { llmGenerate, llmTextOrThrow } from "../llmProvider.js";
import { parseJsonResponse } from "../authorPipeline.js";
import { EpisodeRecord, AuthorEditDiff, normalizedLevenshtein } from "./memory.js";
import { DeepStyleProfile, StyleExemplar } from "./styleProfiler.js";

export interface EditPattern {
    type: 'deletion' | 'addition' | 'rephrasing' | 'restructuring';
    original: string;
    edited: string;
    inferredReason: string;
    frequency: number;
    confidence: number;
}

export interface LearningResult {
    updatedProfile: DeepStyleProfile;
    lessons: string[];
    patternsFound: EditPattern[];
    confidence: number;
    editDistance: number;
}

export function computeEditDiff(agentDraft: string, authorFinal: string): AuthorEditDiff {
    const draftParas = agentDraft.split(/\n+/).map(p => p.trim()).filter(Boolean);
    const finalParas = authorFinal.split(/\n+/).map(p => p.trim()).filter(Boolean);
    
    const categorizedChanges: AuthorEditDiff['categorizedChanges'] = [];
    
    // Простой алгоритм сопоставления абзацев
    let draftIdx = 0;
    let finalIdx = 0;
    
    while (draftIdx < draftParas.length || finalIdx < finalParas.length) {
        const draftP = draftParas[draftIdx];
        const finalP = finalParas[finalIdx];
        
        if (!draftP) {
            categorizedChanges.push({ type: 'addition', original: '', edited: finalP });
            finalIdx++;
            continue;
        }
        if (!finalP) {
            categorizedChanges.push({ type: 'deletion', original: draftP, edited: '' });
            draftIdx++;
            continue;
        }
        
        const dist = normalizedLevenshtein(draftP, finalP);
        
        if (dist === 0) {
            // Без изменений
            draftIdx++;
            finalIdx++;
        } else if (dist < 0.4) {
            // Рефрейминг / переписывание
            categorizedChanges.push({ type: 'rephrasing', original: draftP, edited: finalP });
            draftIdx++;
            finalIdx++;
        } else {
            // Поиск возможных перестановок (restructuring) в окне
            let foundMatch = false;
            for (let i = 1; i <= 3; i++) {
                if (finalIdx + i < finalParas.length && normalizedLevenshtein(draftP, finalParas[finalIdx + i]) < 0.4) {
                    categorizedChanges.push({ type: 'restructuring', original: draftP, edited: finalParas[finalIdx + i] });
                    draftIdx++;
                    finalIdx += i + 1;
                    foundMatch = true;
                    break;
                }
            }
            if (!foundMatch) {
                categorizedChanges.push({ type: 'deletion', original: draftP, edited: '' });
                draftIdx++;
            }
        }
    }
    
    return {
        originalText: agentDraft,
        editedText: authorFinal,
        editDistance: normalizedLevenshtein(agentDraft, authorFinal),
        categorizedChanges
    };
}

/**
 * Категоризирует правки с помощью LLM для извлечения паттернов.
 */
export async function categorizeEdits(diff: AuthorEditDiff, model: string): Promise<EditPattern[]> {
    if (diff.categorizedChanges.length === 0) return [];

    const prompt = `Проанализируй правки автора. Какие систематические паттерны ты видишь?
Ответь в формате JSON.
Правки:
${JSON.stringify(diff.categorizedChanges, null, 2)}`;

    const schema = {
        type: Type.ARRAY,
        items: {
            type: Type.OBJECT,
            properties: {
                type: { type: Type.STRING, enum: ['deletion', 'addition', 'rephrasing', 'restructuring'] },
                original: { type: Type.STRING },
                edited: { type: Type.STRING },
                inferredReason: { type: Type.STRING },
                frequency: { type: Type.INTEGER },
                confidence: { type: Type.NUMBER }
            },
            required: ['type', 'original', 'edited', 'inferredReason', 'frequency', 'confidence']
        }
    };

    const response = await llmGenerate({
        model,
        contents: prompt,
        responseSchema: schema
    });
    
    try {
        const parsed = parseJsonResponse<EditPattern[]>(llmTextOrThrow(response, 'categorizeEdits'), 'categorizeEdits');
        return parsed || [];
    } catch (e) {
        console.error("Ошибка парсинга паттернов", e);
        return [];
    }
}

/**
 * Обновляет примеры стиля на основе уверенных правок.
 */
export function updateExemplars(profile: DeepStyleProfile, patterns: EditPattern[]): DeepStyleProfile {
    const newProfile = { ...profile };
    newProfile.exemplars = [...(profile.exemplars || [])];

    for (const pattern of patterns) {
        if (pattern.type === 'rephrasing' && pattern.confidence >= 0.7) {
            const newExemplar: StyleExemplar = {
                category: 'description',
                text: pattern.edited,
                annotation: `Избегать: "${pattern.original}". Причина: ${pattern.inferredReason}`
            };
            newProfile.exemplars.push(newExemplar);
        }
    }

    // Ограничиваем количество примеров до 20
    if (newProfile.exemplars.length > 20) {
        newProfile.exemplars = newProfile.exemplars.slice(-20);
    }

    return newProfile;
}

/**
 * Основной процесс обучения на основе правок.
 */
export async function learnFromEdits(
    agentDraft: string, 
    authorFinal: string, 
    currentProfile: DeepStyleProfile, 
    model: string
): Promise<LearningResult> {
    const diff = computeEditDiff(agentDraft, authorFinal);
    const patterns = await categorizeEdits(diff, model);
    
    // Извлекаем уроки
    const lessons = patterns
        .filter(p => p.frequency >= 2 || p.confidence >= 0.7)
        .map(p => p.inferredReason);
    
    let updatedProfile = updateExemplars(currentProfile, patterns);
    
    // Корректировка количественных метрик, если нужно (упрощенная эвристика)
    let lengthRatio = 1;
    if (agentDraft.length > 0) {
        lengthRatio = authorFinal.length / agentDraft.length;
    }
    
    if (lengthRatio < 0.9 && updatedProfile.metrics) {
        // Автор регулярно сокращает текст
        updatedProfile.metrics.avgSentenceLength = Math.max(
            5, 
            (updatedProfile.metrics.avgSentenceLength || 15) * 0.95
        );
    } else if (lengthRatio > 1.1 && updatedProfile.metrics) {
        // Автор расширяет
        updatedProfile.metrics.avgSentenceLength = (updatedProfile.metrics.avgSentenceLength || 15) * 1.05;
    }

    updatedProfile.version = (updatedProfile.version || 1) + 1;
    updatedProfile.updatedAt = new Date().toISOString();

    const editDistance = normalizedLevenshtein(agentDraft, authorFinal);

    return {
        updatedProfile,
        lessons,
        patternsFound: patterns,
        confidence: patterns.length > 0 ? Math.max(...patterns.map(p => p.confidence)) : 0,
        editDistance
    };
}

/**
 * Консолидирует память из множества эпизодов.
 */
export async function consolidateMemory(
    episodes: EpisodeRecord[], 
    profile: DeepStyleProfile, 
    model: string
): Promise<DeepStyleProfile> {
    const episodesWithEdits = episodes.filter(e => e.authorEdits?.originalText && e.authorEdits?.originalText !== e.authorEdits?.editedText);
    if (episodesWithEdits.length === 0) return profile;

    const allDiffChanges: AuthorEditDiff['categorizedChanges'] = [];
    for (const ep of episodesWithEdits) {
        if (ep.authorEdits?.categorizedChanges) {
            allDiffChanges.push(...ep.authorEdits.categorizedChanges);
        }
    }
    
    const combinedDiff: AuthorEditDiff = {
        originalText: '',
        editedText: '',
        editDistance: 0,
        categorizedChanges: allDiffChanges
    };

    const patterns = await categorizeEdits(combinedDiff, model);
    let consolidatedProfile = updateExemplars(profile, patterns);
    
    consolidatedProfile.version = (consolidatedProfile.version || 1) + 1;
    consolidatedProfile.updatedAt = new Date().toISOString();

    return consolidatedProfile;
}
