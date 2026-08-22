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
import fb2Chapter1 from "./labyrinth/fb2-import/chapter-1.fb2.content";
import fb2Chapter2 from "./labyrinth/fb2-import/chapter-2.fb2.content";
import fb2Chapter3 from "./labyrinth/fb2-import/chapter-3.fb2.content";
import fb2Chapter4 from "./labyrinth/fb2-import/chapter-4.fb2.content";
import fb2Chapter5 from "./labyrinth/fb2-import/chapter-5.fb2.content";
import fb2Chapter6 from "./labyrinth/fb2-import/chapter-6.fb2.content";
import fb2Chapter7 from "./labyrinth/fb2-import/chapter-7.fb2.content";
import fb2Chapter8 from "./labyrinth/fb2-import/chapter-8.fb2.content";
import fb2Chapter9 from "./labyrinth/fb2-import/chapter-9.fb2.content";
import fb2Chapter10 from "./labyrinth/fb2-import/chapter-10.fb2.content";
import fb2Chapter11 from "./labyrinth/fb2-import/chapter-11.fb2.content";
import USER_WORLD_BIBLE from "./labyrinth/world-bible-user.content";
import USER_BOOK_PLAN from "./labyrinth/book-plan-20-user.content";

export const LABYRINTH_STORY_ID = "story-labyrinth";
/** v13: встроен пользовательский план на 20 глав, Библия мира и готовые тексты глав 1–11 из FB2. */
export const LABYRINTH_CANON_VERSION = 13;
export const LABYRINTH_CANON_MARKER = `CANON_V${LABYRINTH_CANON_VERSION}_USER_PLAN20_SECTORS`;
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
 * Восстановить слоты 1–20 и текст гл.5–6 в конкретной книге (даже если title не «Лабиринт»).
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

${USER_WORLD_BIBLE.trim()}`;

export const LABYRINTH_BOOK_PLAN = `${LABYRINTH_CANON_MARKER}

${USER_BOOK_PLAN.trim()}`;

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

/** Точные синопсисы 1–20 из пользовательского плана; каждый уходит в generate как currentChapterSummary. */
export function buildLabyrinthChapters(): Chapter[] {
  return [
    chapter("lab-ch-1", "Глава 1. Загрузка завершена", "Герой возвращается с вечернего отделения ВУЗа. Гроза, дождь, молния, вибрация телефона. На экране: «Загрузка завершена». Вспышка. Темнота.", fb2Chapter1.trim()),
    chapter("lab-ch-2", "Глава 2. Сектор 1", "Герой приходит в себя в абсолютной темноте. Ощупывает себя: футболка, джинсы, кроссовки, ключи, телефон. Телефон показывает «Сектор 1». Обычные функции не работают.", fb2Chapter2.trim()),
    chapter("lab-ch-3", "Глава 3. Тепловизор", "Герой открывает единственную функцию телефона — тепловизор. Видит коридоры, мягкие дымчатые стены, тупик за спиной. Понимает, что надо двигаться. Заряд телефона низкий.", fb2Chapter3.trim()),
    chapter("lab-ch-4", "Глава 4. Правило левой руки", "Герой решает идти вдоль левой стены. Делает первую метку ключом. Начинает понимать, что лабиринт двумерный только на первый взгляд.", fb2Chapter4.trim()),
    chapter("lab-ch-5", "Глава 5. Первый круг", "Герой возвращается к своему ключу и понимает, что ходит кругами. У него растёт жажда, голод и тревога. Он выбирает последний неисследованный коридор.", fb2Chapter5.trim()),
    chapter("lab-ch-6", "Глава 6. Число 20", "Герой находит тупик с зелёным числом 20 и странной питательной массой. Масса пахнет мятой и мёдом. Он ест её и восстанавливает силы. Затем понимает, что это ещё и источник заряда.", fb2Chapter6.trim()),
    chapter("lab-ch-7", "Глава 7. Отпечаток ладони", "Герой заряжает телефон до 20%, находит отпечаток ладони на стене. Прикладывает руку. Тупик освещается кольцами и линиями. Переход на Сектор 2.", fb2Chapter7.trim()),
    chapter("lab-ch-8", "Глава 8. Сектор 2", "Герой просыпается от вибрации телефона. На экране появляется надпись «Сектор 2». Открываются карта, шагомер и набор датчиков. Он замечает число 32765 и скрытую область на карте; выход из сектора ещё не означает победу.", fb2Chapter8.trim()),
    chapter("lab-ch-9", "Глава 9. Лабиринт отвечает", "Полосы на стенах реагируют на свет и движение. Магнитометр и барометр подают противоречивые сигналы, герой проходит связанные ловушки, находит синий узел и открывает «Журнал» с записью: «Ты уже выбирал не туда».", fb2Chapter9.trim()),
    chapter("lab-ch-10", "Глава 10. Комната отдыха", "За деревянной дверью герой находит кресло, еду, зарядку и окно со звёздами. Телефон предупреждает: «Ресурс совместный». Записка и сообщение другого участника превращают передышку в новую тревогу.", fb2Chapter10.trim()),
    chapter("lab-ch-11", "Глава 11. Первый попутчик", "Герой находит кровь, клочок ткани и чужие метки, а затем встречает попутчицу. Их телефоны обладают разными функциями, поэтому Лабиринт намеренно вынуждает людей сотрудничать.", fb2Chapter11.trim()),
    chapter("lab-ch-12", "Глава 12. Цена доверия", "Чтобы пройти участок, героям приходится передать почти весь заряд на один телефон. Чужие метки ведут и к ресурсам, и к ловушкам; союз держится на необходимости, а не на симпатии."),
    chapter("lab-ch-13", "Глава 13. Сделка", "Герои встречают группу участников, которые предлагают еду и часть карты в обмен на сведения. Карта оказывается неполной, а от конкурентов приходит первая история об Охотнике, отбирающем чужие телефоны."),
    chapter("lab-ch-14", "Глава 14. Точка зафиксирована", "Участок реагирует на шум и перестраивает коридоры. Из-за ловушки герой или попутчица погибает, но телефон возвращает героя к точке сохранения с потерянным зарядом и изменёнными воспоминаниями спутницы."),
    chapter("lab-ch-15", "Глава 15. Чужая петля", "Герой повторяет маршрут с памятью о гибели, но Лабиринт меняет детали. Другой участник обвиняет его в поступке из прошлой версии петли, которой герой не помнит."),
    chapter("lab-ch-16", "Глава 16. Без телефона", "В ресурсной комнате не хватает еды, воды и заряда. Телефон героя крадут, и он остаётся один без карты и тепловизора, учась читать Лабиринт по звуку, запаху, уклону пола и давлению."),
    chapter("lab-ch-17", "Глава 17. Синхронизация", "Герой возвращает изменившийся телефон; журнал сообщает: «Теперь ты видишь без меня». Появляется синхронизация с участником, а Охотник впервые возникает лично. Столкновение заканчивается бегством и разделением группы."),
    chapter("lab-ch-18", "Глава 18. Дверь домой", "Герой видит дверь в собственный дом, но датчики и журнал противоречат чувствам. Лабиринт предлагает уйти одному, забыть всё и оставить спутников; измученный герой почти соглашается."),
    chapter("lab-ch-19", "Глава 19. Маршрут домой", "Память о пережитом останавливает героя перед ложным выходом. Дом рассыпается, открывается новый проход, а телефон показывает функцию «Маршрут домой» и прогресс 1%."),
    chapter("lab-ch-20", "Глава 20. Не случайный участник", "На площадке между секторами герой видит множество закрытых дверей и следы других людей. Сообщение говорит, что он умирал больше одного раза; открывается Сектор 3 и активируется режим конкуренции."),
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

const legacySeedByOrdinal = new Map<number, string>([
  [5, chapter5Text.trim()],
  [6, chapter6Text.trim()],
  [7, chapter7Text.trim()],
  [8, chapter8Text.trim()],
]);

function applyCanonChapter(existing: Chapter | undefined, canon: Chapter, n: number): Chapter {
  if (!existing) {
    return { ...canon };
  }

  // Главы 1–11 перенесены из FB2. Пустые, короткие и старые встроенные seed-тексты
  // обновляем из импорта; содержательные ручные правки пользователя сохраняем.
  if (n <= 11) {
    const user = (existing.content || "").trim();
    const legacy = legacySeedByOrdinal.get(n);
    const keep = user !== legacy && shouldKeepUserChapterContent(user, canon.content);
    return {
      ...existing,
      id: existing.id || canon.id,
      title: canon.title,
      summary: canon.summary,
      content: keep ? user : (canon.content || user || ""),
    };
  }

  // Главы 12–20: title/summary берутся из плана; текст не генерируется автоматически.
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
 * - есть → bible/plan/rules; слоты 1–20 по порядку; удалённые главы восстанавливаются
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
