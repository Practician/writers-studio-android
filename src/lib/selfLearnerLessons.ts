// src/lib/selfLearnerLessons.ts
// Браузерно-безопасный модуль детерминированного извлечения уроков из правок автора.

export interface CategorizedEditChange {
  type: 'deletion' | 'addition' | 'rephrasing' | 'restructuring';
  original: string;
  edited: string;
  inferredReason?: string;
}

export interface AuthorEditDiff {
  originalText: string;
  editedText: string;
  editDistance: number;
  categorizedChanges: CategorizedEditChange[];
}

function levenshteinDist(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

export function normalizedLevenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return 1;
  if (!b.length) return 1;

  if (a.length > 2000 || b.length > 2000) {
    const maxLen = Math.max(a.length, b.length);
    const minLen = Math.min(a.length, b.length);
    if (maxLen - minLen > maxLen * 0.5) return 1;

    const windowSize = 500;
    let diffCount = 0;
    for (let i = 0; i < minLen; i += windowSize) {
      const subA = a.substring(i, i + windowSize);
      const subB = b.substring(i, i + windowSize);
      diffCount += levenshteinDist(subA, subB);
    }
    const estimatedDist = diffCount + (maxLen - minLen);
    return Math.min(1, estimatedDist / maxLen);
  }

  const dist = levenshteinDist(a, b);
  return dist / Math.max(a.length, b.length);
}

export function computeEditDiff(agentDraft: string, authorFinal: string): AuthorEditDiff {
  const draftParas = agentDraft.split(/\n+/).map(p => p.trim()).filter(Boolean);
  const finalParas = authorFinal.split(/\n+/).map(p => p.trim()).filter(Boolean);

  const categorizedChanges: CategorizedEditChange[] = [];

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
      draftIdx++;
      finalIdx++;
    } else if (dist < 0.4) {
      categorizedChanges.push({ type: 'rephrasing', original: draftP, edited: finalP });
      draftIdx++;
      finalIdx++;
    } else {
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

const learnedLessonsStore = new Map<string, string[]>();

/**
 * Детерминированно извлекает правила из правок автора без вызова LLM (быстрый контур).
 */
export function extractDeterministicLessons(diff: AuthorEditDiff): string[] {
  const lessons: string[] = [];
  const rephrasings = diff.categorizedChanges.filter(c => c.type === 'rephrasing' && c.original && c.edited);
  for (const change of rephrasings.slice(0, 6)) {
    const origShort = change.original.slice(0, 90).replace(/\s+/g, ' ').trim();
    const editShort = change.edited.slice(0, 90).replace(/\s+/g, ' ').trim();
    if (origShort && editShort && origShort !== editShort) {
      lessons.push(`Вместо «${origShort}» автор предпочитает «${editShort}»`);
    }
  }
  const deletions = diff.categorizedChanges.filter(c => c.type === 'deletion' && c.original);
  if (deletions.length >= 2) {
    lessons.push(`Автор удалил ${deletions.length} лишних абзаца(ев) — пиши плотнее, без раздувания описаний.`);
  }
  return lessons;
}

/**
 * Записывает уроки правок автора в оперативное хранилище истории.
 */
export function recordAuthorEditLesson(storyId: string, agentDraft: string, authorFinal: string): string[] {
  const key = (storyId || "default").trim() || "default";
  const diff = computeEditDiff(agentDraft, authorFinal);
  const fresh = extractDeterministicLessons(diff);
  if (!fresh.length) return learnedLessonsStore.get(key) || [];
  const existing = learnedLessonsStore.get(key) || [];
  const merged = [...new Set([...existing, ...fresh])].slice(-12);
  learnedLessonsStore.set(key, merged);
  return merged;
}

/**
 * Возвращает блок выученных уроков правок автора для системного промпта.
 */
export function learnedRulesPromptBlock(storyId = "default"): string {
  const key = (storyId || "default").trim() || "default";
  const lessons = learnedLessonsStore.get(key) || [];
  if (!lessons.length) return "";
  return [
    "УРОКИ ИЗ ПРЕДЫДУЩИХ ПРАВОК АВТОРА (строго учитывай при генерации):",
    ...lessons.map(l => `- ${l}`),
  ].join("\n");
}
