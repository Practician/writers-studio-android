import { strict as assert } from "node:assert";
import test from "node:test";
import {
  authorSpeechMark,
  measureProseRegister,
  proseRegisterFindings,
  proseRegisterIssues,
  proseRegisterSceneIssues,
  speechMarkDirective,
} from "../server/proseRegister";
import {
  countFreezeMolds,
  countSilentMolds,
  countSimileMarks,
  verifyChapter,
} from "../server/chapterVerdict";
import { modelTier, shortModelName } from "../server/modelTier";
import { HUMAN_SAMPLE, MACHINE_CHAPTER } from "./fixturesProseRegister";

// ── Регистр: различает ли человеческое и машинное ────────────────────────────

test("proseRegister: машинная глава и живой текст разведены по всем метрикам", () => {
  const machine = measureProseRegister(MACHINE_CHAPTER);
  const human = measureProseRegister(HUMAN_SAMPLE);

  assert.ok(machine.bodilyPer10k > human.bodilyPer10k, "телесные реакции");
  assert.ok(machine.filterPer10k > human.filterPer10k, "фильтр-слова");
  assert.ok(machine.intensifierPer10k > human.intensifierPer10k, "оценочные прилагательные");
  assert.ok(machine.negationMoldPer10k > human.negationMoldPer10k, "каркас «не + глагол»");
  assert.ok(machine.oneSentenceParagraphShare < human.oneSentenceParagraphShare, "однофразные абзацы");
  assert.ok(machine.interiorShare < human.interiorShare, "внутренняя речь");
  assert.ok(machine.hedgeShare > human.hedgeShare, "избыток оговорок");
});

test("proseRegister: живой текст не даёт ни одного замечания", () => {
  assert.deepEqual(proseRegisterIssues(HUMAN_SAMPLE), [], "эталон должен быть чист");
  assert.deepEqual(proseRegisterFindings(HUMAN_SAMPLE), [], "и находок быть не должно");
});

test("proseRegister: машинная глава даёт и замечания, и находки с названными числами", () => {
  const issues = proseRegisterIssues(MACHINE_CHAPTER);
  const findings = proseRegisterFindings(MACHINE_CHAPTER);
  assert.ok(issues.length >= 4, `замечаний ${issues.length} — ожидалось не меньше четырёх`);
  assert.ok(findings.length >= 4, `находок ${findings.length}`);
  // Правило sepia «no quote — no signal»: без числа замечание не считается.
  for (const issue of issues) assert.ok(/\d/.test(issue), `без измеренной величины: ${issue}`);
  for (const finding of findings) assert.ok(/\d/.test(finding.label), `без измеренной величины: ${finding.label}`);
});

test("proseRegister: один каркас «не + глагол» — ещё не замечание, повтор — да", () => {
  // Порог замера — 120 слов: на коротком тексте молчим, иначе это шум.
  const filler = "Он смотрел на плиты под ногами и думал о погоде, которая стояла за стеной.";
  const single = `Васька не ответил. ${filler}`.repeat(4);
  assert.equal(proseRegisterIssues(single).length, 0, `один каркас на ${measureProseRegister(single).words} словах — не замечание`);
  const many = `Васька не ответил. ${filler}`.repeat(8);
  assert.ok(proseRegisterIssues(many).some((issue) => issue.includes("не + глагол")), "повтор должен называться");
});

test("proseRegisterSceneIssues: на куске в три фразы молчит, на сцене говорит", () => {
  assert.deepEqual(proseRegisterSceneIssues("Он шагнул. Встал. Пошёл."), [], "короткий кусок — не шум");
  const filler = "Он смотрел на стену и считал пальцем трещины в камне, которых становилось больше.";
  const scene = new Array(8).fill(`Васька не ответил. ${filler}`).join("\n\n");
  assert.ok(proseRegisterSceneIssues(scene).length <= 2, "не больше двух замечаний за раз");
  assert.ok(proseRegisterSceneIssues(scene).length > 0, "но хотя бы одно должно быть");
});

// ── Знак тире у реплик берётся из образца ─────────────────────────────────────

test("authorSpeechMark: знак берётся из образца, а не из привычки модели", () => {
  assert.equal(authorSpeechMark(HUMAN_SAMPLE).mark, "-", "у автора реплики дефисом");
  assert.equal(authorSpeechMark("- Первое.\n- Второе.\n- Третье.").mark, "-");
  assert.equal(authorSpeechMark("— Первое.\n— Второе.").mark, "—");
  // Образца нет — поведение по умолчанию, а не выдуманное предпочтение.
  // Проверено: при нуле реплик и дефисов и длинных тире сравнение 0 >= 0 давало
  // дефис, то есть приложение объявляло знаком автора знак, которого в образце нет.
  assert.equal(authorSpeechMark("Просто текст без реплик.").mark, "—");
});

test("speechMarkDirective: называет знак и ссылается на замер, а не на вкус", () => {
  const directive = speechMarkDirective(HUMAN_SAMPLE);
  assert.ok(directive.includes("«-»"), `в директиве нет знака автора: ${directive}`);
  assert.ok(/\d/.test(directive), "директива должна называть замер по образцу");
});

// ── Потолки главы на финальном тексте ────────────────────────────────────────

test("потолки главы ловятся на собранном тексте, а не только внутри петли сцен", () => {
  assert.ok(countSilentMolds(MACHINE_CHAPTER) >= 1, "молчание в машинной главе посчитано");
  assert.equal(countSilentMolds(HUMAN_SAMPLE), 0, "в живом тексте молчаний нет");
  assert.equal(countFreezeMolds(HUMAN_SAMPLE), 0);
  assert.ok(countSimileMarks(MACHINE_CHAPTER) > countSimileMarks(HUMAN_SAMPLE), "сравнений у машины больше");
});

test("verifyChapter: машинная глава показывает нарушения, живая — нет", () => {
  const machine = verifyChapter(MACHINE_CHAPTER);
  const human = verifyChapter(HUMAN_SAMPLE);

  assert.ok(machine.registerFindings.length > 0, "у машинной главы есть находки регистра");
  assert.equal(human.registerFindings.length, 0, "живая проза чиста по регистру");
  assert.ok(human.caps.every((cap) => cap.ok), `у эталона все потолки целы: ${JSON.stringify(human.caps)}`);
  // Живой текст обязан проходить гейт: иначе порог ничего не измеряет.
  assert.equal(human.gatePassed, true, `эталон не проходит гейт: ${human.gateReason}`);
  assert.ok(human.notes.length > 0, "сводка не пуста");
  assert.ok(machine.findings.length > 0, "блок правки непустой");
});

// ── Пол качества модели ──────────────────────────────────────────────────────

test("modelTier: резервные модели отделены от основных", () => {
  assert.equal(modelTier("gemini-3.8-flash"), "primary");
  assert.equal(modelTier("gemini-3.7-flash"), "primary");
  assert.equal(modelTier("deepseek/deepseek-v3.2"), "primary");
  // Живой случай 04.10.2026: прозу писали эти.
  assert.equal(modelTier("gemini-2.5-flash-lite"), "reserve");
  assert.equal(modelTier("gemini-3.1-flash-lite"), "reserve");
  assert.equal(modelTier("gemini-2.0-flash"), "reserve");
  assert.equal(modelTier("gemini-haiku-3"), "reserve");
  assert.equal(modelTier(""), "reserve");
});

test("shortModelName: в журнале — короткое имя, а не идентификатор", () => {
  assert.equal(shortModelName("gemini-2.5-flash-lite"), "2.5-flash-lite");
  assert.equal(shortModelName("deepseek/deepseek-v3.2"), "deepseek-v3.2");
});