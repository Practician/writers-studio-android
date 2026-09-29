# SEPIA_HANDOFF — передача работы в новую сессию

Создано 29.09.2026. Это **оперативная** картина: что сделано, что осталось, как продолжить.
Стратегический план — `SEPIA_PLAN.md` (тот же каталог).

---

## 0. Общая цель

Привести конвейер «очеловечивания» к правилам скилла **sepia**
(https://github.com/Nanako0129/sepia, v0.12.2), чтобы LLM при написании книги следовал:
«3–5 приёмов на историю, а не на каждую сцену», «deletion beats addition (74/18/8)»,
«два этапа: список дефектов → правка с глубокого», «по одной группе рубрики за раз»,
«leave slack», «версия модели = точный тег».

Входные материалы разобраны (журнал, JSON-внешнего детектора, патч) — см. `SEPIA_PLAN.md`,
раздел «Диагноз». Ключевой факт: внешний детектор дал **22 сегмента из 22 «AI»** при
локальном счёте 17; причина перекоррекции — каталог приёмов подшивался в каждую сцену.

---

## 1. Факты об окружении (проверены вручную)

| Что | Значение |
|---|---|
| Репозиторий | `/data/data/com.termux/files/home/writers-studio-android`, ветка `main`, HEAD `0286b89` |
| Remote | `https://github.com/Practician/writers-studio-android.git` |
| **Доступ в GitHub** | **ЕСТЬ.** `gh` установлен, аккаунт `Practician`, токен scope `repo` + `workflow`, credential helper `gh auth git-credential`. `git push --dry-run origin HEAD` → exit 0 |
| CI | `.github/workflows/android-apk.yml`: на push в main → `npm ci` → `npm run lint` (tsc) → `npm test` → сборка APK (Java 21, `npx cap sync android`) → Release |
| Node локально | v24.18.0 (в CI — Node 22) |
| Зависимости | `node_modules` установлен (`npm ci` выполнен) |
| Линт | `npm run lint` → **exit 0** (после всех правок) |
| Тесты | `npm test` → **366 тестов, 364 pass, 2 fail** |
| 2 падения | `tests/exportDocx.test.ts` — `TypeError: URL is not a constructor` из tsx-loader. **Pre-existing**: падали ДО всех правок (Node 24 + tsx). В CI на Node 22, скорее всего, зелёные. НЕ чинить в рамках sepia |
| Скрипт калибровки | `npx tsx scripts/sepia-calibrate.ts` |

**Коммитов пока НЕТ — все изменения в рабочем дереве.**

---

## 2. Что сделано (по этапам плана)

### Этап 0 — инфраструктура ✅
- Применён `~/storage/downloads/gemini-keys-fix.patch` (103 строки в `src/lib/directLlmClient.ts`,
  новый `tests/geminiKeyOrder.test.ts`). Даёт `GEMINI_STICKY_MS`, `geminiContentBlocked`,
  `PHASE_MODEL_ROUTING=false`.
- Проверено: патч применяется чисто, линт и тесты зелёные.

### Этап 2 — калибровка приёмов 3–5 на главу ✅ (главный по эффекту)
- **Новый файл `server/sepiaMoves.ts`** — единственный каталог приёмов:
  - `SCENE_MOVE_CATALOG` (8), `ARCHITECTURE_MOVE_CATALOG` (9), `RARITY_MOVE_CATALOG` (4), `SEPIA_MOVE_CATALOG` (21);
  - `buildChapterMovePlan({beatCount, seed, requested})` — 3–5 обычных + 1 rarity,
    разнос по ячейкам главы, `quietScenes` (сцены без приёмов = «leave slack»);
  - детерминированный seed (FNV-1a + mulberry32) — все кандидаты главы сравниваются
    при одних и те же приёмах;
  - `sceneMoveBlock()`, `architectureMovesBlock()`, `movePlanSummary()`, `moveCatalogPrompt()`,
    `requestedMovesFromPlan()`; индекс сцены приводится модулем (`sceneIndexOf`), потому
    что в промпт передаётся `index + candidateIndex`.
- **`server/chapterGenerate.ts`**:
  - `CHAPTER_ARCHITECTURE_MOVES` теперь = `ARCHITECTURE_MOVE_CATALOG.map(m => m.text)` (совместимость со старыми тестами);
  - `SCENE_SEPIA_MOVES` — строка каталога, остался только для маршрутов БЕЗ плана
    (одиночная глава / правка сегментов);
  - `architectureNotes(beatIndex, movePlan?)` — с планом возвращает только назначенные пункты, без плана — прежняя тройка со сдвигом;
  - `buildScenePrompt(..., scenePlan, movePlan?)` — `${sceneMoveBlock(...) || SCENE_SEPIA_MOVES}`;
  - `beatPlanSchema` → добавлено опциональное поле `moves: string[]` (3–5 id из каталога);
  - `buildBeatPlanPrompt` → каталог с id + требование выбрать приёмы под синопсис;
  - `planBeats()` возвращает `{beats, moves}`, `generateHumanizedChapter` прокидывает
    `chapterMoves` в `generateScenesDraft(..., noteStep, moveIds)`;
  - `generateScenesDraft` строит `buildChapterMovePlan` один раз и логирует
    `movePlanSummary` (только на кандидате 0).
- **`tests/sepiaMoves.test.ts`** — 8 тестов, **все зелёные**.

### Этап 1 — рубрика 30 признаков ✅ (код)
- **Новый файл `server/sepiaRubric.ts`**:
  - `RUBRIC_GROUPS` — 5 групп (A 6, B 6, C 8, D 3, E 7 = 30 признаков) с `judge`,
    опорами `human`/`ai`, `fix` (одна строка на русском) и `defect: boolean`
    (C2, D1–D3, E5 — маркеры/advisory, не дефекты);
  - `rubricObservationSchema`, `groupSystemInstruction()` («читаешь ТОЛЬКО эту группу»,
    «нет цитаты — нет признака», запрет вероятностей и общего счёта);
  - `runSepiaRubric(text, generate, {model})` — **5 параллельных вызовов**, `Promise.allSettled`,
    сбой группы → `failedGroups`, а не молчание;
  - типы: `kind = signal | human | n/a | over-correction` (перекоррекция — отдельный вид отказа);
  - `rubricDefectBlock(report)` — блок для промпта правки, сгруппирован
    architecture → discourse → style, перекоррекция вынесена отдельно («НЕ усиливай»);
  - `rubricSummary(report)` — строка для отчёта.

### Этап 3 — слоистость: архитектура первой ✅ (код)
- `server/chapterGenerate.ts`:
  - `SepiaPhaseName` получил `"architecture-repair"` (нет в `sepiaPhasesForRoute` — фазы идут после архитектуры);
  - новый `ARCHITECTURE_PHASE_CHUNK_CHARS = 14_000` и `runArchitectureRepair()` — чинит
    кусками в 2–3 раза длиннее стилистических (архитектура = свойство сцены/главы);
  - в `runEnhancedSepiaPipeline` **до** цикла фаз: `runSepiaRubric` → при наличии
    дефектов `runArchitectureRepair`; `chunks` теперь считаются **после** архитектурного прохода;
  - accept-логика архитектуры: длина 0.7–1.1, `editMixRatios.insert ≤ 0.3`,
    `meaningLossIssues` пусто, `rewriteRegressionIssues` пусто, улучшение
    `architectureScore` **или** `rank`, иначе блок остаётся как есть;
  - `EnhancedPipelineResult.rubric` и `HumanizePipelineReport.rubric`
    (`passes / defects / overCorrections / failedGroups`) — для измеримости;
  - `rubric: enhanced.rubric` добавлен в **3** места построения отчёта (2876, 3176, 3262 после правок).

### Этап 5 — правила в промптах ✅ (частично)
- **`server/editRevert.ts`** — добавлены `editTokens`, `lcsLength` (двухстрочный DP),
  `editMixRatios(original, candidate) → {replace, delete, insert, intensity}` —
  локальный замер 74/18/8.
- **`server/chapterGenerate.ts`**, фазовая приёмка:
  - `mix.insert > 0.25` → отклонение с пояснением («правка дописывает вместо замены»);
  - `growthCap` **1.3 → 1.08** (micro: 1.12 → 1.06), убран лазейку `beforeWords + 120` → `+10`.
- **`server/humanStyleEnhanced.ts`**, `modelFingerprintGuidance`:
  - Gemini: извлечение версии, `operative` только для 3/3.0/3.1, иначе явный **prior**
    («для 3.8 прямых измерений нет») + lite-блок; DeepSeek: измерения на V3.2, для v4 — prior;
  - комментарий: модели без измеренного отпечатка (gpt-oss-120b, GPT, Kimi) получают `""` —
    «recorded as consulted, not guessed».
- **`src/lib/directLlmClient.ts`** — новый `sepiaGuardrailsBlock()` подключён в
  `humanizeDirective()` (4 правила: 3–5 приёмов на весь текст, замена вместо вставки,
  нерегуляризованная прямая речь/цитаты, whitelist на чистую грамматику).

### Этап 4 — метрики гейта 🟡 (метрика написана, в гейт НЕ подключена)
- **`server/humanStyleEnhanced.ts`** — `sentenceLengthSpread(text)` (CV длины предложений,
  ≥6 предложений, иначе 0) — «единственная синтаксическая мера, по которой сходятся
  исследования»; средняя длина и SD sepia отбрасывает как противоречивые.
- **`scripts/sepia-calibrate.ts`** — создан, линт чистый, **НИ РАЗУ НЕ ЗАПУСКАЛСЯ**.

### Этап 6 — документация/eval ⛔ (не начат)

---

## 3. Что осталось (порядок продолжения)

1. **Запустить калибровку**:
   ```bash
   cd /data/data/com.termux/files/home/writers-studio-android
   npx tsx scripts/sepia-calibrate.ts
   ```
   Скрипт читает `~/storage/downloads/result_*.json` (AI) и fb2 из `~/storage/downloads/книги`
   (6 книг × 3 окна по 23k знаков), печатает таблицу и **предлагаемые пороги**
   (`minSentenceSpread`, `minParagraphCV`, `minTTR200` — на 10% ниже человеческого минимума,
   чтобы гейт не ронял живую прозу).
   Возможные правки скрипта: мало fb2 в UTF-8 → увеличить лимит `listFiles`, или
   раскомментировать/дописать разбор windows-1251 (iconv-lite в node_modules есть не факт — проверить).
2. **Подключить метрику в гейт** (`runMultiDetectorGate`):
   - `GateResult` → поле `sentenceSpread: number`;
   - config → `minSentenceSpread?: number` + дефолт из калибровки;
   - `failures.push(\`Разброс длин предложений CV=...\`)`;
   - продублировать порог в вызове гейта из `chapterGenerate.ts` (там задаются
     `maxAiTellScore`, `minParagraphCV`, `maxPassiveShare`, `minTTR200`, `minConnectorDiv`,
     `maxArchitectureScore`);
   - опционально: `sentenceLengthSpread` в `computeExtendedMetrics` + `ExtendedStyleMetrics`.
   ⚠️ **Сначала калибровка**: без неё новый failure может перевернуть вердикты тестов
   (`tests/humanStyleEnhanced.test.ts` ждёт «хороший» текст → PASS/REVIEW).
3. **Тесты на новый код** (пока нет):
   - `tests/sepiaRubric.test.ts` — фейковый `generate`, возвращающий JSON: маппинг id,
     игнор мусора, `kind` нормализация, `failedGroups` при ошибке, порядок слоёв в
     `rubricDefectBlock`, вынесение `over-correction`;
   - `tests/editRevert.test.ts` (дописать) — `editMixRatios`: чистый текст → insert 0;
     дописанный абзац → insert > 0.25; чистая замена → replace ≈ 1; удаление → delete > 0.
4. **Проверить полный прогона** `npm test` (сейчас 364/366, 2 — pre-existing DOCX).
5. **Этап 6 — документация**:
   - `docs/SEPIA.md` — таблица «правило sepia ↔ файл:строка ↔ как измеряется»;
   - зафиксировать калибровочные пороги и команду `npx tsx scripts/sepia-calibrate.ts`.
6. **Коммит и пуш** (доступ подтверждён):
   ```bash
   cd /data/data/com.termux/files/home/writers-studio-android
   git add -A
   git commit -m "feat(sepia): приёмы на главу, рубрика из 30 признаков, архитектура первой, замена вместо вставки"
   git push origin main
   ```
   CI соберёт APK (check → build-apk → Release).

---

## 4. Изменённые / новые файлы (снимок рабочего дерева)

```
 M src/lib/directLlmClient.ts      (патч + sepiaGuardrailsBlock)
 M server/chapterGenerate.ts       (план приёмов, рубрика, архитектура первой, growthCap)
 M server/editRevert.ts            (editMixRatios / lcsLength)
 M server/humanStyleEnhanced.ts    (версии моделей, sentenceLengthSpread)
?? server/sepiaMoves.ts            (новый: каталог и план приёмов)
?? server/sepiaRubric.ts           (новый: 5 групп рубрики)
?? scripts/sepia-calibrate.ts      (новый: калибровка порогов)
?? tests/sepiaMoves.test.ts        (новый: 8 тестов, зелёные)
?? tests/geminiKeyOrder.test.ts    (из патча)
?? SEPIA_PLAN.md                   (стратегический план)
?? SEPIA_HANDOFF.md                (этот файл)
```

---

## 5. Риски и открытые вопросы

- **Стоимость запросов**: рубрика = +5 вызовов, архитектурная правка = +1..4 на главу.
  Журнал 29.09 показывал 69 запросов на главу → станет ~75–78. Стоит подумать о
  кэше рубрики или запуске только на `depth=maximum` (сейчас включена для
  `route === "generate_full_chapter"` при ≥20 предложениях).
- **Порог `growthCap 1.08`** жёсткий: части кандидатов фаз будут отклоняться
  (это задумано — «repair is not growth»), но если на живом прогоне фазы станут
  почти всегда отклоняться, поднять до 1.12 и оставить только проверку `insert ≤ 0.25`.
- `PHASE_CHUNK_CHARS = 7000` и нарезка на **22 сегмента по 146–182 слова** сама по себе
  даёт tell (CV длины сегментов локальный аудит не меряет). Архитектурный слой теперь
  правится кусками 14k, но **нарезка сегментов для внешнего детектора не тронута** —
  это отдельная задача, если 22/22 сохранится.
- Локальный аудит по-прежнему может показывать «17 → 17» при вердикте внешнего
  детектора: в отчёте оставлен `detectorHypothesised: true`. Для честной измеримости
  нужен **позитивный набор человеческих глав** (кандидаты: `~/storage/downloads/книги`)
  — это и есть задел под этап 6/eval.
- `SepiaPhaseName` включает `architecture-repair`, а `phasesExecuted` в отчёте — тип
  `SepiaPhaseName[]`; UI (`src/`) может ожидать старый узкий union — проверить визуально
  после пуша (tsc зелёный, значит, типы согласованы).
