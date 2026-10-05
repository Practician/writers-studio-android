/**
 * Пол качества модели: какая модель годится для НАПИСАНИЯ прозы, а какая только
 * для правок и продолжений.
 *
 * Зачем. Цепочка ротации Gemini устроена правильно для доступности: у каждой
 * модели свой дневной бакет, поэтому при исчерпанной квоте приложение уходит на
 * `gemini-2.5-flash-lite` и продолжает работу. Но для художественной прозы это
 * разница качества, а не только темпа. Живой прогон главы 4 (04.10.2026) целиком
 * ушёл на резерв: основная `gemini-3.7-flash` отдала 503 трижды, у `2.5-flash-lite`
 * сгорела дневная квота, и сцены #79–#83 вместе с пятью «доводками» писал
 * `2.5-flash-lite` и `3.1-flash-lite`. При этом в отчёте не было ни одной строки
 * о том, что писатель — резервная модель: прогоны выглядели полностью рабочими,
 * а вердикт детектора стоял на 21 сегмент AI из 22.
 *
 * Отсюда правило: деградация разрешена (иначе автор останется без текста), но
 * она обязана быть видна и обязана менять приёмку — иначе приложение выдаёт
 * результат резервной модели за равный по качеству.
 */

export type ModelTier = "primary" | "reserve";

/**
 * Резервные модели: отдельный бакет, качество прозы ниже основной.
 *
 * Границы заданы явно, потому что `\b` в JS опирается на `\w` (ASCII) и внутри
 * идентификатора ловит чужое: `/mini\b/` матчит «ge-mini» в «gemini» и объявлял
 * ВСЮ линейку Gemini резервной. Проверено на живом случае 04.10.2026.
 */
const RESERVE_PATTERNS = [
  /(?:^|[^a-z])flash[-_.]?lite/u,
  /(?:^|[^a-z])gemini-2\.0-flash/u,
  /(?:^|[^a-z])gemini-2\.5-flash(?![-_.]?lite)/u,
  /(?:^|[^a-z])gpt-oss-20b/u,
  /(?:^|[^a-z])llama-?3\.?[0-9]?[b0-9]?-?70b/u,
];

/** Явно заведомо слабые модели любых провайдеров. */
const WEAK_PATTERNS = [
  /(?:^|[^a-z])mini[-_.]?[0-9]/u,
  /(?:^|[^a-z])nano/u,
  /(?:^|[^a-z])haiku/u,
  /(?:^|[^a-z])qwen.*[:/]1\.5b/u,
  /(?:^|[^a-z])gemma-?[123]/u,
];

/** Уровень модели для написания прозы. */
export function modelTier(model: string): ModelTier {
  const id = String(model || "").toLowerCase();
  if (!id) return "reserve";
  if (WEAK_PATTERNS.some((pattern) => pattern.test(id))) return "reserve";
  if (RESERVE_PATTERNS.some((pattern) => pattern.test(id))) return "reserve";
  return "primary";
}

/** Короткое имя для журнала: «2.5-flash-lite» вместо полного идентификатора. */
export function shortModelName(model: string): string {
  const id = String(model || "").replace(/^[a-z0-9_-]+\//u, "");
  return id.replace(/^gemini-/u, "").replace(/-latest$/u, "");
}

/**
 * Сводка по фактически ответившим моделям за прогон. Считает запросы по уровню,
 * чтобы в журнал уходило не «модель такая-то», а «писал резерв, 12 запросов».
 */
export interface ModelUseSummary {
  /** Сколько запросов ушло на основные модели. */
  primary: number;
  /** Сколько — на резервные. */
  reserve: number;
  /** Сколько всего. */
  total: number;
  /** Резервные модели, которые отвечали, по убыванию числа запросов. */
  reserveModels: Array<{ model: string; count: number }>;
  /** Основные модели, которые отвечали. */
  primaryModels: Array<{ model: string; count: number }>;
  /** Писала ли прозу хотя бы одна резервная модель. */
  degraded: boolean;
}

const useTally = new Map<string, { primary: number; reserve: number; models: Map<string, number> }>();

/**
 * Модель, ответившая последней. Нужна конвейеру прозы: гайд по тикам и температура
 * берутся по модели, а ротация происходит ниже, в слое запроса, — на момент
 * сборки промпта ещё неизвестно, кто ответит. Между сценами главы это уже известно,
 * поэтому промпт второй и следующих сцен можно строить под фактического писателя.
 */
let lastAnsweringModel = "";

/** Записать, какая модель фактически ответила на запрос. */
export function recordModelUse(model: string): void {
  const id = String(model || "").trim();
  if (!id) return;
  lastAnsweringModel = id;
  const tier = modelTier(id);
  const entry = useTally.get(tier) ?? { primary: 0, reserve: 0, models: new Map<string, number>() };
  if (tier === "primary") entry.primary += 1;
  else entry.reserve += 1;
  entry.models.set(id, (entry.models.get(id) || 0) + 1);
  useTally.set(tier, entry);
}

/** Обнулить счётчики перед новым прогоном. */
export function resetModelUse(): void {
  useTally.clear();
  lastAnsweringModel = "";
}

/**
 * Модель, которой писать промпт: фактически ответившая, если она известна,
 * иначе запрошенная.
 *
 * Зачем. Живой прогон главы 4 (05.10.2026, 09:23): запрошена `gemini-3.8-flash`,
 * а 82 запроса из 88 выполнила `gemini-3.1-flash-lite` (основные модели отдали
 * 503 и 429 по дневной квоте). Промпт сцены строился по 3.8, поэтому гайд
 * `modelFingerprintGuidance` уходил не тому писателю: у Gemini Lite есть
 * отдельный блок против ровных кусков одинаковой длины, и в промпт он не попал
 * именно потому, что модель подменилась уже после сборки промпта. Симптомы
 * совпали с симптомами блока: куски по 147–181 слово (CV 0,06 против 1,19 у
 * автора), одна интонация на главу, 2,0 конкретных деталей на 1000 слов.
 */
export function proseModel(requested: string): string {
  return lastAnsweringModel || String(requested || "");
}

/** Сводка по текущему прогону. */
export function modelUseSummary(): ModelUseSummary {
  const primaryEntry = useTally.get("primary");
  const reserveEntry = useTally.get("reserve");
  const toList = (entry: typeof primaryEntry) => [...(entry?.models ?? new Map<string, number>()).entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([model, count]) => ({ model, count }));
  const primary = primaryEntry?.primary ?? 0;
  const reserve = reserveEntry?.reserve ?? 0;
  return {
    primary,
    reserve,
    total: primary + reserve,
    primaryModels: toList(primaryEntry),
    reserveModels: toList(reserveEntry),
    degraded: reserve > 0,
  };
}

/**
 * Строка для журнала. Пишется один раз в конце прогона: по одной модели на запрос
 * журнал бы превратился в перечень ротаций (так было в живом прогоне 02.10, где
 * 20 строк автовыбора закрыли собой все шаги конвейера).
 */
export function modelUseNote(summary: ModelUseSummary = modelUseSummary()): string {
  if (!summary.total) return "";
  const list = (entries: Array<{ model: string; count: number }>) =>
    entries.map((entry) => `${shortModelName(entry.model)}×${entry.count}`).join(", ");
  const parts = [`запросов ${summary.total}: основные ${summary.primary}${summary.primaryModels.length ? ` (${list(summary.primaryModels)})` : ""}`];
  parts.push(`резервные ${summary.reserve}${summary.reserveModels.length ? ` (${list(summary.reserveModels)})` : ""}`);
  return `Модели прогона: ${parts.join("; ")}`;
}

/**
 * Предупреждение при деградации. Формулировка не обвиняет автора и не прячет
 * причину: резервная модель — это осознанный размен доступности на качество,
 * и автор должен знать, что заплатил.
 */
export function modelDegradationWarning(summary: ModelUseSummary = modelUseSummary()): string {
  if (!summary.degraded) return "";
  const names = [...new Set(summary.reserveModels.map((entry) => shortModelName(entry.model)))].join(", ");
  const share = Math.round((summary.reserve / Math.max(1, summary.total)) * 100);
  return `ВНИМАНИЕ: ${share} % запросов (${summary.reserve} из ${summary.total}) выполнила резервная модель (${names}). `
    + "У неё отдельный квота-бакет и заметно более низкое качество художественной прозы; "
    + "локальный аудит и гейт этого не видят — сверяйтесь с внешним детектором и перегенерируйте главу, "
    + "когда основная модель снова доступна.";
}