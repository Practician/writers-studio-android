import { Chapter, Story } from "../types";

/** Номер главы из title («Глава 7…», «7. …») или id (`lab-ch-7`). */
export function chapterOrdinal(titleOrId: string, id?: string): number | null {
  if (id) {
    const fromId =
      id.match(/lab-ch-(\d+)/i) ||
      id.match(/(?:^|[-_])ch(?:apter)?[-_]?(\d+)$/i);
    if (fromId) {
      const value = Number(fromId[1]);
      if (Number.isSafeInteger(value) && value > 0) return value;
    }
  }
  const title = titleOrId || "";
  const match =
    title.match(/(?:глава|chapter)\s*(\d+)/iu) ||
    title.match(/^\s*(\d{1,2})\s*[.:)\-–—]/u);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function findPreviousCanonChapter(chapters: Chapter[], current: Chapter): Chapter | null {
  const currentOrdinal = chapterOrdinal(current.title, current.id);
  if (currentOrdinal !== null) {
    const numbered = chapters
      .filter((chapter) => chapter.id !== current.id && chapter.content.trim())
      .map((chapter) => ({ chapter, ordinal: chapterOrdinal(chapter.title, chapter.id) }))
      .filter((entry): entry is { chapter: Chapter; ordinal: number } => entry.ordinal !== null && entry.ordinal < currentOrdinal)
      .sort((left, right) => right.ordinal - left.ordinal);
    if (numbered.length) return numbered[0].chapter;
  }

  const currentIndex = chapters.findIndex((chapter) => chapter.id === current.id);
  for (let index = currentIndex - 1; index >= 0; index -= 1) {
    if (chapters[index].content.trim()) return chapters[index];
  }
  return null;
}

/**
 * Якоря состояния из предыдущей главы — чтобы 7/8 не откатывали 2% и кольца.
 * Берём хвост + эвристики по %, еде, ладони, уровню.
 */
export function extractContinuityAnchors(previousText: string, previousTitle = ""): string {
  const text = (previousText || "").trim();
  if (!text) return "";
  const tail = text.slice(-2200);
  const lower = tail.toLocaleLowerCase("ru");
  const facts: string[] = [];

  const chargeMatches = [...tail.matchAll(/(?:заряд[^\n.%]{0,40}?|около\s+|примерно\s+)?(\d{1,3})\s*%/giu)];
  if (chargeMatches.length) {
    const last = chargeMatches[chargeMatches.length - 1][1];
    facts.push(`Заряд телефона на стыке: ~${last}% (не сбрасывать к 2–3% без новой причины).`);
  } else if (/\b20\s*%|двадцать\s+процент/i.test(tail)) {
    facts.push("Заряд телефона на стыке: ~20% (не сбрасывать к 2–3%).");
  }

  if (/голод\s+и\s+жажда\s+ушл|сыт|наелся|мятн|мёд|меда/i.test(lower)) {
    facts.push("Голод/жажда уже сняты (масса/еда была) — не голодать снова «с нуля».");
  }
  if (/кольц/i.test(lower) && (/погас|остыл|почти погас/i.test(lower) || /число\s*20/i.test(lower))) {
    facts.push("Кольца/число 20 уже отыграны — не решать головоломку колец заново с нуля.");
  }
  if (/не\s+сейчас|займусь.*готов|отпечаток/i.test(lower)) {
    facts.push("Отпечаток ладони виден; если не активирован в тексте — не «случайно уже открыт Ур.2» до синопсиса.");
  }
  if (/уровень\s*2|вход\s+на\s+уровень/i.test(lower)) {
    facts.push("Герой уже на/у входа Уровня 2 — не возвращать на Уровень 1 в темноту петли.");
  }
  if (/щель|проход/i.test(lower) && /закры|сошл/i.test(lower)) {
    facts.push("Обратный проход мог закрыться — не открывать «бесплатно» без причины.");
  }

  return [
    previousTitle ? `Стык после «${previousTitle}»:` : "Стык с предыдущей главой:",
    ...facts.map((f) => `- ${f}`),
    "Хвост предыдущей главы (факты и тон; не переписывать дословно):",
    `"""\n${tail}\n"""`,
  ].join("\n");
}

export function canonDossier(story: Story, current: Chapter, previous: Chapter | null): string {
  const localCanon = `${previous?.content ?? ""}\n${current.summary ?? ""}`.toLocaleLowerCase("ru");
  const characterLines = (story.characters ?? [])
    .filter((character) => character.name
      .toLocaleLowerCase("ru")
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length >= 3)
      .some((token) => localCanon.includes(token)))
    .map((character) => `${character.name}: ${character.role}; ${character.traits}; цель — ${character.goals}`)
    .join("\n");
  const continuity = previous?.content?.trim()
    ? extractContinuityAnchors(previous.content, previous.title)
    : "";
  return [
    `Текущая глава: ${current.title}.`,
    current.summary?.trim() ? `Обязательные события: ${current.summary.trim()}` : "",
    previous
      ? `Непосредственное продолжение: ${previous.title}. Не меняй героя, точку зрения, эпоху, экипировку и устройство мира относительно этого текста.`
      : "",
    continuity,
    characterLines ? `Персонажи книги:\n${characterLines}` : "",
  ].filter(Boolean).join("\n\n");
}
