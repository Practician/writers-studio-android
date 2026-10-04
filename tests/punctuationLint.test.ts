import { strict as assert } from "node:assert";
import test from "node:test";
import { punctuationHygieneNote, sanitizeGeneratedText } from "../server/textHygiene";

/**
 * Линт машинной пунктуации (сборка 114).
 *
 * Все три артефакта взяты из готовой главы 4 (04.10.2026), которую внешний
 * детектор оценил как 21 сегмент AI из 22. Первый порождён САМИМ приложением:
 * `fuseShortSentencesForTail` соединял независимые клаузы точкой с запятой и не
 * опускал букву. Второй — обрезанным краем ответа модели. Третий — сборкой
 * абзаца из двух половин реплики.
 */

// ── 1. «Точка с запятой» перед заглавной ──────────────────────────────────────

test("точка с запятой перед заглавной не появляется после склейки фраз", () => {
  const fused = "Васька шёл следом, поправляя вязанку; Хворост царапал спину, а грозди цеплялись за лианы.";
  const result = sanitizeGeneratedText(fused);
  assert.equal(result.report.fixedPunctuationArtifacts, 1);
  assert.ok(!/;\s*[А-ЯЁ]/u.test(result.text), "точка с запятой перед заглавной ушла");
  assert.ok(result.text.includes(". Хворост"), "стало две фразы");
  // Слова не теряются: линт правит знак, а не текст.
  const words = (text: string) => (text.match(/[а-яёa-z]+/giu) ?? []).map((w) => w.toLowerCase());
  assert.deepEqual(words(result.text), words(fused), "ни одно слово не потеряно");
});

test("живая пунктуация не трогается: точка с запятой перед строчной — норма", () => {
  const text = "Он спросил; она ответила. Потом молчали.";
  const result = sanitizeGeneratedText(text);
  assert.equal(result.text, text, "ничего не меняем");
  assert.equal(result.report.fixedPunctuationArtifacts, 0);
});

test("перечисление с точкой с запятой не считается артефактом", () => {
  const text = "Он взял нож, платок и банку; положил всё на камень; посмотрел на Илью.";
  const result = sanitizeGeneratedText(text);
  assert.equal(result.report.fixedPunctuationArtifacts, 0, "три независимые части — не артефакт");
});

// ── 2. Слипшаяся пунктуация ───────────────────────────────────────────────────

test("слипшаяся пунктуация разлетается, сокращения остаются целы", () => {
  assert.ok(sanitizeGeneratedText("Оно открывается.Пластина").text.includes(". Пластина"));
  assert.ok(sanitizeGeneratedText("Он зевнул.Илья").text.includes(". Илья"));
  // Сокращения трогать нельзя: «т. д.» — это не опечатка.
  const abbreviations = sanitizeGeneratedText("См. т. д. И рис. 2");
  assert.equal(abbreviations.report.fixedPunctuationArtifacts, 0, "сокращения не тронуты");
});

// ── 3. Реплика, разорванная самостоятельной ремаркой ──────────────────────────

test("реплика, разорванная ремаркой без союза, собирается заново", () => {
  const broken = "— Илья, гляди, — прошептал Васька. Внутри всё сжалось от нехорошего предчувствия. — Оно открывается. Пластина издала щелчок.";
  const result = sanitizeGeneratedText(broken);
  assert.equal(result.report.fixedPunctuationArtifacts, 1);
  assert.ok(result.text.startsWith("— Илья, гляди, — прошептал Васька: внутри всё сжалось"), "ремарка стала придаточным");
  assert.ok(result.text.includes("— Оно открывается."), "вторая половина реплики на месте");
  assert.ok(!result.text.includes(": ."), "нет висячей точки после двоеточия");
});

test("живая ремарка с союзом не перестраивается", () => {
  // Реальный абзац из авторских глав: ремарка здесь придаточное, а не сбой.
  const human = "- Ха! Темно потому что Медведев часы перевёл не ту сторону, братан! - хохотнул Илюха и помог Ваське отцепиться. - Ты уже вернулся с турбазы?";
  const result = sanitizeGeneratedText(human);
  assert.equal(result.text, human, "авторский абзац не тронут");
  assert.equal(result.report.fixedPunctuationArtifacts, 0);
});

test("обычная реплика с зазвучной ремаркой внутри не перестраивается", () => {
  const normal = "— Слышал, — буркнул Илья, прищурившись. — Звук такой, как будто пружину отпустили.";
  const result = sanitizeGeneratedText(normal);
  assert.equal(result.text, normal, "разделительной точки нет — перестраивать нечего");
});

// ── Отчёт ────────────────────────────────────────────────────────────────────

test("журнал получает честную строку о починке и пустую при чистом тексте", () => {
  const dirty = sanitizeGeneratedText("Он пошёл.Илья ждал; Он не ответил.");
  const note = punctuationHygieneNote(dirty.report);
  assert.ok(note.includes("машинная пунктуация исправлена"), note);
  assert.ok(/\d/.test(note), "в строке есть число");
  const clean = sanitizeGeneratedText("Он пошёл. Илья ждал.");
  assert.equal(punctuationHygieneNote(clean.report), "", "чистый текст не занимает журнал");
});

test("гигиена не ломает невидимые символы, эмодзи и переводы строк", () => {
  const source = "Первая строка.\u00A0Вторая👨‍👩‍👧 строка.";
  const result = sanitizeGeneratedText(source);
  assert.ok(result.text.includes("\u00A0") === false, "нестандартный пробел нормализован");
  assert.ok(result.text.includes("👨‍👩‍👧"), "ZWJ-последовательность сохранена");
  assert.ok(!result.report.normalizedLineEndings, "LF не трогаем");
  assert.equal(result.report.changed, true);
});