// server/agent/codex.ts
// Модуль для работы с Кодексом (базой знаний мира)
// В будущем здесь будет векторный поиск, пока реализован строгий поиск по ключевым словам.

export interface CodexEntry {
  id: string;
  type: 'character' | 'location' | 'lore';
  name: string;
  description: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Ищет релевантные записи в Кодексе на основе текущего текста.
 * Извлекает все записи, имена или теги которых упоминаются в тексте.
 */
export function queryCodex(entries: CodexEntry[], contextText: string): CodexEntry[] {
  const normalizedContext = contextText.toLowerCase();
  
  return entries.filter(entry => {
    // Ищем по имени
    if (normalizedContext.includes(entry.name.toLowerCase())) {
      return true;
    }
    
    // Ищем по тегам
    for (const tag of entry.tags) {
      if (normalizedContext.includes(tag.toLowerCase())) {
        return true;
      }
    }
    
    return false;
  });
}

/**
 * Формирует блок инструкций для LLM на основе найденных записей Кодекса
 */
export function buildCodexInstructionBlock(relevantEntries: CodexEntry[]): string {
  if (!relevantEntries || relevantEntries.length === 0) {
    return "";
  }

  const lines: string[] = [];
  lines.push("=== ДАННЫЕ ИЗ КОДЕКСА ПРОЕКТА (STORY BIBLE) ===");
  lines.push("СТРОГО соблюдай эти факты при написании сцены. Не противоречь им.");
  
  const characters = relevantEntries.filter(e => e.type === 'character');
  const locations = relevantEntries.filter(e => e.type === 'location');
  const lore = relevantEntries.filter(e => e.type === 'lore');

  if (characters.length > 0) {
    lines.push("\n[ПЕРСОНАЖИ]:");
    characters.forEach(c => lines.push(`- ${c.name}: ${c.description}`));
  }

  if (locations.length > 0) {
    lines.push("\n[ЛОКАЦИИ]:");
    locations.forEach(l => lines.push(`- ${l.name}: ${l.description}`));
  }

  if (lore.length > 0) {
    lines.push("\n[ЛОР И ПРАВИЛА]:");
    lore.forEach(l => lines.push(`- ${l.name}: ${l.description}`));
  }

  lines.push("\n");
  return lines.join("\n");
}
