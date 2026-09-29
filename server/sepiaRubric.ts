/** Рубрика sepia — 30 признаков StoryScope в пяти группах, с обязательной цитатой.
 *
 *  Почему это отдельный проход, а не сумма regex (server/humanStyle.ts):
 *  rubric.md требует читать «по одной группе за раз, в пяти отдельных проходах» и
 *  прямо измеряет, что при сплошном чтении модель слепнет на 1–2 самых заметных
 *  признаках (span precision 0.13–0.16). Наш прежний аудит складывал ~140 regex
 *  в одно число и возвращал «17 → 17», пока внешний детектор по той же главе писал
 *  22 сегмента из 22 «AI» (result_2026-09-29T11-06-30.json).
 *
 *  Второй смысл — двухэтапный протокол refactor из SKILL.md: «paraphrasing without
 *  a defect list makes AI fingerprints more visible». Здесь и рождается список
 *  дефектов (stage 1), а правка идёт по нему и с самой глубокой первой (stage 2).
 *
 *  Тексты формулировок — адаптация под русскую прозу, не дословный перевод:
 *  rubric.md описывает, как судить и какие опоры в корпусе, а не что писать в правке. */

import { Type } from "@google/genai";
import { parseJsonResponse } from "./authorPipeline";

export type RubricGroupId = "A" | "B" | "C" | "D" | "E";
export type RubricKind = "signal" | "human" | "n/a" | "over-correction";
/** Слой, на котором правится признак. Чинится сверху вниз: architecture → discourse → style. */
export type RubricLayer = "architecture" | "discourse" | "style";

export interface RubricFeature {
  /** Короткий id — модель возвращает его в JSON, а не название строки. */
  id: string;
  name: string;
  /** Как судить по rubric.md. */
  judge: string;
  /** Опоры корпуса: человек / ИИ. Это калибровка, а не порог для одной истории. */
  human: string;
  ai: string;
  /** Что делать, если признак наблюдён. */
  fix: string;
  /** false — позитивный маркер или advisory: отсутствие само по себе не дефект. */
  defect: boolean;
}

export interface RubricGroup {
  id: RubricGroupId;
  title: string;
  /** Как sepia описывает направление дрейфа группы. */
  drift: string;
  layer: RubricLayer;
  features: RubricFeature[];
}

export const RUBRIC_GROUPS: RubricGroup[] = [
  {
    id: "A",
    title: "A — Тематическая детерминированность",
    drift: "ИИ тянет вверх: тезис, мораль, всё под одну тему.",
    layer: "architecture",
    features: [
      { id: "A1", name: "Тематическая явность", judge: "1 — тема остаётся не высказанной; 5 — тезисом рассказчик объясняет, как понимать события", human: "~3.3", ai: "3.9", fix: "убери тезис: смысл несёт событие, а не авторский вывод", defect: true },
      { id: "A2", name: "Вес моральных рассуждений", judge: "насколько этические споры и авторские размышления перевешивают удовольствие от истории; смотри на комментарии рассказчика и финальные речи", human: "~3.3", ai: "3.7", fix: "сократи размышления о добре и зле до поступка", defect: true },
      { id: "A3", name: "Тематическое единство", judge: "5 — каждая сцена, подсюжет и образ работают на одну тему", human: "~4.4", ai: "4.7", fix: "дай главе ход, который не работает на тему", defect: true },
      { id: "A4", name: "Комментарий рассказчика о теме", judge: "голос рассказчика обобщает: «Бывает, что люди…», «Так и есть в жизни»", human: "есть примерно в 52%", ai: "77%", fix: "вырежи обобщающие реплики рассказчика", defect: true },
      { id: "A5", name: "Диалог как философский спор", judge: "ключевые реплики спорят об идеях вместо того, чтобы двигать желание и конфликт", human: "ведущий приём в ~34%", ai: "59%", fix: "замени рассуждение в реплике спором о конкретном деле", defect: true },
      { id: "A6", name: "Явность отсылки", judge: "намёк без имени как основной способ отсылаться; у людей смесь именованного и неявного", human: "неявное ~50%", ai: "72%", fix: "назови источник по имени или убери намёк", defect: true },
    ],
  },
  {
    id: "B",
    title: "B — Сенсорика и телесная выразительность",
    drift: "ИИ тянет вверх: тело как единственный канал чувства, плотная декорация.",
    layer: "style",
    features: [
      { id: "B1", name: "Доминирующий режим эмоции", judge: "сильные сцены: прямая метка чувства / телесное ощущение / поведение / неясно. Телесное преобладание — ИИ-признак", human: "тело доминирует в ~38%", ai: "81%", fix: "раз в сцену назови чувство словом или поступком, а не только реакцией тела", defect: true },
      { id: "B2", name: "Пейзаж как зеркало письма", judge: "погода, ландшафт, архитектура системно отражают внутреннее состояние", human: "~3.6", ai: "4.1", fix: "оставь одну погоду без функции зеркала", defect: true },
      { id: "B3", name: "Акцент на среде", judge: "пейзаж и экология шире задника", human: "~2.8", ai: "3.2", fix: "не разворачивай среду шире, чем нужно действию", defect: true },
      { id: "B4", name: "Обонятельные образы", judge: "запах как один из регулярно включаемых каналов, суди по значимости относительно длины", human: "~57%", ai: "82%", fix: "не набирай запахи пачками: один, если он работает", defect: true },
      { id: "B5", name: "Плотность сенсорики", judge: "доля текста, делающего мультисенсорное описание; 5 = пышно, с замедлением темпа", human: "~3.7", ai: "3.9", fix: "оставь одну сенсорную деталь на абзац, остальное — действие", defect: true },
      { id: "B6", name: "Глубина доступа внутрь", judge: "1 = только внешне; 5 = поток сознания", human: "~3.7", ai: "3.9", fix: "не заходи в поток сознания там, где хватает взгляда", defect: true },
    ],
  },
  {
    id: "C",
    title: "C — Структурная структурированность",
    drift: "ИИ тянет вверх/к аккуратности: гладкая цепочка, развязка через принятие.",
    layer: "architecture",
    features: [
      { id: "C1", name: "Непрерывность причинности", judge: "5 = каждое событие плотно связано одной линией от завязки до конца", human: "~3.9", ai: "4.2", fix: "оставь один разрыв в цепочке: деталь без объяснения, следствие незакрытым", defect: true },
      { id: "C2", name: "Подсюжеты (advisory)", judge: "отсутствие любого второго хода; у людей слишком часто (57%), чтобы судить без контекста", human: "без подсюжета ~57%", ai: "79%", fix: "advisory: не добавляй подсюжет специально, но и не своди всё к одной линии", defect: false },
      { id: "C3", name: "Агентность развязки", judge: "точка перелома: выбор протагониста против случая, других людей, обстоятельств", human: "выбор ~46%", ai: "69%", fix: "отдай часть решения случаю, другим людям, обстоятельствам", defect: true },
      { id: "C4", name: "Режим развязки", judge: "внешний поступок / внутреннее принятие / частичный / открытый / катастрофический; внутреннее принятие — ИИ-признак", human: "внутреннее ~27%", ai: "47%", fix: "не закрывай всё принятием: пусть останется незакрытым", defect: true },
      { id: "C5", name: "Введение протагониста", judge: "устройство при первом существенном появлении: описание внешности / в действии / в реплике / во внутреннем монологе / по чужим словам; описание внешности — ИИ-признак", human: "описание ~30%", ai: "52%", fix: "введи через реплику или действие, а не через внешность", defect: true },
      { id: "C6", name: "Заземление открытия", judge: "насколько полно первая сцена фиксирует место действия (1–4)", human: "~2.1", ai: "2.3", fix: "входи в действие, а не в описание места", defect: true },
      { id: "C7", name: "Пространственная гранулярность", judge: "плотность названий мест, комнат, маршрутов (1–4)", human: "~2.3", ai: "2.5", fix: "назови один конкретный ориентир вместо общего описания", defect: true },
      { id: "C8", name: "Инвестиция до угрозы", judge: "внутреннее и бэкстори, построенные ДО того, как геройу стало опасно", human: "~2.8", ai: "3.0", fix: "дай несколько строк обычной жизни до того, как станет опасно", defect: true },
    ],
  },
  {
    id: "D",
    title: "D — Позитивные человеческие маркеры",
    drift: "Присутствие маркера — человеческий признак. Отсутствие само по себе не дефект: это проценты, а не вероятности.",
    layer: "architecture",
    features: [
      { id: "D1", name: "Именованная интертекстуальность", judge: "названный по имени реальный текст, автор или произведение", human: "есть в ~47%", ai: "24%", fix: "раз на главу назови по-настоящему существующую вещь (только настоящую — выдуманная деталь хуже отсутствия)", defect: false },
      { id: "D2", name: "Жест четвёртой стены", judge: "любое подмигивание форме или читателю", human: "есть в ~67%", ai: "39%", fix: "один лёгкий жест в сторону формы допустим, но не системно", defect: false },
      { id: "D3", name: "Прямое обращение к читателю", judge: "любое «ты», «дорогой читатель»", human: "есть в ~28%", ai: "7%", fix: "для третьего лица не вводи: это ломает договор повествования", defect: false },
    ],
  },
  {
    id: "E",
    title: "E — Временная сложность и 다양ность",
    drift: "ИИ тянет вниз: время линейное, сцены равномерны, финал однозначен.",
    layer: "discourse",
    features: [
      { id: "E1", name: "Хронологический разрыв", judge: "частота и резкость прыжков во времени", human: "~2.4", ai: "2.1", fix: "сделай один пропуск времени вместо перечисления рутины", defect: true },
      { id: "E2", name: "Интенсивность анахраноза", judge: "возвраты и предвестья как структура сцены", human: "~2.6", ai: "2.3", fix: "один раз открой сцену уже с исходом, а причину — потом", defect: true },
      { id: "E3", name: "Нелинейная рамка для откровения", judge: "временные приёмы, расставляющие открытия", human: "~2.0", ai: "1.7", fix: "придержи раскрытие и дай его с опозданием", defect: true },
      { id: "E4", name: "Реконтекстуализация после сюрприза", judge: "сколько прежнего текста перечитывается после открытия", human: "~3.3", ai: "3.0", fix: "устрой открытие так, чтобы оно меняло прочитанное раньше", defect: true },
      { id: "E5", name: "Разнообразие локаций (advisory)", judge: "история на 3000+ слов, не покидающая одно место, если только замысел не требует заточения", human: "1.34", ai: "1.08", fix: "advisory: если сюжет не заперт — дай второй опорный точке", defect: false },
      { id: "E6", name: "Доля диалога", judge: "1 = речи нет; 3 = сбалансировано; 5 = диалог доминирует", human: "~3.0", ai: "2.7", fix: "замени часть изложения репликой", defect: true },
      { id: "E7", name: "Моральная полярность к протагонисту", judge: "финальная позиция повествования: амбивалентная против явно одобрительной или осуждающей; однозначность — ИИ-признак", human: "амбивалентная ~59%", ai: "однозначная 62%", fix: "оставь амбивалентность: не выноси герою однозначного вердикта", defect: true },
    ],
  },
];

export interface RubricObservation {
  group: RubricGroupId;
  featureId: string;
  feature: string;
  kind: RubricKind;
  /** Обязательная короткая цитата. Без цитаты признак не существует (rubric.md: «no quote, no signal»). */
  evidence: string;
  /** Числовое или категориальное наблюдение модели, как оно есть. */
  value?: string;
  note?: string;
}

export interface RubricDefect {
  layer: RubricLayer;
  group: RubricGroupId;
  featureId: string;
  feature: string;
  evidence: string;
  fix: string;
}

export interface RubricReport {
  /** Модель, которой писалась глава: исполнитель диагностики. */
  executor: string;
  observations: RubricObservation[];
  defects: RubricDefect[];
  /** Отдельная строка: значение у края, противоположного ИИ-направлению — это
   *  новый отпечаток humanizer'а, а не «человечность». */
  overCorrections: RubricObservation[];
  /** Группы, до которых дошли: сбой одной группы не должен выглядеть как её чистота. */
  failedGroups: RubricGroupId[];
  passes: number;
}

const LAYER_ORDER: Record<RubricLayer, number> = { architecture: 0, discourse: 1, style: 2 };

const FEATURE_INDEX = new Map<string, { group: RubricGroup; feature: RubricFeature }>(
  RUBRIC_GROUPS.flatMap((group) => group.features.map((feature) => [`${group.id}${feature.id.slice(1)}`, { group, feature }] as const)),
);

export function rubricFeatureById(id: string): { group: RubricGroup; feature: RubricFeature } | undefined {
  return FEATURE_INDEX.get(String(id || "").trim().toUpperCase());
}

export const rubricObservationSchema = {
  type: Type.OBJECT,
  properties: {
    observations: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          feature: { type: Type.STRING, description: "id признака из задания, например A1 или C4" },
          kind: { type: Type.STRING, description: "signal | human | n/a | over-correction" },
          evidence: { type: Type.STRING, description: "Короткая цитата из текста, максимум 15 слов. Пусто только для kind=n/a" },
          value: { type: Type.STRING, description: "Наблюдение: число («4 из 5») или категория («телесное преобладание»)" },
          note: { type: Type.STRING, description: "Пояснение одной строкой, по желанию" },
        },
        required: ["feature", "kind", "evidence"],
      },
    },
  },
  required: ["observations"],
};

/** Системная инструкция одного прохода: группа читается отдельно, цитата обязательна,
 *  вероятности и общий счёт запрещены (rubric.md, Protocol). */
function groupSystemInstruction(group: RubricGroup): string {
  const rows = group.features
    .map((feature) => `${feature.id} ${feature.name}\n    Как судить: ${feature.judge}\n    Опора — человек: ${feature.human} / ИИ: ${feature.ai}`)
    .join("\n  ");
  return `Ты проводишь диагностику de-AI по одной группе рубрики. Читаешь ТОЛЬКО эту группу — остальные тебя не касаются.
Задача — наблюдения, а не правка. Текст главы дан ниже; верни JSON.

Признаки группы:
  ${rows}

Правила:
- kind=signal — признак наблюдается и тянет в сторону ИИ-колонки.
- kind=human — наблюдается и тянет к человеческой опоре.
- kind=n/a — в тексте нет случая для суждения (нет опасности → нет инвестиции до неё). Длина текста сама по себе не дефект.
- kind=over-correction — значение у края, противоположного ИИ-направлению (например, разрыв времени 5 из 5 при ИИ 2.1). Это отдельный вид отказа humanizer'а, а не человеческий признак.
- Цитата обязательна для signal, human и over-correction. Нет цитаты — нет признака: не выдумывай.
- Никаких вероятностей авторства и никакого общего счёта. Опоры корпуса — калибровка, не порог для этой истории.
- Признак с defect=false (C2, D1–D3, E5) — всё равно запиши наблюдение, но kind=n/a, если повода нет: это маркер, а не обязательание.`;
}

function normalizeKind(raw: unknown): RubricKind {
  const value = String(raw || "").toLowerCase().trim();
  if (value === "human" || value === "over-correction" || value === "n/a" || value === "na") {
    return value === "na" ? "n/a" : (value as RubricKind);
  }
  return "signal";
}

function observationsFrom(raw: unknown, group: RubricGroup): RubricObservation[] {
  const list = Array.isArray(raw) ? raw : Array.isArray((raw as { observations?: unknown })?.observations)
    ? (raw as { observations: unknown[] }).observations
    : [];
  const out: RubricObservation[] = [];
  for (const item of list as Array<Record<string, unknown>>) {
    if (!item || typeof item !== "object") continue;
    const id = String(item.feature || "").trim().toUpperCase();
    const indexed = rubricFeatureById(id);
    // Модель могла вернуть имя вместо id или id чужой группы — тогда берём то,
    // что реально стоит в этой группе, иначе наблюдение привяжется к чужому признаку.
    const feature = indexed && indexed.group.id === group.id
      ? indexed.feature
      : group.features.find((candidate) => candidate.name.toLowerCase() === String(item.feature || "").toLowerCase().trim());
    if (!feature) continue;
    const kind = normalizeKind(item.kind);
    const evidence = String(item.evidence || "").trim();
    if (kind !== "n/a" && !evidence) continue;
    out.push({
      group: group.id,
      featureId: feature.id,
      feature: feature.name,
      kind,
      evidence,
      ...(item.value ? { value: String(item.value) } : {}),
      ...(item.note ? { note: String(item.note) } : {}),
    });
  }
  return out;
}

export interface RunSepiaRubricOptions {
  model: string;
  /** Короткий кусок для запроса: один вызов — одна группа. */
  timeoutMs?: number;
}

/** Пять отдельных проходов (по одному на группу), параллельно. Сбой группы — это
 *  failedGroups, а не пустая группа: иначе отчёт молчит ровно там, где не понял. */
export async function runSepiaRubric(
  text: string,
  generate: (params: {
    model: string;
    contents: string;
    systemInstruction: string;
    temperature: number;
    responseMimeType?: string;
    responseSchema?: unknown;
    maxOutputTokens?: number;
    timeoutMs?: number;
  }) => Promise<string>,
  options: RunSepiaRubricOptions,
): Promise<RubricReport> {
  const source = text.trim();
  const results = await Promise.allSettled(
    RUBRIC_GROUPS.map((group) =>
      generate({
        model: options.model,
        systemInstruction: groupSystemInstruction(group),
        contents: `ГРУППА ${group.id} — ${group.title}. ${group.drift}\n\nТЕКСТ:\n${source}`,
        temperature: 0.2,
        responseMimeType: "application/json",
        responseSchema: rubricObservationSchema,
        maxOutputTokens: 4096,
        ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
      }),
    ),
  );

  const observations: RubricObservation[] = [];
  const failedGroups: RubricGroupId[] = [];
  results.forEach((result, index) => {
    const group = RUBRIC_GROUPS[index];
    if (result.status === "rejected") {
      failedGroups.push(group.id);
      console.warn(`Sepia rubric group ${group.id} failed:`, result.reason);
      return;
    }
    try {
      const parsed = parseJsonResponse<unknown>(result.value, `Рубрика, группа ${group.id}`);
      observations.push(...observationsFrom(parsed, group));
    } catch (error) {
      failedGroups.push(group.id);
      console.warn(`Sepia rubric group ${group.id} unparsable:`, error);
    }
  });

  const defects: RubricDefect[] = [];
  const overCorrections: RubricObservation[] = [];
  for (const observation of observations) {
    if (observation.kind === "over-correction") {
      overCorrections.push(observation);
      continue;
    }
    if (observation.kind !== "signal") continue;
    const indexed = rubricFeatureById(observation.featureId);
    const feature = indexed?.feature;
    const group = indexed?.group;
    if (!feature || !group || !feature.defect) continue;
    defects.push({
      layer: group.layer,
      group: group.id,
      featureId: observation.featureId,
      feature: observation.feature,
      evidence: observation.evidence,
      fix: feature.fix,
    });
  }
  defects.sort((a, b) => LAYER_ORDER[a.layer] - LAYER_ORDER[b.layer]);

  return {
    executor: options.model,
    observations,
    defects,
    overCorrections,
    failedGroups,
    passes: RUBRIC_GROUPS.length - failedGroups.length,
  };
}

const LAYER_TITLES: Record<RubricLayer, string> = {
  architecture: "АРХИТЕКТУРА (глубже всего — чини первым)",
  discourse: "СВЯЗНОСТЬ ТЕКСТА",
  style: "ПОВЕРХНОСТЬ (стиль)",
};

/** Блок для промпта правки: дефекты сгруппированы сверху вниз, цитаты сохранены,
 *  перекоррекция вынесена отдельно — она не лечится «ещё человечнее». */
export function rubricDefectBlock(report: RubricReport): string {
  if (!report.defects.length && !report.overCorrections.length) return "";
  const lines: string[] = ["ДИАГНОСТИКА SEPIA (рубрика, пять групп, каждый признак с цитатой):"];
  for (const layer of ["architecture", "discourse", "style"] as RubricLayer[]) {
    const forLayer = report.defects.filter((defect) => defect.layer === layer);
    if (!forLayer.length) continue;
    lines.push("", `${LAYER_TITLES[layer]}:`);
    for (const defect of forLayer) {
      lines.push(`- ${defect.feature}: «${defect.evidence}» → ${defect.fix}`);
    }
  }
  if (report.overCorrections.length) {
    lines.push(
      "",
      "ПЕРЕКОРРЕКЦИЯ (значение у края, противоположного ИИ-направлению — это новый отпечаток правки, а не человечность; НЕ усиливай):",
    );
    for (const observation of report.overCorrections) {
      lines.push(`- ${observation.feature}: «${observation.evidence}»${observation.value ? ` (${observation.value})` : ""}`);
    }
  }
  lines.push(
    "",
    "Порядок: сначала архитектура, потом связность, потом поверхность. Правь только названное — не переписывай главу целиком.",
  );
  return lines.join("\n");
}

/** Строка для отчёта главы: сколько групп прочитано и сколько дефектов нашли. */
export function rubricSummary(report: RubricReport): string {
  const groups = RUBRIC_GROUPS.length - report.failedGroups.length;
  return `рубрика sepia: групп ${groups}/${RUBRIC_GROUPS.length}, наблюдений ${report.observations.length}, `
    + `дефектов ${report.defects.length}, перекоррекций ${report.overCorrections.length}`
    + (report.failedGroups.length ? `, не прочитаны ${report.failedGroups.join(",")}` : "");
}
