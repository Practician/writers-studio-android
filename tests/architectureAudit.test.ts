import test from "node:test";
import assert from "node:assert/strict";
import { architectureDiagnostics, architectureFixBlock } from "../server/architectureAudit";
import { meaningLossIssues } from "../server/editRevert";
import { endingDirective, splitIntoPhaseChunks } from "../server/chapterGenerate";
import { runMultiDetectorGate } from "../server/humanStyleEnhanced";
import { AI_TELL_CATALOG, AI_TELL_CATALOG_V2_EXTRA } from "../server/humanStyle";

const CATALOG = [...AI_TELL_CATALOG, ...AI_TELL_CATALOG_V2_EXTRA];

function paragraphs(count: number, seed: (index: number) => string): string {
  return Array.from({ length: count }, (_, index) => seed(index)).join("\n\n");
}

/** Живая проза для контрольных замеров: разная длина абзацев и словарь пошире.
 *  Текст с одинаковыми абзацами и повторами проваливает метрики формата, а не
 *  архитектуры, — в тесте это замаскировало бы проверку нужного слоя. */
function variedParagraphs(count: number): string {
  const openings = [
    "Марта пнула калитку и, не дожидаясь ответа, перешла на другую сторону.",
    "За оградой кто-то колол дрова, и стук разносился по пустой улице до самого полудня.",
    "Небо.",
    "В кармане лежала мятая «Бирюса» 1978 года, купленная ещё в том же магазине у вокзала.",
    "Такса тявкнула и легла в лужу, посчитав её своей полуденной нормой.",
  ];
  return Array.from({ length: count }, (_, index) => openings[index % openings.length]).join("\n\n");
}

test("пустая глава не даёт архитектурных находок и не падает", () => {
  for (const input of ["", " ", "\n\n", "Он вошёл."]) {
    const diagnostics = architectureDiagnostics(input);
    assert.equal(diagnostics.findings.length, 0, JSON.stringify(input));
    assert.equal(diagnostics.score, 0);
  }
});

test("текст без абзацев всё равно измеряется", () => {
  // Дефект формата не должен обнулять слой: при одном абзаце на 20+ тысяч знаков
  // прежние проверки молчали, и глава уходила в детектор с баллом «чисто».
  const wall = Array.from({ length: 120 }, (_, index) =>
    `В животе неприятно кольнуло, и он пошёл вдоль стены номер ${index}, считая швы.`,
  ).join(" ");
  const diagnostics = architectureDiagnostics(wall);
  assert.ok(diagnostics.stateOpeners > 0, "сцены, открытые состоянием, должны быть найдены");
});

test("авторский вывод в конце абзаца ловится, действие — нет", () => {
  const explaining = paragraphs(8, (index) =>
    `Он подошёл к стене и провёл по ней ладонью. Это значило, что выхода здесь нет.`,
  );
  const acting = paragraphs(8, (index) =>
    `Он подошёл к стене и провёл по ней ладонью. Под ногами хрустнула крошка, и он отступил.`,
  );
  assert.ok(architectureDiagnostics(explaining).explanatoryTails >= 6);
  assert.equal(architectureDiagnostics(acting).explanatoryTails, 0);
});

test("развязка «герой принял и вырос» отличается от решения, отданного случаю", () => {
  const base = paragraphs(10, () => "Он шёл по коридору и считал двери, не разговаривая.");
  const growth = `${base}\n\nОн наконец понял, что всё это значило, и теперь он понимал, кто он такой.`;
  const shifted = `${base}\n\nВместо него это сделал случай, и оказалось, он совсем не так всё представлял.`;

  assert.equal(architectureDiagnostics(growth).growthEnding, true);
  assert.equal(architectureDiagnostics(growth).agencyShift, 0);
  assert.equal(architectureDiagnostics(shifted).growthEnding, false);
  assert.ok(architectureDiagnostics(shifted).agencyShift >= 1);
});

test("текст без конкретных деталей мира получает находку, с деталями — нет", () => {
  // Порог заземления — 600 слов: на коротком тексте конкретика не измеряется.
  // Порог заземления — 600 слов: на коротком тексте конкретика не измеряется.
  const vague = paragraphs(70, () => "Он двигался вперёд, и вокруг было всё так же непонятно и тяжело.");
  const concrete = variedParagraphs(70);
  assert.ok(architectureDiagnostics(vague).findings.some((finding) => finding.id === "no-grounding"));
  assert.ok(!architectureDiagnostics(concrete).findings.some((finding) => finding.id === "no-grounding"));
});

test("блок правки собирается только по находкам", () => {
  const vague = paragraphs(70, () => "Он двигался вперёд, и вокруг было всё так же непонятно и тяжело.");
  const block = architectureFixBlock(architectureDiagnostics(vague));
  assert.ok(block.includes("АРХИТЕКТУРА"));
  assert.ok(block.includes("конкретн"));
  assert.equal(architectureFixBlock(architectureDiagnostics("Короткий абзац.")), "");
});

test("архитектурный слой входит в вердикт gate", () => {
  const clean = variedParagraphs(70);
  const machine = paragraphs(70, () =>
    "Он двигался вперёд, и вокруг было всё так же непонятно, тяжело и необъяснимо. Это было странное чувство.",
  );
  const cleanGate = runMultiDetectorGate(clean, CATALOG, "general");
  const machineGate = runMultiDetectorGate(machine, CATALOG, "general");
  assert.ok(cleanGate.architectureScore < machineGate.architectureScore, `${cleanGate.architectureScore} < ${machineGate.architectureScore}`);
  // Архитектурная проверка обязана срабатывать. Остальные (словарь, ритм) на этом
  // искусственном тексте шумят сами по себе и к предмету проверки отношения не имеют.
  assert.ok(!cleanGate.details.some((detail) => detail.includes("Архитектура")), cleanGate.details.join("; "));
  assert.ok(machineGate.details.some((detail) => detail.includes("Архитектура")), machineGate.details.join("; "));
  assert.ok(machineGate.architectureFindings.length > 0);
});

test("фазы режут длинную главу на блоки и не режут короткую", () => {
  assert.deepEqual(splitIntoPhaseChunks("Короткий кусок."), ["Короткий кусок."]);

  const long = paragraphs(400, (index) => `Абзац номер ${index} с текстом, который занимает заметное место в главе и тянется дальше.`);
  const chunks = splitIntoPhaseChunks(long, 7_000);
  assert.ok(chunks.length > 1, "длинная глава должна рубиться");
  for (const chunk of chunks) {
    assert.ok(chunk.length <= 9_000, `блок вышел ${chunk.length} знаков`);
  }
  // Содержимое не теряется и границы абзацев не слипаются: склейка блоков даёт
  // исходный текст байт в байт.
  assert.equal(chunks.join(""), long);
});

test("правило концовки зависит от позиции бита, а не одинаково для всех", () => {
  const first = endingDirective(0, 10);
  const second = endingDirective(1, 10);
  const middle = endingDirective(4, 10);
  const penultimate = endingDirective(8, 10);
  assert.notEqual(first, middle);
  assert.notEqual(second, middle);
  assert.ok(second.includes("крючок"), "второй бит остаётся крючком");
  assert.ok(penultimate.includes("крючок"), "предпоследний бит остаётся крючком");
  assert.ok(middle.includes("НЕ крючком"), "средние биты крючком не закрываются");
  // Правило «не подводи итог» остаётся во всех вариантах — его снимать нельзя.
  for (const directive of [first, second, middle, penultimate]) {
    assert.ok(/резюме|итог|Мораль/iu.test(directive), directive);
  }
});

test("тест сохранения смысла ловит пропажу чисел и имён", () => {
  const original = "В холодильнике «Бирюса» 1978 года стояла банка с огурцами, и Васька съел её до дна.";
  assert.deepEqual(meaningLossIssues(original, original), []);

  const withoutNumber = "В холодильнике «Бирюса» стояла банка с огурцами, и Васька съел её до дна.";
  assert.ok(meaningLossIssues(original, withoutNumber).some((issue) => issue.includes("числа")));

  const withoutName = "В холодильнике стояла банка с огурцами 1978 года, и он съел её до дна.";
  const issues = meaningLossIssues(original, withoutName);
  assert.ok(issues.some((issue) => issue.includes("имена")), issues.join("; "));

  // Перефраз с сохранением фактов проходит.
  const rephrased = "Васька доел банку с огурцами из «Бирюсы» 1978 года.";
  assert.deepEqual(meaningLossIssues(original, rephrased), []);
});
