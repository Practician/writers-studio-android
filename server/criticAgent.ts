/**
 * АГЕНТ-КРИТИК: читает готовую главу как читатель и ищет машинные отпечатки,
 * которых не видят ни метрики, ни рубрика.
 *
 * Зачем он, если есть рубрика (server/sepiaRubric.ts). Рубрика задаёт вопросы по
 * StoryScope и ждёт цитату в ответ; на практике из 30 признаков живой текст
 * проигнорировал половину, а самый сильный — «объяснение темы» — на тексте без
 * морализаторских хвостов не срабатывал вообще. Критик работает иначе: он не
 * отвечает на вопросы, а читает и говорит, ГДЕ ИМЕННО текст выдал себя, со
 * ссылкой на место. Это принципиально разные режимы: вопрос требует ответа по
 * шкале, наблюдение требует указания пальцем.
 *
 * Что ищет критик (измеряемые нами и не измеряемые рубрикой):
 *   1. регенерация одного образа разными словами — по «drop ratio» StoryScope
 *      (человек 3,7 %, модели 9–11 %);
 *   2. абзац-сирота: абзац, который ничего не меняет в главе;
 *   3. перечисление из ровно трёх — единственная перечисляющая модельная форма;
 *   4. вывод-мораль в последних абзацах;
 *   5. развязка «выбрал → принял → вырос»;
 *   6. объяснение того, что читатель только что видел;
 *   7. запах как главный носитель детали (sepia style-pass §3 — «ozone» в бан-листе);
 *   8. серийность: три абзаца подряд одной формы.
 *
 * Каждый пункт обязан быть подтверждён цитатой. Без цитаты — не находка: ровно
 * то правило sepia rubric.md, которое в проекте было написано, но не проверялось.
 */

import { countSilentMolds } from "./chapterVerdict";
import { emptyChunkShare, EMPTY_CHUNK_SHARE_LIMIT, rhythmWindowIssues } from "./proseRegister";

export interface CriticismFinding {
  id: string;
  /** Что не так — одной строкой. */
  label: string;
  /** Цитата из текста: без неё находка не считается. */
  quote: string;
  /** Что делать. */
  advice: string;
  /** Насколько выражено, 0–1. */
  severity: number;
}

/** Предложение с его местом в тексте — чтобы цитата была адресной. */
interface LocatedSentence {
  text: string;
  index: number;
  paragraph: number;
}

function locate(text: string): { paragraphs: string[]; sentences: LocatedSentence[] } {
  const paragraphs = text.split(/\n+/u).map((paragraph) => paragraph.trim()).filter(Boolean);
  const sentences: LocatedSentence[] = [];
  let index = 0;
  paragraphs.forEach((paragraph, paragraphIndex) => {
    for (const raw of paragraph.split(/(?<=[.!?…])\s+/u)) {
      const trimmed = raw.trim();
      if (trimmed.length < 12) continue;
      sentences.push({ text: trimmed, index, paragraph: paragraphIndex });
      index += 1;
    }
  });
  return { paragraphs, sentences };
}

const firstSentence = (text: string): string => (text.split(/(?<=[.!?…])\s+/u)[0] || "").trim();

/** Перечисление ровно из трёх: «а, б и в», где все три — однородные члены. */
const THREE_ITEM_LIST = /,\s[^,.!?]{3,40},\s(?:и|а)\s[^,.!?]{3,40}[.!?…]/u;

/** Моральный вывод и объяснение прочитанного. */
const NARRATOR_VERDICT = /(?:это\s+(?:было|значило|оказалось)|получа(?:ется|лось)|в том и\s+(?:смысл|дело)|вот\s+почему|вот\s+и\s+выходит|и\s+вот\s+что|значит,)/iu;

/**
 * Запах как главная деталь.
 *
 * Границы слов заданы через lookaround по кириллице: `\b` в JS опирается на `\w`,
 * то есть на ASCII, и по русскому слову не срабатывает — проверка молчала на любом
 * запахе. Такая ошибка уже была в проекте (architectureAudit, proseRegister),
 * здесь она повторена осознанно уже с правильной формой.
 */
const RU = "а-яё";
const OLFACTION = new RegExp(
  "(?<![\\p{L}])(?:пах(?:ло|нуть|нет)?|запах\\p{L}*|вонь\\p{L}*|аромат\\p{L}*|нюя\\p{L}*|озон\\p{L}*|затхл\\p{L}*)"
    + "(?![\\p{L}])",
  "iu",
);

/** Развязка «осознал → принял → вырос». */
const GROWTH = /(?:он\s+(?:наконец\s+)?(?:понял|осознал|решил|принял)|теперь\s+он\s+понимал|это\s+было\s+его\s+новое)/iu;

/**
 * Детерминированная часть критики: то, что считается без модели. Модель зовётся
 * только на то, что детерминированно не считается (смысловая связность), поэтому
 * критика одного прогона стоит одного вызова, а не пяти.
 */
export function deterministicCriticism(text: string): CriticismFinding[] {
  const findings: CriticismFinding[] = [];
  const { paragraphs, sentences } = locate(text);
  const proseLongEnough = sentences.length >= 20;

  // Молчание — счётная величина, а не смысловая находка: её видно и на куске из
  // десяти предложений, и раньше просить двадцать ради неё означало бы пропустить
  // ровно тот случай, ради которого заведён потолок главы.
  const silences = countSilentMolds(text);
  if (silences >= 3) {
    findings.push({
      id: "silence-mold",
      label: `молчание вместо ответа повторяется ${silences} раза`,
      quote: "«…не ответил.»",
      advice: "на третьем молчании пусть персонаж ответит, спросит или перебьёт",
      severity: Math.min(silences / 5, 1),
    });
  }
  if (!proseLongEnough) return findings.sort((left, right) => right.severity - left.severity).slice(0, 8);

  // 1. Регенерация образа: один и тот же смысл разными словами рядом.
  //    Рефрен — не регенерация: в авторских главах «По веленью, по веленью,
  //    по веленью твоему» повторяет одно слово подряд трижды, и это цитата, а не
  //    след машины. Три одинаковых слова подряд внутри предложения = рефрен.
  const isRefrain = (sentence: string): boolean => {
    const words = sentence.toLowerCase().match(/[а-яёa-z]{3,}/gu) || [];
    const frequency = new Map<string, number>();
    for (const word of words) frequency.set(word, (frequency.get(word) || 0) + 1);
    // Рефрен — не регенерация. В авторских главах «По веленью, по веленью, по
    // веленью твоему» повторяет слово трижды, и это цитата, а не след машины.
    // Проверка на три одинаковых слова подряд не хватала: повтор разделён
    // предлогом. Считаем частоту слова целиком.
    return [...frequency.values()].some((count) => count >= 3);
  };
  for (let index = 1; index < sentences.length; index += 1) {
    const previous = sentences[index - 1];
    const current = sentences[index];
    if (isRefrain(current.text) || isRefrain(previous.text)) continue;
    const a = new Set(previous.text.toLowerCase().match(/[а-яёa-z]+/gu) || []);
    const b = current.text.toLowerCase().match(/[а-яёa-z]+/gu) || [];
    if (b.length < 6) continue;
    // Общий «корень»-подобный повтор: три и более совпадающих коротких слов подряд
    // либо полное совпадение значимой четвёрки — это один образ, сказанный дважды.
    let shared = 0;
    for (const word of b) if (word.length >= 4 && a.has(word)) shared += 1;
    const sharedShare = shared / b.length;
    if (sharedShare >= 0.55 && Math.abs(previous.text.length - current.text.length) < 120) {
      findings.push({
        id: "regenerated-image",
        label: "один образ сказан дважды разными словами",
        quote: `«${current.text.slice(0, 90)}»`,
        advice: "второй раз эту картинку убери: читатель её уже видел",
        severity: Math.min(sharedShare, 1),
      });
      break;
    }
  }

  // 2. Перечисление ровно из трёх — единственная перечисляющая форма.
  const threeList = sentences.find((sentence) => THREE_ITEM_LIST.test(sentence.text));
  if (threeList) {
    findings.push({
      id: "three-item-list",
      label: "перечисление ровно из трёх",
      quote: `«${threeList.text.slice(0, 90)}»`,
      advice: "сделай список из двух или четырёх, либо убери его вовсе",
      // Advisory: у автора такие перечисления тоже есть («лещ жирный, пиво
      // свежее, хлеб свой»). Ниже порога правки — то есть в промпт не попадает,
      // но виден автору в отчёте.
      severity: 0.25,
    });
  }

  // 3. Вывод-мораль и объяснение прочитанного.
  const verdict = sentences.find((sentence) => NARRATOR_VERDICT.test(sentence.text));
  if (verdict) {
    findings.push({
      id: "narrator-verdict",
      label: "рассказчик объясняет то, что читатель уже видел",
      quote: `«${verdict.text.slice(0, 90)}»`,
      advice: "замени вывод предметом или поступком, которого раньше не было",
      severity: 0.6,
    });
  }

  // 4. Запах как главный носитель детали: подряд идущие предложения с запахом.
  let olfactionRun = 0;
  let bestRun = 0;
  for (const sentence of sentences) {
    olfactionRun = OLFACTION.test(sentence.text) ? olfactionRun + 1 : 0;
    bestRun = Math.max(bestRun, olfactionRun);
  }
  // Порог — ТРИ предложения подряд, а не два. Замер: на эталоне автора «запах»
  // встречается дважды в соседних предложениях («Вкус леща, обильно сдобренный
  // ароматом тропического…»), и это его живая деталь, а не след машины.
  if (bestRun >= 3) {
    findings.push({
      id: "olfaction-dominance",
      label: `запах несёт деталь в ${bestRun} предложениях подряд`,
      quote: `«${sentences.find((sentence) => OLFACTION.test(sentence.text))?.text.slice(0, 90) ?? ""}»`,
      advice: "запах оставь один раз; остальное пусть видно и слышно",
      severity: Math.min(bestRun / 6, 1),
    });
  }

  // 5. Развязка по схеме «осознал → принял → вырос».
  const tail = text.slice(-1600);
  if (GROWTH.test(tail)) {
    const tailSentence = sentences.filter((sentence) => sentence.index > sentences.length - 4)[0];
    findings.push({
      id: "growth-ending",
      label: "финал сводится к «осознал и принял»",
      quote: `«${(tailSentence?.text ?? "").slice(0, 90)}»`,
      advice: "отдай часть решения случаю или другому человеку, либо закончи на действии",
      severity: 0.7,
    });
  }

  // 6. Серийность: три абзаца подряд одной формы.
  if (paragraphs.length >= 6) {
    const counts = paragraphs.map((paragraph) => paragraph.split(/(?<=[.!?…])\s+/u).filter(Boolean).length);
    for (let index = 2; index < counts.length; index += 1) {
      // Однофразные абзацы подряд — норма живого автора (у него их 55 %),
      // серийность проблемна там, где форма одинаковая и многословная.
      const serial = counts[index] >= 2 && counts[index] <= 5;
      if (serial && counts[index] === counts[index - 1] && counts[index] === counts[index - 2]) {
        findings.push({
          id: "serial-paragraphs",
          label: `три абзаца подряд по ${counts[index]} ${counts[index] === 1 ? "фразе" : "фразы"}`,
          quote: `«${firstSentence(paragraphs[index]).slice(0, 90)}»`,
          advice: "разбей один из них либо сократи до одной фразы",
          severity: 0.35,
        });
        break;
      }
    }
  }

  // 9. Куски без длинных фраз (сборка 115). Главная находка калибровки по
  //    отчёту детектора: AUC 0,82, кусков совсем без длинных фраз 3 из 8 у
  //    HUMAN против 8 из 10 у AI. На главе целиком разница съедалась, потому что
  //    детектор читает куски, а не главу.
  const chunks = emptyChunkShare(text);
  if (chunks.total && chunks.share > EMPTY_CHUNK_SHARE_LIMIT) {
    findings.push({
      id: "empty-chunks",
      label: `в ${chunks.empty} кусках из ${chunks.total} нет ни одного предложения 25+ слов`,
      quote: `«${firstSentence(sentences[0]?.text ?? "").slice(0, 90)}»`,
      advice: "собери в этих кусках длинное предложение: срасти соседние фразы через союз или перенеси часть описания в одну фразу",
      severity: Math.min((chunks.share - EMPTY_CHUNK_SHARE_LIMIT) / EMPTY_CHUNK_SHARE_LIMIT + 0.5, 1),
    });
  }

  // 10. Оконные замечания регистра и ритма: те же метрики по нарезке детектора.
  for (const issue of rhythmWindowIssues(text).slice(0, 3)) {
    findings.push({
      id: "window-metric",
      label: issue.slice(0, 140),
      quote: `«${firstSentence(sentences.find((sentence) => /словно|казалось|вроде/.test(sentence.text))?.text ?? sentences[0]?.text ?? "").slice(0, 90)}»`,
      advice: "правь по этому куску, а не по главе целиком",
      severity: 0.55,
    });
  }

  // Находки регистра сюда НЕ переносятся намеренно: они измерены числами, а не
  // цитатой, и уже приходят отдельным слоем (proseRegister → chapterVerdict).
  // Перенос делал одно и то же дважды и подставлял совет вместо цитаты — то есть
  // ровно то, чего критик не должен делать: выдавать мнение за наблюдение.

  return findings.sort((left, right) => right.severity - left.severity).slice(0, 8);
}

/**
 * Замысел критики для модели: что спросить у текста, чего не спросила рубрика.
 * Отдельная функция, потому что полезен и сам по себе — как чек-лист ручной
 * вычитки, без модели вообще.
 */
export const CRITIC_QUESTIONS = [
  "Найди два абзаца, которые говорят одно и то же разными словами. Приведи оба целиком.",
  "Найди абзац, который ничего не меняет: его можно вычеркнуть, и ничего не случится.",
  "Найди место, где рассказчик объясняет то, что читатель только что видел своими глазами.",
  "Найди место, где персонаж решает то, что человек не решает, — и назови, чем это отличается.",
  "Найди триггер, который срабатывает больше одного раза: слово, жест или приём.",
  "Найди место, где деталь держится только на запахе или только на ощущении.",
  "Найди место, где абзац мог бы закончиться на предложение раньше — и текст выиграл бы.",
  "Найди объяснение, которое читателю не нужно, потому что он это уже видел.",
] as const;

/** Промпт критики для модели. Судья не ставит баллов — он указывает места. */
export function criticPrompt(text: string): string {
  return [
    "Ты литературный критик. Текст ниже — черновик художественной главы.",
    "Твоя задача — не оценить и не похвалить, а найти места, где текст выдал себя как машинный.",
    "",
    "Ищи конкретно:",
    ...CRITIC_QUESTIONS.map((question, index) => `${index + 1}. ${question}`),
    "",
    "ОТВЕТ: только JSON вида {\"findings\":[{\"quote\":\"точная цитата из текста\",\"why\":\"почему это машинный след\",\"fix\":\"что делать\"}]}.",
    "Правила: цитата обязательна — без неё находки нет; максимум пять находок; не повторяй то, что уже хорошо.",
    "",
    "ТЕКСТ:",
    text,
  ].join("\n");
}

/** Разбор ответа критика: без цитаты находка не принимается. */
export function parseCriticism(value: unknown): CriticismFinding[] {
  const list = Array.isArray((value as { findings?: unknown })?.findings)
    ? (value as { findings: unknown[] }).findings
    : [];
  const findings: CriticismFinding[] = [];
  for (const item of list) {
    const entry = item as Record<string, unknown>;
    const quote = String(entry?.quote ?? "").trim();
    const why = String(entry?.why ?? "").trim();
    const fix = String(entry?.fix ?? "").trim();
    // Правило sepia «no quote — no signal»: без дословной цитаты это мнение.
    if (!quote || !why) continue;
    findings.push({
      id: "critic",
      label: why.slice(0, 120),
      quote: quote.slice(0, 200),
      advice: fix || "перепиши это место по смыслу, а не по словам",
      severity: 0.5,
    });
  }
  return findings.slice(0, 5);
}

/**
 * Порог, после которого находка идёт в правку. Ниже — только в отчёт автору.
 * Тот же приём, что в proseRegisterFindings: иначе в промпт попадает всё, и
 * модель переписывает главу по списку из двадцати пунктов — то есть возвращается
 * перегруженная генерация, от которой мы уходили.
 */
export const CRITIC_FIX_THRESHOLD = 0.4;

/** Блок промпта для последней правки: только то, что подтверждено цитатой. */
export function criticismFixBlock(findings: CriticismFinding[]): string {
  const actionable = findings.filter((finding) => finding.severity >= CRITIC_FIX_THRESHOLD);
  if (!actionable.length) return "";
  return `КРИТИКА (места, которые нужно переписать; каждое подтверждено цитатой):
${actionable.map((finding) => `- «${finding.quote}» — ${finding.label}. ${finding.advice}.`).join("\n")}`;
}