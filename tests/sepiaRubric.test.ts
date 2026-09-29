/** Рубрика sepia: пять отдельных проходов, маппинг id, отсев мусора,
 *  сбой одной группы как failedGroups, а не как «группа чистая».
 *  Схему и порядок слоёв держит rubricDefectBlock — по нему потом правят. */
import test, { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  RUBRIC_GROUPS,
  rubricDefectBlock,
  rubricFeatureById,
  rubricSummary,
  runSepiaRubric,
  type RubricGroupId,
  type RubricObservation,
  type RubricReport,
} from "../server/sepiaRubric";

interface GenParams {
  model: string;
  contents: string;
  systemInstruction: string;
  temperature: number;
  responseMimeType?: string;
  responseSchema?: unknown;
  maxOutputTokens?: number;
  timeoutMs?: number;
}

type Answer = (group: RubricGroupId, params: GenParams) => Promise<string> | string;

/** Фейковый генератор: группа берётся из contents, как это делает реальный промпт. */
function fakeGenerate(answer: Answer) {
  return async (params: GenParams): Promise<string> => {
    const matched = params.contents.match(/ГРУППА ([A-E])/u);
    return answer((matched?.[1] ?? "A") as RubricGroupId, params);
  };
}

function json(observations: unknown[]): string {
  return JSON.stringify({ observations });
}

function empty(_group: RubricGroupId): string {
  return json([]);
}

const SAMPLE = "Нож лежал поперёк стола. Семь минут до поезда. Она не ответила.";

describe("runSepiaRubric", () => {
  it("пять групп читаются отдельно, id привязываются к своей группе", async () => {
    const report = await runSepiaRubric(SAMPLE, fakeGenerate((group) => {
      if (group === "A") return json([{ feature: "A1", kind: "signal", evidence: "смысл несёт событие", value: "4 из 5" }]);
      if (group === "E") return json([{ feature: "E1", kind: "signal", evidence: "Прошло три года" }]);
      return json([]);
    }), { model: "deepseek-v3.2" });

    assert.equal(report.executor, "deepseek-v3.2");
    assert.equal(report.passes, 5);
    assert.deepEqual(report.failedGroups, []);
    const a1 = report.observations.find((observation) => observation.featureId === "A1");
    assert.equal(a1?.group, "A");
    assert.equal(a1?.kind, "signal");
    assert.equal(a1?.value, "4 из 5");
    // A — architecture, E — discourse: дефекты уже отсортированы глубже первым.
    assert.deepEqual(report.defects.map((defect) => defect.featureId), ["A1", "E1"]);
    assert.equal(report.defects[0].layer, "architecture");
    assert.equal(report.defects[1].layer, "discourse");
    // У каждого дефекта есть fix из каталога, а не текст ответа модели.
    assert.ok(report.defects[0].fix.length > 0);
  });

  it("мусор отбрасывается: неизвестный id, id чужой группы, signal без цитаты", async () => {
    const report = await runSepiaRubric(SAMPLE, fakeGenerate((group) => {
      if (group !== "A") return json([]);
      return json([
        { feature: "Z9", kind: "signal", evidence: "нет такого признака" },
        { feature: "B1", kind: "signal", evidence: "тело как канал чувства" },
        { feature: "A2", kind: "signal", evidence: "" },
        { feature: "A3", kind: "signal", evidence: "каждая сцена на тему" },
        { feature: "Тематическая явность", kind: "signal", evidence: "тезис в конце" },
        "не объект",
      ]);
    }), { model: "m" });

    assert.deepEqual(
      report.observations.map((observation) => observation.featureId).sort(),
      ["A1", "A3"],
      `мусор прошёл: ${JSON.stringify(report.observations)}`,
    );
    assert.deepEqual(report.failedGroups, []);
  });

  it("kind нормализуется, n/a работает без цитаты", async () => {
    const report = await runSepiaRubric(SAMPLE, fakeGenerate((group) => {
      if (group === "A") return json([
        { feature: "A1", kind: "SIGNAL", evidence: "тезис" },
        { feature: "A2", kind: "na" },
        { feature: "A3", kind: "что-то своё", evidence: "цитата" },
        { feature: "A4", kind: "human", evidence: "обычная фраза" },
      ]);
      if (group === "E") return json([{ feature: "E1", kind: "over-correction", evidence: "Прошло двадцать лет", value: "5 из 5" }]);
      return json([]);
    }), { model: "m" });

    const byId = new Map(report.observations.map((observation) => [observation.featureId, observation]));
    assert.equal(byId.get("A1")?.kind, "signal");
    assert.equal(byId.get("A2")?.kind, "n/a");
    // Неизвестное значение — не повод терять признак: считаем наблюдение сигналом.
    assert.equal(byId.get("A3")?.kind, "signal");
    assert.equal(byId.get("A4")?.kind, "human");
    // Перекоррекция — отдельный вид отказа, она не становится дефектом.
    assert.equal(byId.get("E1")?.kind, "over-correction");
    assert.equal(report.overCorrections.length, 1);
    assert.deepEqual(report.defects.map((defect) => defect.featureId), ["A1", "A3"]);
  });

  it("позитивный маркер (defect=false) наблюдается, но не попадает в дефекты", async () => {
    const report = await runSepiaRubric(SAMPLE, fakeGenerate((group) => {
      if (group !== "D") return json([]);
      return json([{ feature: "D1", kind: "signal", evidence: "«Мастер и Маргарита» на полке" }]);
    }), { model: "m" });

    assert.equal(report.observations.length, 1);
    assert.deepEqual(report.defects, []);
  });

  it("упавшая группа попадает в failedGroups, а не выглядит чистой", async () => {
    const report = await runSepiaRubric(SAMPLE, fakeGenerate(async (group) => {
      if (group === "C") throw new Error("HTTP 503");
      if (group === "D") return "не json вовсе";
      return json([]);
    }), { model: "m" });

    assert.deepEqual(report.failedGroups.sort(), ["C", "D"]);
    assert.equal(report.passes, 3);
    assert.match(rubricSummary(report), /не прочитаны C,D/u);
  });

  it("у каждого вызова свой systemInstruction со своей группой", async () => {
    const instructions = new Map<RubricGroupId, string>();
    await runSepiaRubric(SAMPLE, fakeGenerate((group, params) => {
      instructions.set(group, params.systemInstruction);
      assert.equal(params.responseMimeType, "application/json");
      assert.ok(params.contents.startsWith(`ГРУППА ${group} — `));
      return json([]);
    }), { model: "m" });

    assert.equal(instructions.size, RUBRIC_GROUPS.length);
    for (const group of RUBRIC_GROUPS) {
      const instruction = instructions.get(group.id) || "";
      assert.match(instruction, /Читаешь ТОЛЬКО эту группу/u);
      assert.match(instruction, /Нет цитаты — нет признака/u);
      assert.match(instruction, /никакого общего счёта/u);
      // Свои признаки все, чужих в задании нет: каждый проход видит одну группу.
      for (const feature of group.features) {
        assert.ok(instruction.includes(`${feature.id} ${feature.name}`), `нет признака ${feature.id} в группе ${group.id}`);
      }
      const rows = instruction.match(/Как судить:/gu) ?? [];
      assert.equal(rows.length, group.features.length, `группа ${group.id}: чужие строки в задании`);
    }
  });
});

describe("rubricDefectBlock", () => {
  const observation = (group: RubricObservation["group"], featureId: string): RubricObservation => ({
    group,
    featureId,
    feature: rubricFeatureById(featureId)?.feature.name ?? featureId,
    kind: "signal",
    evidence: "цитата",
  });

  function reportWith(overCorrections: RubricObservation[] = []): RubricReport {
    return {
      executor: "m",
      observations: [],
      defects: [
        { layer: "style", group: "B", featureId: "B1", feature: "Доминирующий режим эмоции", evidence: "сжалось внутри", fix: "назови чувство словом" },
        { layer: "discourse", group: "E", featureId: "E1", feature: "Хронологический разрыв", evidence: "Прошло три года", fix: "сделай пропуск времени" },
        { layer: "architecture", group: "A", featureId: "A1", feature: "Тематическая явность", evidence: "всё под одну тему", fix: "убери тезис" },
      ],
      overCorrections,
      failedGroups: [],
      passes: 5,
    };
  }

  it("слои идут сверху вниз: архитектура → связность → поверхность", () => {
    const block = rubricDefectBlock(reportWith());
    const architecture = block.indexOf("АРХИТЕКТУРА");
    const discourse = block.indexOf("СВЯЗНОСТЬ ТЕКСТА");
    const style = block.indexOf("ПОВЕРХНОСТЬ");
    assert.ok(architecture > 0 && discourse > architecture && style > discourse, block);
    assert.ok(block.indexOf("убери тезис") < block.indexOf("назови чувство словом"));
    assert.match(block, /Порядок: сначала архитектура/u);
    // Цитата и fix живут в одной строке признака.
    assert.match(block, /- Тематическая явность: «всё под одну тему» → убери тезис/u);
  });

  it("перекоррекция вынесена отдельно и с запретом усиливать", () => {
    const report = reportWith([observation("E", "E3")]);
    const block = rubricDefectBlock(report);
    const overCorrection = block.indexOf("ПЕРЕКОРРЕКЦИЯ");
    assert.ok(overCorrection > block.indexOf("ПОВЕРХНОСТЬ"), block);
    assert.ok(overCorrection > block.indexOf("СВЯЗНОСТЬ ТЕКСТА"));
    assert.match(block, /НЕ усиливай/u);
    assert.match(block, /- Нелинейная рамка для откровения: «цитата»/u);
    // Перекоррекция не считается дефектом: в списке дефектов её нет.
    assert.ok(!report.defects.some((defect) => defect.featureId === "E3"));
  });

  it("пустой отчёт даёт пустой блок", () => {
    const emptyReport: RubricReport = {
      executor: "m", observations: [], defects: [], overCorrections: [], failedGroups: [], passes: 5,
    };
    assert.equal(rubricDefectBlock(emptyReport), "");
  });
});
