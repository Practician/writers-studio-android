/**
 * INTEGRATION.md
 * 
 * Инструкция по интеграции модулей очеловечивания v2 в Writers Studio
 * =====================================================================
 * 
 * Все файлы расположены в: WritersStudio/improvements/
 * 
 * Структура:
 *   improvements/
 *   ├── server/
 *   │   ├── humanStyleEnhanced.ts      (Группы A, B, C, E, F)
 *   │   └── agent/
 *   │       └── voicePassportV2.ts     (Группа D)
 *   └── src/lib/
 *       └── adaptiveDetectorEnhanced.ts (Группа B, E)
 */

# Инструкция по интеграции улучшений v2

## Быстрый старт

### Шаг 1. Скопируй файлы в исходники

```bash
cp improvements/server/humanStyleEnhanced.ts        server/humanStyleEnhanced.ts
cp improvements/server/agent/voicePassportV2.ts     server/agent/voicePassportV2.ts
cp improvements/src/lib/adaptiveDetectorEnhanced.ts src/lib/adaptiveDetectorEnhanced.ts
```

### Шаг 2. Обнови `server/humanStyle.ts` — добавь импорт расширенного каталога

```typescript
// Добавь в конец server/humanStyle.ts:
import { AI_TELL_CATALOG_EXTENDED } from "./humanStyleEnhanced";

// Объедини каталоги:
export const AI_TELL_CATALOG_FULL = [...AI_TELL_CATALOG, ...AI_TELL_CATALOG_EXTENDED];

// Используй в aiTellScore():
export function aiTellScoreV2(text: string, genre?: string): number {
  const { aiTellScoreEnhanced } = require("./humanStyleEnhanced");
  return aiTellScoreEnhanced(text, AI_TELL_CATALOG_FULL, genre ?? "general");
}
```

### Шаг 3. Подключи 3-фазный pipeline в `server/chapterGenerate.ts`

```typescript
import {
  buildRhythmBreakerPrompt,
  buildLexicalDiversifierPrompt,
  buildMicroImperfectionsPrompt,
  runMultiDetectorGate,
  buildNegativeVoiceProfile,
  negativeVoiceGuidanceBlock,
  AI_TELL_CATALOG_EXTENDED,
  HUMANIZER_V2,
} from "./humanStyleEnhanced";
import { AI_TELL_CATALOG } from "./humanStyle";

const ALL_PATTERNS = [...AI_TELL_CATALOG, ...AI_TELL_CATALOG_EXTENDED];

/**
 * 3-фазный pipeline очеловечивания — вызывается ВМЕСТО или ПОСЛЕ humanizeProseDraft()
 */
export async function humanizePipelineV2(
  text: string,
  authorSample: string,
  voiceGuidance: string,
  negativeProfile: string[],
  aiTellHits: string[],
  generateFn: (prompt: string, model: string) => Promise<string>,
  genre: string = "general",
  config = DEFAULT_HUMANIZER_CONFIG,
): Promise<{ text: string; gateResult: GateResult; iterations: number }> {
  let current = text;
  let iterations = 0;

  for (let i = 0; i < config.maxGateIterations; i++) {
    iterations++;

    // Фаза 1: Rhythm Breaker
    const p1 = buildRhythmBreakerPrompt(current, voiceGuidance);
    current = await generateFn(p1, config.phase1Model);

    // Фаза 2: Lexical Diversifier
    const p2 = buildLexicalDiversifierPrompt(current, authorSample, negativeProfile, aiTellHits);
    current = await generateFn(p2, config.phase2Model);

    // Фаза 3: Micro-imperfections
    const p3 = buildMicroImperfectionsPrompt(current, voiceGuidance);
    current = await generateFn(p3, config.phase3Model);

    // Gate check
    const gate = runMultiDetectorGate(current, ALL_PATTERNS, genre as any);
    if (gate.verdict === "PASS") {
      return { text: current, gateResult: gate, iterations };
    }
    if (gate.verdict === "REVIEW" && i === config.maxGateIterations - 1) {
      return { text: current, gateResult: gate, iterations }; // лучшее что есть
    }
    // FAIL → следующая итерация
  }

  const finalGate = runMultiDetectorGate(current, ALL_PATTERNS, genre as any);
  return { text: current, gateResult: finalGate, iterations };
}
```

### Шаг 4. Подключи Voice Passport V2 в `/api/writer/author` (profile action)

```typescript
// В server.ts, блок обработки action="profile":
import { buildVoicePassportV2, voicePassportV2Block, VOICE_PASSPORT_V2 } from "./agent/voicePassportV2";

// При генерации профиля автора:
const passportV2 = buildVoicePassportV2(storyId, req.body.sample);
const passportBlock = voicePassportV2Block(passportV2);

// Добавь passportBlock к systemInstruction при перезаписи:
systemInstruction = `${existingInstruction}\n\n${passportBlock}`;
```

### Шаг 5. Подключи расширенный детектор в `src/lib/adaptiveDetector.ts`

```typescript
// Добавь в конец src/lib/adaptiveDetector.ts:
import {
  DETECTOR_V2,
  ExtendedCentroid,
  addExtendedObservation,
  mahalanobisDistance,
  aggregateImplicitFeedback,
  mergeWithDonorProfile,
  computeEnsembleScore,
} from "./adaptiveDetectorEnhanced";

// Используй mergeWithDonorProfile() при генерации новых глав:
// если у главы N < 5 HUMAN-сегментов — мержим с профилем главы N-1
```

---

## Что изменилось — краткий обзор

| Модуль | Изменение | Файл |
|--------|-----------|------|
| AI Tell Catalog | +50 паттернов: temporal fillers, emotion-naming, body-tells, transition clichés, LLM hedging, English leaks | `humanStyleEnhanced.ts` |
| Веса паттернов | Жанровые мультипликаторы × позиционная коррекция × плотностная деградация | `humanStyleEnhanced.ts` |
| Humanizer pipeline | 3 фазы: Rhythm Breaker → Lexical Diversifier → Micro-imperfections + gate | `humanStyleEnhanced.ts` |
| Negative Voice Profile | Биграммы и слова, эксклюзивные для AI-сегментов конкретного автора | `humanStyleEnhanced.ts` |
| Multi-detector gate | PASS/REVIEW/FAIL по 5 метрикам: aiTell + paragraphCV + passive + TTR + connector | `humanStyleEnhanced.ts` |
| Adaptive Detector | 12 признаков (8→12), Mahalanobis distance, implicit feedback, cross-chapter transfer | `adaptiveDetectorEnhanced.ts` |
| Voice Passport | Fingerprint слов (TF-IDF), пунктуация, диалоги, ритм абзацев, синтаксис | `voicePassportV2.ts` |

---

## Верификация

После интеграции запусти существующие тесты:

```bash
npx vitest run tests/humanStyle.test.ts
npx vitest run tests/adaptiveDetector.test.ts
npx vitest run tests/authorPipeline.test.ts
```

Добавь unit-тесты для новых модулей:

```bash
npx vitest run tests/humanStyleEnhanced.test.ts      # создать
npx vitest run tests/adaptiveDetectorEnhanced.test.ts # создать
npx vitest run tests/voicePassportV2.test.ts          # создать
```
