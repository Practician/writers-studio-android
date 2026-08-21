/**
 * Канон «Лабиринт. Путь домой» — библия, план, правила и тексты,
 * которые уходят в generate_full_chapter через worldBible / bookPlan / summary / previousChapter.
 *
 * CANON_V: поднимать при смене стыков/механик (merge обновит story в localStorage).
 */
import type { AuthorProfileRecord, AuthorVoiceSheet, Character, Chapter, Story, WorldRule } from "../types";
import { chapterOrdinal } from "../lib/chapterContext";
import chapter1Text from "./labyrinth/chapter-1.content";
import chapter5Text from "./labyrinth/chapter-5.content";
import chapter6Text from "./labyrinth/chapter-6.content";
import chapter7Text from "./labyrinth/chapter-7.content";
import chapter8Text from "./labyrinth/chapter-8.content";

export const LABYRINTH_STORY_ID = "story-labyrinth";
/** v11: seed гл.7 maximum-human Yandex 0%; legacy check by ending not opening. */
export const LABYRINTH_CANON_VERSION = 11;
export const LABYRINTH_CANON_MARKER = `CANON_V${LABYRINTH_CANON_VERSION}_CH78_YANDEX0`;
/** Маркер образца автора: при смене версии канона профиль перезапишется, если не помечен user: */
export const LABYRINTH_AUTHOR_SAMPLE_MARKER = `labyrinth-canon-ch1-v${LABYRINTH_CANON_VERSION}`;

export function isLabyrinthStory(
  story: Pick<Story, "id" | "title"> & { chapters?: Chapter[] } | null | undefined,
): boolean {
  if (!story) return false;
  if (story.id === LABYRINTH_STORY_ID) return true;
  const title = story.title || "";
  if (/лабиринт/i.test(title) || /labyrinth/i.test(title)) return true;
  // эвристика: канон-id глав или типичные названия
  const chapters = story.chapters || [];
  if (chapters.some((c) => /^lab-ch-\d+/i.test(c.id || ""))) return true;
  if (
    chapters.some(
      (c) =>
        /число\s*20/i.test(c.title || "") ||
        /отпечаток\s+ладони/i.test(c.title || "") ||
        /первый\s+круг/i.test(c.title || ""),
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Восстановить слоты 1–9 и текст гл.5–6 в конкретной книге (даже если title не «Лабиринт»).
 * Вызывается кнопкой «Канон» / при merge.
 */
export function ensureLabyrinthChapterSlots(story: Story): Story {
  const seed = buildLabyrinthStory();
  const seedByOrdinal = new Map<number, Chapter>();
  for (const ch of seed.chapters) {
    const n = ordinalOf(ch);
    if (n != null) seedByOrdinal.set(n, ch);
  }

  const byOrdinal = new Map<number, Chapter>();
  const unnumbered: Chapter[] = [];
  for (const ch of story.chapters || []) {
    const n = ordinalOf(ch);
    if (n == null) {
      unnumbered.push(ch);
      continue;
    }
    const prev = byOrdinal.get(n);
    if (!prev || (ch.content || "").length > (prev.content || "").length) {
      byOrdinal.set(n, ch);
    }
  }

  const ordered: Chapter[] = [];
  const maxCanon = Math.max(0, ...seedByOrdinal.keys());
  for (let n = 1; n <= maxCanon; n++) {
    const canon = seedByOrdinal.get(n);
    if (!canon) continue;
    ordered.push(applyCanonChapter(byOrdinal.get(n), canon, n));
    byOrdinal.delete(n);
  }
  const extras = [...byOrdinal.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, ch]) => ch);

  return {
    ...story,
    chapters: [...ordered, ...extras, ...unnumbered],
    worldBible: story.worldBible?.includes(LABYRINTH_CANON_MARKER)
      ? story.worldBible
      : seed.worldBible,
    bookPlan: story.bookPlan?.includes(LABYRINTH_CANON_MARKER) ? story.bookPlan : seed.bookPlan,
    updatedAt: Date.now(),
  };
}

/** Короткие правила для WorldBuilder + склейки в worldBible. */
export const LABYRINTH_WORLD_RULES: WorldRule[] = [
  {
    id: "lr-level-1",
    title: "Уровень 1 — Темнота",
    content:
      "Абсолютная темнота, мягкие дымчатые стены, ровный пол. Опасности: дезориентация, жажда, голод, паника, разряд телефона. Функция телефона: тепловизор. Метки ключом загораются бледно-синим.",
  },
  {
    id: "lr-phone-charge",
    title: "Заряд и числа в воздухе",
    content:
      "Число над источником (напр. 20) — доступный ресурс. Может конвертироваться в % заряда телефона (20 → ~20%). Беспроводная зарядка: телефон на диск/узел у числа; число тает к 0, заряд растёт. Полный разряд = слепая зона (без тепловизора/карты позже).",
  },
  {
    id: "lr-food-mint",
    title: "Питательная масса (мята и мёд)",
    content:
      "Зелёная/дымчатая масса со вкусом мяты и мёда снимает голод и жажду. Это отдельный ресурс от числа-заряда: можно и поесть, и зарядить, если механика узла это позволяет. Запах мяты/мёда — маркер ресурса на расстоянии.",
  },
  {
    id: "lr-rings-puzzle",
    title: "Головоломка колец (гл. 6, канон)",
    content:
      "Три концентрических кольца, на каждом 12 секторов. Каждое кольцо вращается независимо по часовой или против. Сектора выравниваются относительно всей конструкции и друг друга (не «красивый узор»). Яркость висящего числа = близость к верной сборке (ближе — ярче, дальше — тусклее). Значение числа растёт к max 20 при хорошем соотношении и падает к 0 при ошибках. Цель: поймать яркую 20, затем забрать ресурс (еда/заряд). После съёма ресурса кольца могут «остыть» — разовый пакет.",
  },
  {
    id: "lr-continuity-5-6",
    title: "Стык глав 5→6 (обязательный)",
    content:
      "Конец 5: телефон ~2%, сильный голод и жажда; герой рвёт правило левой руки, чертит диагональный символ отмены (бледно-синий шрам), шагает в ТЕМНОТУ правого коридора на запах мяты и мёда. Начало 6: НЕ сыт, НЕ 20%, НЕ «Начну снова», НЕ «свет из ниоткуда». Сначала тьма и спуск; зеленоватое пятно вдали = число 20. Еда и 20% — награда после головоломки.",
  },
  {
    id: "lr-style",
    title: "Голос и повествование",
    content:
      "1 лицо, сухой инженерный тон, survival, стиль «дневник» (эталон: авторская глава 1). «Я» используется умеренно. Средняя фраза около 8 слов, примерно четверть фраз короткие; есть разговорные частицы, внутренние вопросы, восклицания и многоточия. Конкретика: %, жест, запах, сектор/кольцо — вместо абстрактных выводов. Без тройных петель «и что дальше?», без пафоса и штампов. Только русский. Образец стиля: глава 1 (authorSample).",
  },
  {
    id: "lr-style-patterns-ch6",
    title: "Паттерны стиля гл. 6 (для продолжения)",
    content:
      "Опора на текст Word «Глава 6. Число 20» (optimal): 1) Вход из стыка 5→6 — тьма, правый коридор, диагональ отмены, 2%, голод/жажда, запах мяты/мёда. 2) Механика: три кольца × 12, яркость = сборка, поймать яркую 20. 3) Ресурс: масса → сытость; телефон на диск → число тает, заряд ~20%. 4) Финал: отпечаток ладони ВИДЕН, НЕ активирован («Не сейчас… им займусь, когда буду готов»). 5) Ритм: абзацы ~40–80 слов, внутренний монолог без лекций читателю. 6) Дальше (гл.7+): тот же голос и конкретика; не откатывать заряд к 2% и не решать кольца заново с нуля.",
  },
  {
    id: "lr-detector-yandex",
    title: "Нейродетектор (Yandex) — стиль",
    content:
      "Цель: HUMAN-сегменты, не телеграф и не UI-лог. Связная проза + бытовые мысли. Один проход сцены. Конкретика (жест, заряд %, запах) вместо «приближаюсь к пониманию». Не цепочки «1. метка 2. метка», не CW/CCW/NFC-латиница, не спам «не найдено: N». Локальная калибровка сравнивает ритм и голос с авторской главой 1, которая получила 100% HUMAN в Yandex; внешний балл остаётся лишь контрольным измерением.",
  },
  {
    id: "lr-palm-ch7",
    title: "Отпечаток ладони (крючок гл. 7)",
    content:
      "Стык с концом 6: 20%, сытость, «не сейчас», кольца погасли. Одна сцена: сон (институт → дом/мама → сон во сне) → явь → телефон к отпечатку → точки жестом (без квест-лога) → ритм → двойная ладонь (янтарь) → щель Ур.2. Карта/датчики/обход — гл.8+. Не 2%. Не кольца с нуля. Не переигрывать «Число 20».",
  },
  {
    id: "lr-continuity-7-8",
    title: "Стык глав 7→8 (обязательный)",
    content:
      "Конец 7: щель/коридор Ур.2, «Уровень 2» на стене, ~20%, проход мог закрыться. Начало 8: УЖЕ на Ур.2 — зелёные риски, развилки, метки, карта/датчики. НЕ сон, НЕ ладонь, НЕ кольца, НЕ 2%.",
  },
  {
    id: "lr-style-patterns-ch7",
    title: "Паттерны стиля гл. 7 (одна сцена, анти-UI)",
    content:
      "1) Стык 6→7: 20%, «не сейчас», сон у стены. 2) Сон короткий, дневник, не новелла. 3) Явь: тело + телефон + ошибка ритма + 2-й слой. 4) Финал: шаг в щель, «Уровень 2» на стене, крючок — без длинного обхода. 5) Голос гл.6: «подумал», жест, %; без «1. 2. 3.», без спама счётчика, без CW/CCW.",
  },
  {
    id: "lr-resource-choice",
    title: "Правило: ресурс — это выбор",
    content:
      "Еда, вода, заряд, сон, безопасность ограничены. Поздние узлы могут требовать выбрать: съесть массу ИЛИ зарядить телефон. На узле «Число 20» (гл. 6) канонично доступны оба: сначала масса, затем конвертация числа в заряд.",
  },
];

export const LABYRINTH_WORLD_BIBLE = `${LABYRINTH_CANON_MARKER}

БИБЛИЯ МИРА — «Лабиринт. Путь домой» (рабочий канон приложения)

ЖАНР И ТОН
Попаданство, техно-мистика, survival, психологический триллер. Сначала: один человек, темнота, разряжающийся телефон. Мир ведёт себя как система, но без прямой «игровой» UI-болтовни. Герой — студент, технический склад ума, ирония в стрессе, ошибки и паника допустимы.

ГЕРОЙ
Один. Экипировка: футболка, джинсы, кроссовки, связка ключей, смартфон. Нет других людей до встреч по плану (гл. 20+). Тон: 1 лицо.

ЛАБИРИНТ — УРОВЕНЬ 1
Темнота, мягкие дымчатые стены, чёрный ровный пол. Опасности: дезориентация, жажда, голод, паника, 2–3% заряда. Метки ключом — бледно-синие. Правило левой руки работает, пока Лабиринт не загонит в петлю; ломать шаблон — осознанный выбор (символ отмены).

ТЕЛЕФОН
Уровень 1: тепловизор; нет связи/интернета/фонарика. Заряд — критический ресурс. Источники: числа в воздухе, узлы, станции. Число N ≈ до N% заряда при конвертации.

РЕСУРС «ЧИСЛО 20» И КОЛЬЦА (канон гл. 6)
Тупик ~2×2 м. В воздухе зеленоватое число (max 20). На полу: 3 концентрических кольца × 12 секторов; вращение независимое, CW/CCW. Яркость числа = качество сборки; значение 0…20. Поймать яркую 20 → питательная мятно-медовая масса (голод/жажда) + заряд телефона до ~20% (число тает). Отпечаток ладони — только в конце, без активации.

СТЫК 5→6
5 заканчивается: 2%, жажда/голод, диагональ отмены, шаг в правый тёмный коридор к мяте/мёду.
6 начинается из этой тьмы; «свет» = появление числа, не лампочка из ниоткуда.

УРОВЕНЬ 2+ (кратко)
Карта, датчики, давление, магнит, скрытые закладки, комнаты выбора, следы чужих, попутчики, петли, автосохранение — по плану книги. Не раскрывать полную правду Лабиринта в первой книге.

ПРАВИЛА
1) У каждого уровня есть выход. 2) Простой путь ≠ правильный. 3) Ресурс — выбор. 4) Телефон открывает функции за действие. 5) Лабиринт запоминает. 6) Смерть позже может быть не концом. 7) Дом существует, но путь к нему — через систему.

ЯЗЫК
Зелёный — ресурс/заряд. Синий — метки/информация. Числа, запахи, вибрации телефона — речь Лабиринта.

${LABYRINTH_WORLD_RULES.map((r) => `[${r.title}]\n${r.content}`).join("\n\n")}
`;

export const LABYRINTH_BOOK_PLAN = `${LABYRINTH_CANON_MARKER}

ПЛАН КНИГИ — «Лабиринт. Путь домой»

АКТ 1. ПОПАДАНИЕ
1. Загрузка завершена — гроза, «Загрузка завершена», темнота.
2. Уровень 1 — приход в себя, экипировка, надпись «Уровень 1».
3. Тепловизор — единственная функция, низкий заряд.
4. Правило левой руки — метки ключом, обход.
5. Первый круг — петля, жажда/голод, 2–3% заряда; отказ от левой руки; символ отмены; шаг в правый коридор (мята/мёд).
6. Число 20 — спуск в тьме; узел с числом; ГОЛОВОЛОМКА: 3 кольца × 12 секторов, независимое вращение; яркость и значение 0…20; поймать яркую 20; еда; заряд → 20%; отпечаток ладони (не активировать).
7. Отпечаток ладони — активация следа, кольца/линии перехода, Уровень 2.

АКТ 2. ПЕРВЫЕ ПРАВИЛА
8. Уровень 2 — карта и датчики, шаги в статусе.
9. Карта — пропущенная скрытая закладка.
10. Датчики — магнитометр, барометр и др.
11. Полосы на стенах — зоны без экрана.
12. Магнитная ловушка — металл/ключи/телефон.
13. Давление — барометр, герметизация.
14. Первая скрытая закладка — «Журнал», запись «Ты уже выбирал не туда».

АКТ 3–7 — по полной библии: комнаты выбора, чужой почерк, голоса, кровь, встреча, союз, конкуренты, смерть/респаун, петли, ложный выход, «Маршрут домой 1%», крючок на кн. 2.

КАНОН-ОГРАНИЧЕНИЯ ДЛЯ ГЕНЕРАЦИИ
- Не ломать стык 5→6 и механику колец гл. 6.
- Не открывать карту/датчики до гл. 7–8.
- Не вводить других людей до плана встречи.
- Не повторять одну сцену трижды. «Я» умеренно (дневник), не телеграф без «я».
- Без «Начну снова» и без случайных часов на экране (3:47 и т.п.), если не канон.
- Синопсис главы (summary) — обязательные события; previousChapter — хвост для стыка.
- Стиль под Yandex: см. правило «Нейродетектор» и humanStyleDirectives.YANDEX_DETECTOR_STYLE.
`;

export const LABYRINTH_CHARACTER: Character = {
  id: "char-labyrinth-hero",
  name: "Герой (студент)",
  role: "Протагонист",
  traits: "Ироничный в стрессе, аналитик, не геройствует зря, ошибается и злится, технический склад ума",
  goals: "Выжить, сохранить заряд телефона, понять правила Лабиринта, найти путь домой",
  description:
    "Студент 20–25 лет. Футболка, джинсы, кроссовки, связка ключей, смартфон с тепловизором. Один на Уровне 1. Имя в тексте может не называться — повествование от 1 лица.",
};

/**
 * Образец голоса для humanize / generate: авторская глава 1, подтверждённая
 * внешней проверкой как 100% HUMAN. Это стилевой эталон, а не сюжетная подсказка.
 */
export const LABYRINTH_AUTHOR_SAMPLE: string = chapter1Text.trim();

export const LABYRINTH_STYLE_DESCRIPTION =
  "Голос канона «Лабиринт» по авторской главе 1: первое лицо, дневник инженера-студента в survival. Средняя фраза около 8 слов, заметный разброс длины, примерно четверть коротких фраз; разговорные частицы, вопросы к себе, восклицания и многоточия. Конкретика (заряд %, запах, ключи), бытовая ирония, без литературного пафоса.";

export const LABYRINTH_PROTECTED_TERMS = [
  "тепловизор",
  "Уровень 1",
  "Уровень 2",
  "Лабиринт",
  "мята",
  "мёд",
  "меда",
  "число 20",
  "20%",
  "отпечаток ладони",
  "правило левой руки",
  "кольца",
];

/** Паспорт голоса по авторской главе 1 — для generate/humanize и локальной калибровки. */
export const LABYRINTH_VOICE_SHEET: AuthorVoiceSheet = {
  summary:
    "Повествование от первого лица: студент думает вслух, считает ресурсы, ошибается, злится и шутит в стрессе. Ритм неровного личного дневника: длинное наблюдение сменяется короткой мыслью, вопросом или восклицанием.",
  voiceRules: [
    "Первое лицо; допускай пропуск «я» в деепричастных и бытовых фразах, как в главе 1.",
    "Конкретика: проценты заряда, запахи (мята/мёд), жесты (ключ, ладонь, кольца), размеры (~2×2 м).",
    "Внутренний монолог в кавычках: вопросы к себе, «однако», «ну», «вот»; без лекций читателю.",
    "Ориентир ритма главы 1: средняя фраза ~8 слов, разброс ~5 слов, коротких фраз ~23%.",
    "На тысячу слов естественно встречаются примерно 8 восклицаний, 11 многоточий и 13 разговорных частиц — не вставляй их механически.",
    "Механики описывай через пробу героя (крутил — ярче/тусклее), не через энциклопедию мира.",
    "Стык с прошлой главой: не сбрасывай голод/заряд/локацию без причины.",
    "Крючки оставляй открытыми (отпечаток есть — активация позже), не закрывай всё в одной главе.",
  ],
  avoid: [
    "Начну снова",
    "случайные часы на экране (3:47 и т.п.)",
    "тройные петли «и что дальше?» / повтор одной сцены",
    "телеграф без «я» на весь текст",
    "штампы: волна ужаса, холодок по спине, воздух сгустился",
    "откат канона: снова 2% и кольца с нуля после уже снятого ресурса",
    "активация отпечатка ладони до главы 7",
    "другие люди на Уровне 1",
  ],
  evidence: [
    {
      quote: "Ну, чтож. Темно, тепло и мухи не кусают.",
      observation: "Бытовая ирония и частицы внутри напряжённой сцены.",
    },
    {
      quote: "Хотел ведь зарядить перед лекциями, но забегался и забыл.",
      observation: "Характер раскрывается через конкретную бытовую ошибку.",
    },
    {
      quote: "Подкормились. Крыса дошла до конца лабиринта и получила вкусняшку.",
      observation: "Самоирония короткой внутренней репликой после действия.",
    },
  ],
};

/** Профиль автора для IndexedDB: образец = авторская глава 1. */
export function buildLabyrinthAuthorProfile(now = Date.now()): AuthorProfileRecord {
  return {
    storyId: LABYRINTH_STORY_ID,
    sample: LABYRINTH_AUTHOR_SAMPLE,
    sampleFileName: LABYRINTH_AUTHOR_SAMPLE_MARKER,
    styleDescription: LABYRINTH_STYLE_DESCRIPTION,
    protectedTerms: [...LABYRINTH_PROTECTED_TERMS],
    voiceSheet: LABYRINTH_VOICE_SHEET,
    updatedAt: now,
  };
}

/**
 * Нужно ли обновить профиль автора каноном.
 * Не трогаем, если пользователь явно загрузил свой образец (sampleFileName начинается с user:).
 */
export function shouldSeedLabyrinthAuthorProfile(
  existing: AuthorProfileRecord | undefined | null,
): boolean {
  if (!existing) return true;
  const name = (existing.sampleFileName || "").trim();
  if (name.startsWith("user:")) return false;
  if (name === LABYRINTH_AUTHOR_SAMPLE_MARKER && (existing.sample || "").trim().length >= 300) {
    return false;
  }
  // старый канон-маркер / пустой образец → обновить
  if (!name || name.startsWith("labyrinth-canon") || (existing.sample || "").trim().length < 300) {
    return true;
  }
  // чужой/неизвестный файл — не затирать
  return false;
}

function chapter(
  id: string,
  title: string,
  summary: string,
  content = "",
): Chapter {
  return { id, title, summary, content };
}

/** Синопсисы 1–7: summary уходит в generate как currentChapterSummary / канон. */
export function buildLabyrinthChapters(): Chapter[] {
  return [
    chapter(
      "lab-ch-1",
      "Глава 1. Загрузка завершена",
      "Возвращение с ВУЗа, гроза, вибрация телефона, надпись «Загрузка завершена», вспышка, темнота.",
    ),
    chapter(
      "lab-ch-2",
      "Глава 2. Уровень 1",
      "Приход в себя в темноте. Футболка, джинсы, кроссовки, ключи, телефон. На экране «Уровень 1». Обычные функции мертвы.",
    ),
    chapter(
      "lab-ch-3",
      "Глава 3. Тепловизор",
      "Единственная функция — тепловизор. Коридоры, дымчатые стены, тупик. Нужно двигаться. Заряд низкий.",
    ),
    chapter(
      "lab-ch-4",
      "Глава 4. Правило левой руки",
      "Обход вдоль левой стены, метки ключом (синие). Лабиринт кажется плоским — пока.",
    ),
    chapter(
      "lab-ch-5",
      "Глава 5. Первый круг",
      "Петля, жажда, голод, заряд 3%→2%. Отказ от правила левой руки. Диагональный символ отмены на стене (бледно-синий). Шаг в ТЕМНОТУ правого коридора на запах мяты и мёда. КОНЕЦ: не сыт, не 20%.",
      chapter5Text.trim(),
    ),
    chapter(
      "lab-ch-6",
      "Глава 6. Число 20",
      "СТЫК: продолжение шага в правый тёмный коридор (2%, голод, жажда). Спуск; вдали зеленоватое пятно = число 20, не «лампочка». Тупик: ёмкость с мятно-медовой массой + 3 кольца × 12 секторов (независимо CW/CCW). Яркость = сборка; значение 0…20; поймать яркую 20. Ест — голод/жажда уходят. Телефон на диск — число тает, заряд → 20%. Отпечаток ладони обнаружен, НЕ активирован. Без повторов сцен. 1 лицо, «я» умеренно (дневник, не телеграф). Без часов на экране.",
      chapter6Text.trim(),
    ),
    chapter(
      "lab-ch-7",
      "Глава 7. Отпечаток ладони",
      "ОДНА СЦЕНА (как гл.6): ~20%, сытость; сон у стены (институт-загадка → дом/мама/зачёт → сон во сне → явь). Телефон к отпечатку → новая метка; точки у колец/чаши/стены жестом (без нумерованного лога); ошибка ритма → верный ритм → двойная ладонь (янтарь) → щель; шаг на Ур.2; крючок. Без длинного обхода, без карты/датчиков. Не 2%. Не кольца с нуля.",
      chapter7Text.trim(),
    ),
    chapter(
      "lab-ch-8",
      "Глава 8. Уровень 2",
      "СТЫК с концом 7: уже за щелью, «Уровень 2» на стене, ~20%, кольца/ладонь позади (проход мог закрыться). НЕ сон, НЕ активация ладони, НЕ кольца с нуля, НЕ 2%. Сцена: зелёные риски, развилки, первые метки ключом/телефоном, появление карты и датчиков (шаги/статус), диск-якорь или узел. Крючок на скрытую закладку/пропуск. 1 лицо, голос гл.6–7.",
      chapter8Text.trim(),
    ),
    chapter(
      "lab-ch-9",
      "Глава 9. Карта",
      "Карта пройденного; осознание пропущенной скрытой закладки.",
    ),
  ];
}

export function buildLabyrinthStory(now = Date.now()): Story {
  return {
    id: LABYRINTH_STORY_ID,
    title: "Лабиринт. Путь домой",
    genre: "психологический триллер / survival / техно-мистика",
    description:
      "Студент в многоуровневом Лабиринте. Телефон — якорь и интерфейс системы. Уровень 1: темнота, тепловизор, ресурсы-числа, кольца.",
    updatedAt: now,
    characters: [LABYRINTH_CHARACTER],
    chapters: buildLabyrinthChapters(),
    worldRules: LABYRINTH_WORLD_RULES,
    bookPlan: LABYRINTH_BOOK_PLAN,
    worldBible: LABYRINTH_WORLD_BIBLE,
  };
}

function ordinalOf(ch: Chapter): number | null {
  return chapterOrdinal(ch.title, ch.id);
}

/**
 * Сохранять ли текст пользователя вместо seed.
 * - пусто / короткий черновик / старый stub → seed (для 5–7 с готовым каноном)
 * - substantive ручная правка (≠ seed, ≥600 знаков) → KEEP
 */
export function shouldKeepUserChapterContent(
  existingContent: string | undefined,
  canonContent: string | undefined,
  options?: { minKeepChars?: number },
): boolean {
  const user = (existingContent || "").trim();
  const seed = (canonContent || "").trim();
  if (!user) return false;
  if (seed && user === seed) return true; // already seed
  const minKeep = options?.minKeepChars ?? 600;
  if (user.length < minKeep) return false;
  // Явно «битый» короткий канон-стаб: не держим
  if (/^начну снова/i.test(user) && user.length < 1200) return false;
  return true;
}

function applyCanonChapter(existing: Chapter | undefined, canon: Chapter, n: number): Chapter {
  if (!existing) {
    return { ...canon };
  }

  // 5–6: title/summary из канона. Content: substantive user KEEP; empty/stub → seed.
  if (n === 5 || n === 6) {
    const keep = shouldKeepUserChapterContent(existing.content, canon.content);
    return {
      ...existing,
      id: existing.id || canon.id,
      title: canon.title,
      summary: canon.summary,
      content: keep ? (existing.content || "") : (canon.content || existing.content || ""),
    };
  }
  // 7–8: title/summary канона; пустой content → seed; legacy seed endings → refresh;
  // любая иная непустая правка KEEP (в т.ч. короткий черновик).
  // ВАЖНО: проверяем КОНЕЦ текста, а не начало — иначе затирает правки пользователя.
  if (n === 7 || n === 8) {
    const user = (existing.content || "").trim();
    const seed = (canon.content || "").trim();
    // Legacy endings: старые seed-версии, которые нужно обновить
    const legacyEndings = [
      "Мужики направо не ходят!",
      "Мужики направо не ходят)))",
      "Хоть что-то своё.",
    ];
    const looksLikeLegacySeed = legacyEndings.some((ending) => user.endsWith(ending))
      && user.length < seed.length * 1.2; // не затираем, если пользователь сильно расширил
    let content = user;
    if (!user) content = seed;
    else if (user === seed) content = seed;
    else if (looksLikeLegacySeed) content = seed; // v9→v10: обновить seed в приложении
    return {
      ...existing,
      id: existing.id || canon.id,
      title: canon.title,
      summary: canon.summary,
      content: content || seed || "",
    };
  }

  // 1–4, 9+: title/summary канона если пусто; content не трогаем
  return {
    ...existing,
    id: existing.id || canon.id,
    title: existing.title?.trim() ? existing.title : canon.title,
    summary: existing.summary?.trim() ? existing.summary : (canon.summary || existing.summary || ""),
    content: existing.content || "",
  };
}

/**
 * Влить/обновить канон Лабиринта в список stories (localStorage).
 * - нет story → prepend seed
 * - есть → bible/plan/rules; гл.5–6 content; слоты 1–9 по порядку; удалённые главы восстанавливаются
 */
export function mergeLabyrinthCanonIntoStories(stories: Story[]): Story[] {
  const seed = buildLabyrinthStory();
  const list = Array.isArray(stories) ? [...stories] : [];
  const idx = list.findIndex((s) => isLabyrinthStory(s));

  if (idx < 0) {
    return [seed, ...list];
  }

  const existing = list[idx];
  const already =
    typeof existing.worldBible === "string" &&
    existing.worldBible.includes(LABYRINTH_CANON_MARKER);

  const withSlots = ensureLabyrinthChapterSlots(existing);

  // world rules: заменить/добавить по id канона
  const ruleMap = new Map((existing.worldRules || []).map((r) => [r.id, r]));
  for (const r of seed.worldRules) ruleMap.set(r.id, r);
  const rules = [...ruleMap.values()];

  list[idx] = {
    ...withSlots,
    id: existing.id || LABYRINTH_STORY_ID,
    title: existing.title || seed.title,
    genre: existing.genre || seed.genre,
    description: existing.description || seed.description,
    worldBible: seed.worldBible,
    bookPlan: seed.bookPlan,
    worldRules: rules,
    characters:
      existing.characters?.length > 0
        ? existing.characters.some((c) => c.id === LABYRINTH_CHARACTER.id)
          ? existing.characters.map((c) =>
              c.id === LABYRINTH_CHARACTER.id ? LABYRINTH_CHARACTER : c,
            )
          : [LABYRINTH_CHARACTER, ...existing.characters]
        : seed.characters,
    // always bump when marker changes so localStorage rewrite is obvious
    updatedAt: already ? withSlots.updatedAt : Date.now(),
  };

  return list;
}
