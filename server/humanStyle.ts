import { computeStyleStats } from "../src/lib/authorAudit";

// Общий модуль «человечного стиля»: каталог признаков ИИ-текста, детерминированная
// оценка (AI-tell score) и промпт-блоки, которые внедряются в генерацию, чтобы модель
// писала очеловеченный текст с первого прохода, а не после отдельной редактуры.
//
// Принципиально: никаких внешних детекторов и оптимизации под их баллы. Оценка ниже —
// локальная метрика ремесла (штампы, ритм, однообразие), а не «обход детектора».
//
// Источники 2025–2026: Wikipedia Signs of AI writing, blader/humanizer, Aboudjem
// (43 паттерна / 5 voices), harshaneel/humanize (9 levers), smixs/humanizer-ru 1.2
// (32 русскоязычных паттерна, MIT), русские списки ИИ-штампов.

export type AiTellCategory =
  | "lexical"
  | "bureaucratic"
  | "structural"
  | "sensational"
  | "rlhf"
  | "interface";

export interface AiTellPattern {
  id: string;
  category: AiTellCategory;
  pattern: RegExp;
  label: string;
  weight: number; // вклад одного попадания в счёт (до нормализации на объём)
}

// Каталог адаптирован под русскую художественную прозу. Тире и безупречная грамматика
// сознательно НЕ считаются признаками: в русской прозе тире — норма (диалоги).
//
// Блок interface/* — из прогонов Yandex на «Лабиринт» гл.7 (2026-07): UI-лог, англ.
// интерфейс, нумерованные пункты меток часто уводят сегменты в AI, тогда как
// «тело + жест + %» (гл.6 optimal) идут в HUMAN. Локальный детектор учится
// ловить это до внешней проверки.
export const AI_TELL_CATALOG: AiTellPattern[] = [
  // — гладкие универсальные формулы
  { id: "ne-prosto", category: "lexical", pattern: /не просто/iu, label: "«не просто X…»", weight: 3 },
  { id: "slovno-nekhotya", category: "lexical", pattern: /словно нехотя/iu, label: "«словно нехотя»", weight: 3 },
  { id: "pugayushchaya-skorost", category: "lexical", pattern: /с пугающей скоростью/iu, label: "«с пугающей скоростью»", weight: 3 },
  { id: "gustaya-ravnodushnaya", category: "lexical", pattern: /густая и равнодушная/iu, label: "«густая и равнодушная»", weight: 3 },
  { id: "prorvat-plotinu", category: "lexical", pattern: /прорвал[аи]? плотину/iu, label: "«прорвало плотину»", weight: 3 },
  { id: "tot-samyi-moment", category: "lexical", pattern: /в тот самый момент/iu, label: "«в тот самый момент»", weight: 3 },
  { id: "pered-litsom", category: "lexical", pattern: /перед лицом/iu, label: "«перед лицом»", weight: 2 },
  { id: "ne-mog-oshibitsya", category: "lexical", pattern: /не мог(?:ла|ли)? ошибиться/iu, label: "«не мог ошибиться»", weight: 3 },
  { id: "edinstvennyi-yakor", category: "lexical", pattern: /единственн(?:ый|ая|ое|ым|ой) (?:якорь|путеводитель|шанс|надежда|друг)/iu, label: "тройное «единственный…»", weight: 2 },
  { id: "poymannaya-ptica", category: "lexical", pattern: /как пойманн(?:ая|ый) птиц/iu, label: "«как пойманная птица»", weight: 2 },
  { id: "rastopilsya-sneg", category: "lexical", pattern: /та[яи]л[иао]? как снег/iu, label: "«тает как снег»", weight: 2 },
  // — телесно-эмоциональные штампы генеративной прозы
  { id: "kholodok-po-spine", category: "sensational", pattern: /холодок (?:пробежал|скользнул) по спине|по спине пробежал холодок/iu, label: "«холодок по спине»", weight: 3 },
  { id: "serdtse-propustilo", category: "sensational", pattern: /сердце пропустило удар/iu, label: "«сердце пропустило удар»", weight: 3 },
  { id: "vozdukh-sgustilsya", category: "sensational", pattern: /воздух (?:сгустился|застыл|зазвенел|был (?:густым|плотным)(?: от [^.!?]{2,24})?)/iu, label: "абстрактно олицетворённый воздух", weight: 3 },
  { id: "vremya-zamerlo", category: "sensational", pattern: /время (?:словно |будто |как будто )?(?:остановилось|замерло|застыло|казалось замершим)/iu, label: "«время остановилось»", weight: 3 },
  { id: "grobovaya-tishina", category: "sensational", pattern: /(?:повисла|воцарилась) (?:гробовая |звенящая )?тишина/iu, label: "«повисла тишина»", weight: 2 },
  { id: "vnutri-szhalos", category: "sensational", pattern: /внутри (?:вс[её] |что-то )?(?:сжалось|оборвалось|похолодело)/iu, label: "«внутри всё сжалось»", weight: 2 },
  { id: "volna-chuvstva", category: "sensational", pattern: /волна (?:страха|ужаса|паники|облегчения|гнева|ярости|тепла) (?:накрыла|захлестнула|окатила|прокатилась)/iu, label: "«волна чувства накрыла»", weight: 3 },
  { id: "ledyanoi-uzhas", category: "sensational", pattern: /ледян(?:ой|ым|ого) ужас/iu, label: "«ледяной ужас»", weight: 2 },
  { id: "chto-to-neulovimoe", category: "sensational", pattern: /что-то неуловим/iu, label: "«что-то неуловимое»", weight: 2 },
  { id: "sam-vozdukh", category: "sensational", pattern: /казалось, сам(?:а|о)? (?:воздух|земля|время|пространство)/iu, label: "«казалось, сам воздух…»", weight: 3 },
  { id: "strannoe-chuvstvo", category: "sensational", pattern: /(?:странное (?:чувство|ощущение) (?:охватило|наполнило|не покидало)|внутри (?:меня )?(?:оставалось|осталось) странное (?:чувство|ощущение))/iu, label: "названное, но не показанное «странное чувство»", weight: 2 },
  { id: "tishina-davila", category: "sensational", pattern: /тишина (?:давила|нависала|обволакивала|поглотила)/iu, label: "олицетворённая тишина", weight: 2 },
  { id: "temnota-osyaz", category: "sensational", pattern: /темнота (?:была |казалась )?(?:осязаем|плотной|густой)/iu, label: "«осязаемая темнота»", weight: 1 },
  // — канцелярит и вводные-паразиты
  { id: "v-sovremennom-mire", category: "bureaucratic", pattern: /в современном мире/iu, label: "«в современном мире»", weight: 3 },
  { id: "impossible-here-contrast", category: "structural", pattern: /(?:в (?:этом|обычном|современном) мире|обычно) [^.!?]{0,80}(?:казал(?:ось|ись)|каж(?:ется|утся)) невозможн[^.!?]*[.!?]\s+(?:Но |Однако )?здесь вс[ёе] (?:было |оказалось )?(?:иначе|по-другому)/iu, label: "универсальная связка «в мире невозможно, но здесь иначе»", weight: 3 },
  { id: "ne-sekret", category: "bureaucratic", pattern: /не секрет,? что/iu, label: "«не секрет, что»", weight: 3 },
  { id: "stoit-otmetit", category: "bureaucratic", pattern: /(?:стоит|важно|следует) отметить/iu, label: "«стоит отметить»", weight: 3 },
  { id: "yavlyaetsya", category: "bureaucratic", pattern: /являет(?:ся|сь)/iu, label: "канцелярское «является»", weight: 1 },
  { id: "dannyi", category: "bureaucratic", pattern: /(?<![\p{L}\p{N}])данн(?:ый|ая|ое|ые|ого|ой|ым|ыми|ом)(?![\p{L}\p{N}])/iu, label: "канцелярское «данный»", weight: 1 },
  { id: "predstavlyaet-soboi", category: "bureaucratic", pattern: /представляет собой/iu, label: "«представляет собой»", weight: 2 },
  { id: "osushchestvlyat", category: "bureaucratic", pattern: /осуществл/iu, label: "канцелярское «осуществлять»", weight: 2 },
  { id: "svoego-roda", category: "bureaucratic", pattern: /своего рода/iu, label: "«своего рода»", weight: 1 },
  { id: "nado-otmetit", category: "bureaucratic", pattern: /надо (?:сказать|признать|отметить),? что/iu, label: "«надо сказать, что»", weight: 2 },
  // — дополнительные кластеры humanizer-ru 1.2; одиночные общеупотребительные слова
  // имеют малый вес, чтобы не штрафовать живую прозу без соседних AI-признаков
  { id: "current-day-padding", category: "bureaucratic", pattern: /на сегодняшний день|в настоящее время|на данном этапе|как известно|ни для кого не секрет/iu, label: "пустая временная/общеизвестная вводная", weight: 2 },
  { id: "vague-attribution", category: "bureaucratic", pattern: /по мнению экспертов|аналитики отмечают|исследователи утверждают|ряд источников указывает|некоторые критики считают/iu, label: "размытая ссылка на неназванных экспертов", weight: 2 },
  { id: "inflated-significance", category: "bureaucratic", pattern: /знаменует собой (?:ключевой|важный) этап|символизирует приверженность|непреходящее значение|более широкие тенденции|закладывает основу для|знаковый момент|поворотный пункт|неизгладимый след/iu, label: "раздувание значимости", weight: 2 },
  { id: "challenges-and-prospects", category: "bureaucratic", pattern: /несмотря на (?:эти )?вызовы|сталкивается с (?:целым |широким )?рядом вызовов|вызовы и (?:перспективы|наследие)|перспективы развития/iu, label: "формула «вызовы и перспективы»", weight: 2 },
  { id: "empty-intensifier", category: "lexical", pattern: /(?:действительно|абсолютно|безусловно|по-настоящему|невероятно) (?:важн|огромн|уникальн|значим|серь[её]зн|глубок)/iu, label: "пустой усилитель перед оценкой", weight: 1 },
  { id: "technical-jargon", category: "lexical", pattern: /(?:валидир|итерир|оптимизир)[а-яё]* (?:гипотез|решени|процесс|флоу)|(?:скоуп|дефолтн(?:ый|ая|ое)|флоу онбординг|релевантн(?:ый|ая|ое))\b/iu, label: "техножаргон без пояснения", weight: 1 },
  { id: "pseudo-depth", category: "lexical", pattern: /по сути,? вс[её] упирается|настоящий вопрос в том|глубинн(?:ая|ая же|ую) (?:проблема|готовность|причина)|если копнуть глубже|суть в том,? что|в конечном сч[её]те[^.!?]{0,50}(?:вс[её]|главное|важно)/iu, label: "анонс псевдоглубокого вывода", weight: 2 },
  // — структурные формулы
  { id: "eto-bylo-ne", category: "structural", pattern: /это был[оаи]? не (?:просто )?[^.!?]{3,40}[.,] (?:это|а)\b/iu, label: "зеркальное «это было не X — это Y»", weight: 3 },
  { id: "ritoricheskii-otvet", category: "structural", pattern: /\?\s+(?:Да|Нет|Возможно|Наверное)[,.]/u, label: "риторический вопрос + ответ", weight: 2 },
  { id: "slovno-budto-kaskad", category: "structural", pattern: /(?:словно|будто)[^.!?]{0,80}(?:словно|будто)/iu, label: "два «словно/будто» в одной фразе", weight: 2 },
  { id: "ne-tolko-no-i", category: "structural", pattern: /не только[^.!?]{0,60}но и/iu, label: "«не только… но и»", weight: 2 },
  { id: "odnako-vs[eё]-zhe", category: "structural", pattern: /однако вс[её] же/iu, label: "«однако всё же»", weight: 1 },
  { id: "vdrug-vnezapno", category: "structural", pattern: /(?:^|[.!?…]\s+|\n\s*)(?:И )?вдруг\b/iu, label: "зачин «Вдруг…»", weight: 2 },
  { id: "false-range", category: "structural", pattern: /от [^,.!?\n]{2,35} до [^,.!?\n]{2,35},\s*от [^,.!?\n]{2,35} до /iu, label: "шаблонный двойной диапазон «от X до Y»", weight: 2 },
  { id: "aphorism-formula", category: "structural", pattern: /(?:^|[.!?…]\s+)[А-ЯЁA-Z][^.!?\n]{1,35} (?:—|–|-) (?:это )?(?:язык|валюта|архитектура|зеркало) [^.!?\n]{2,35}[.!?]/u, label: "плакатная формула «X — валюта/язык Y»", weight: 2 },
  { id: "fragment-stack", category: "structural", pattern: /(?:Без|Никаких|Ноль) [^.!?]{1,30}[.!?]\s+(?:Без|Никаких|Ноль) [^.!?]{1,30}[.!?]\s+(?:Только|Без|Никаких|Ноль)(?=\s|[.!?…]|$)/iu, label: "стопка рубленых отрицательных фрагментов", weight: 2 },
  // — RLHF / «полезный ассистент» в художественной прозе
  { id: "podvodya-itog", category: "rlhf", pattern: /подводя итог|в заключение|резюмируя/iu, label: "итоговое резюме", weight: 3 },
  { id: "vazhno-ponyat", category: "rlhf", pattern: /важно понять|следует понимать|необходимо осознать/iu, label: "«важно понять»", weight: 3 },
  { id: "meta-realization", category: "rlhf", pattern: /в (?:своих )?мыслях я осознал|я (?:вдруг )?(?:понял|осознал),? что [^.!?]{0,55}(?:должно|значит|важно)/iu, label: "объявление осознания вместо мысли/действия", weight: 2 },
  { id: "forced-meaning", category: "rlhf", pattern: /(?:это|совпадение|оно) (?:должно|должен|должна) был(?:о|[аи])? значить|это был знак/iu, label: "принудительное объяснение «это должно что-то значить»", weight: 2 },
  { id: "s-odnoy-storony", category: "rlhf", pattern: /с одной стороны[^.!?]{0,80}с другой/iu, label: "сбалансированное «с одной / с другой»", weight: 3 },
  { id: "takim-obrazom", category: "rlhf", pattern: /(?<![\p{L}\p{N}])таким образом(?![\p{L}\p{N}])/iu, label: "«таким образом»", weight: 2 },
  { id: "imeet-smysl", category: "rlhf", pattern: /имеет смысл (?:отметить|сказать|подчеркнуть)/iu, label: "«имеет смысл отметить»", weight: 2 },
  { id: "announces-instead-of-acts", category: "rlhf", pattern: /давайте разбер[её]мся|погрузимся в|вот что нужно знать|итак,? начн[её]м|теперь рассмотрим|без лишних слов|перейд[её]м к главному/iu, label: "анонс вместо содержания", weight: 2 },
  { id: "chatbot-tail", category: "rlhf", pattern: /надеюсь,? (?:это|информация) (?:поможет|была полезн)|дайте знать,? если|буду рад помочь|если у вас есть вопросы|вот краткий обзор|по состоянию на мою последнюю актуализацию/iu, label: "служебный хвост чатбота", weight: 3 },
  { id: "generic-positive-ending", category: "rlhf", pattern: /будущее выглядит (?:ярким|светлым)|впереди захватывающие времена|путь к совершенству|важный шаг в правильном направлении|продолжает процветать/iu, label: "пустая позитивная концовка", weight: 2 },
  { id: "speculative-filler", category: "rlhf", pattern: /(?:информация|сведения|подробности) (?:крайне |очень )?(?:ограничен[аы]|мало|неполны)[^.!?]{0,100}(?:вероятно|предположительно|судя по всему)|широко не задокументирован[^.!?]{0,100}(?:вероятно|предположительно)/iu, label: "правдоподобная догадка вместо отсутствующего факта", weight: 3 },
  { id: "fake-intimacy", category: "rlhf", pattern: /(?:^|[.!?…]\s+)(?:Честно\?|Слушайте,|Скажу прямо,|Давайте начистоту,|Вот в ч[её]м штука[,:]|Если по-честному,)/u, label: "театральная доверительность", weight: 1 },
  // — UI / игровой лог в художественной прозе (Yandex + гл.7 vs эталон гл.6)
  { id: "nfc-eng", category: "interface", pattern: /\bNFC\b/u, label: "английский NFC в прозе", weight: 2 },
  { id: "cw-ccw-eng", category: "interface", pattern: /\b(?:CW|CCW)\b/u, label: "CW/CCW вместо «по/против часовой»", weight: 2 },
  { id: "ur-level-code", category: "interface", pattern: /\bУР\.\s*\d+\b/u, label: "код «УР. N» как UI-штамп (лучше «Уровень N» в речи)", weight: 1 },
  { id: "slash-ui-label", category: "interface", pattern: /[а-яёa-z]{2,}\s*\/\s*[а-яёa-z]{2,}/iu, label: "UI-метка «слово / слово»", weight: 1 },
  { id: "ne-najdeno-counter", category: "interface", pattern: /не найдено\s*[:—–-]?\s*\d+/iu, label: "счётчик «не найдено: N»", weight: 2 },
  { id: "numbered-log-item", category: "interface", pattern: /(?:^|[\n.!?…]\s*)\d{1,2}\.\s+[«"“]?[а-яёa-z][^]{0,180}?(?:^|[\n.!?…]\s*)\d{1,2}\.\s+[«"“]?[а-яёa-z]/imu, label: "серия нумерованного лога «1. текст; 2. текст»", weight: 1 },
  { id: "obnaruzhena-metka-spam", category: "interface", pattern: /обнаружена новая метка/iu, label: "повтор UI-строки «обнаружена новая метка»", weight: 1 },
  { id: "system-breathes", category: "interface", pattern: /система дышит/iu, label: "штамп «система дышит»", weight: 2 },
  { id: "code-notation", category: "interface", pattern: /(?:^|\s)(?:[А-ЯЁA-Z][\p{L}\p{N}_-]*\s*)?(?:→|←|⇒|>=|<=|!=|\bvs\b|\s&\s)(?:\s*[А-ЯЁA-Z\p{N}])/iu, label: "кодовая/математическая нотация в обычной фразе", weight: 1 },
  // — структурные AI-маркеры (live Yandex 2026-07: ~70% AI-сегментов без «классических» штампов)
  { id: "status-colon-ui", category: "interface", pattern: /статус\s*:/iu, label: "UI «статус:» в прозе", weight: 2 },
  { id: "steps-colon-ui", category: "interface", pattern: /шаги\s*[:—–-]/iu, label: "UI «шаги:» / «шаги —»", weight: 2 },
  { id: "map-usik", category: "interface", pattern: /усик(?:и|ов|ами)?/iu, label: "квест-жаргон «усик» карты", weight: 1 },
  // только «на линии-карте», не любое «на линии» (ложные срабатывания на гл.6)
  { id: "on-line-map", category: "interface", pattern: /на\s+линии-карт/iu, label: "«на линии-карте» как UI-якорь", weight: 1 },
  // два инвентарных факта подряд (типичный AI-обход локации)
  { id: "space-inventory", category: "structural", pattern: /(?:Пол\s+(?:твёрже|тверже|влажн)[^.!?]{0,20}[.!?]\s*(?:Стены|Риски)|Стены\s+гладк[^.!?]{0,20}[.!?]\s*(?:Пол|Риски)|Риски\s+(?:шли|сгуст|разошл)[^.!?]{0,40}[.!?]\s*(?:Пол|Стены|Достал))/iu, label: "инвентарь локации «Пол/Стены/Риски…» подряд", weight: 2 },
  { id: "one-word-sentence", category: "structural", pattern: /(?:^|[.!?…]\s+)(?:Сел|Встал|Пошёл|Пошел|Шагнул|Снял|Кивнул)\.(?=\s|$)/gu, label: "однословные рубленые фразы «Сел. Встал.»", weight: 2 },
  { id: "day-summary-loop", category: "structural", pattern: /День\s+тянулся|стол,\s*кухня,\s*снова\s+стол|от\s+стола\s+к\s+кухне/iu, label: "summary дня «стол–кухня–стол»", weight: 2 },
  // только очень короткие фразы (≤~3–4 слова / 18 символов тела)
  { id: "triple-staccato", category: "structural", pattern: /(?:^|[.!?…]\s+)[А-ЯЁA-Z][^.!?\n]{0,18}[.!?]\s+[А-ЯЁA-Z][^.!?\n]{0,18}[.!?]\s+[А-ЯЁA-Z][^.!?\n]{0,18}[.!?]/u, label: "три очень короткие фразы подряд (стаккато)", weight: 1 },
  { id: "anti-ui-meta", category: "interface", pattern: /не\s+список\.?\s*не\s+таблица|хватит\s+квест-лог/iu, label: "мета про «не UI» (сама выдает квест-тон)", weight: 1 },
  // — инвентарь локации: последовательные описания физических свойств (AI=4.0 vs HUMAN=1.2)
  { id: "inventory-adjective-pair", category: "structural", pattern: /(?:стен[аыу]|пол[ау]|потолок|двер[аью]|коридор|комнат)[аыу]?\s+(?:гладк|твёрд|тверде|холодн|тепл|тёпл|шершав|мягк|сух|влаж|стар|нов|обшарпан|тёмн|светл)[аиеуую]?\s*[.!?]\s*(?:стен[аыу]|пол[ау]|потолок|двер[аью]|коридор|комнат)[аыу]?\s+(?:гладк|твёрд|тверде|холодн|тепл|тёпл|шершав|мягк|сух|влаж|стар|нов|обшарпан|тёмн|светл)/iu, label: "инвентарь локации: два описания физики подряд", weight: 3 },
  { id: "inventory-three-senses", category: "structural", pattern: /(?:запах|звук|фактур|температуру?|влажност|сухост|шум|тишин|свет|темнот)[ауы]?\s+[а-яё]+[.!?]\s+(?:запах|звук|фактур|температуру?|влажност|сухост|шум|тишин|свет|темнот)[ауы]?\s+[а-яё]+[.!?]\s+(?:запах|звук|фактур|температуру?|влажност|сухост|шум|тишин|свет|темнот)[ауы]?\s+[а-яё]/iu, label: "три сенсорных канала подряд (инвентарь ощущений)", weight: 3 },
  { id: "diary-engineer-loop", category: "structural", pattern: /(?:тел(?:е|о)м|пальц|рук[ауи]|голов[ауы]?|взгляд[ауи]?)\s+(?:провер|повернул|сместил|поднёс|достал|опустил|поднял)[а-яё]*\s*[.!?]\s+(?:тел(?:е|о)м|пальц|рук[ауи]|голов[ауы]?|взгляд[ауи]?)\s+(?:провер|повернул|сместил|поднёс|достал|опустил|поднял)/iu, label: "два физических действия подряд без внутренней реакции", weight: 2 },
  // — «водянистый» повтор: одна мысль дважды (описание + вывод)
  { id: "double-thought", category: "structural", pattern: /(?:понял|осознал|решил|подумал)[а-яё]*\s*,?\s*что\s+[^.!?]{10,80}[.!?]\s+[^.!?]{0,20}(?:это\s+означал[аои]?|значит|стало\s+ясно|было\s+понятно)/iu, label: "мысль + её перефразировка (двойное объяснение)", weight: 2 },
  // — «инженерный дневник»: системный обход/подсчёт без эмоции
  { id: "counting-steps", category: "structural", pattern: /считая\s+шаги|шаг[аиуов]*\s+считал\b|на\s+(?:тридцат|сорок|пятьдесят|шестьдесят|семьдесят|восемьдесят|девяносто)[а-яё]*\s+(?:шаг|счёт)/iu, label: "инженерный подсчёт шагов/метров", weight: 2 },
  { id: "instrument-readout", category: "interface", pattern: /тепловизор\s+включался|телефон\s+(?:вс[её]\s+ещ[ёе]\s+)?показывал\s+(?:около\s+)?двадцат/iu, label: "считывание приборов", weight: 2 },
];

/**
 * Почему локальный детектор ≠ 100% Яндекса (и не может гарантировать 0% AI на тексте).
 * Показывается в UI / доках; паттерны ниже — попытка закрыть главные дыры.
 */
export const YANDEX_LOCAL_GAP = {
  version: 2,
  calibratedOn: "test-artifacts Yandex reports + live 2026-07 (ch1/6/7/8)",
  // live analysis: 108 HUMAN + 161 AI segments; after structural v2 miss ~31%
  stats: {
    yandexAiWithLowLocalTellBefore: 0.7,
    /** После structural v2 + смягчения FP на гл.1/6. */
    yandexAiWithLowLocalTellAfter: 0.47,
    looAccuracyApprox: 0.80,
    ch1Ch6YandexAiPct: 0,
    ch7YandexAiPct: 0.277,
    ch8YandexAiPct: 1.0,
  },
  reasonsNot100: [
    "Яндекс — чёрный ящик: режет текст на ~1k-символьные сегменты и классифицирует latent style, не наш regex-каталог.",
    "Большая доля AI-сегментов «чистые» по штампам (tell низкий), но рубленый ритм / inventory локации / экранный жаргон.",
    "HUMAN-эталон (гл.1) сам содержит короткие фразы, «однако», UI-слова («Уровень 1») — жёсткие правила дают ложные AI.",
    "Adaptive-centroid + fusion (w≈0.75, thr=55) оптимизированы по LOO ~76%, не под полный match thr Яндекса.",
    "0% AI% на тексте ≠ 100% accuracy детектора: цель «текст HUMAN» и «детектор всегда угадывает Яндекс» — разные задачи.",
  ],
  localPriorities: [
    "staccato / triple short sentences",
    "space inventory (Пол/Стены/Риски)",
    "status:/шаги: UI colon",
    "day summary loops",
    "classic interface stamps (NFC, не найдено, метка)",
  ],
} as const;

export interface AiTellHit {
  id: string;
  label: string;
  category: AiTellCategory;
  match: string;
  index: number;
}

export function detectAiTells(text: string): AiTellHit[] {
  const hits: AiTellHit[] = [];
  for (const entry of AI_TELL_CATALOG) {
    const global = new RegExp(entry.pattern.source, entry.pattern.flags.includes("g") ? entry.pattern.flags : entry.pattern.flags + "g");
    for (const match of text.matchAll(global)) {
      hits.push({ id: entry.id, label: entry.label, category: entry.category, match: match[0], index: match.index ?? 0 });
    }
  }
  return hits.sort((left, right) => left.index - right.index);
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .split(/(?<=[.!?…])\s+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 1);
}

function wordsOf(sentence: string): string[] {
  return sentence.split(/\s+/u).filter(Boolean);
}

// Коэффициент вариации длин предложений: у живой прозы длины «дышат» (CV ≥ ~0.5),
// у генеративной — ровный средний ритм (CV ≤ ~0.3).
export function sentenceBurstiness(text: string): number {
  const lengths = splitSentences(text).map((sentence) => wordsOf(sentence).length);
  if (lengths.length < 3) return 1;
  const mean = lengths.reduce((sum, value) => sum + value, 0) / lengths.length;
  if (mean === 0) return 1;
  const variance = lengths.reduce((sum, value) => sum + (value - mean) ** 2, 0) / lengths.length;
  return Math.sqrt(variance) / mean;
}

// Доля соседних предложений, начинающихся с одного и того же слова («Он… Он… Он…»).
export function repeatedOpenerShare(text: string): number {
  const openers = splitSentences(text)
    .map((sentence) => wordsOf(sentence)[0]?.toLowerCase().replace(/[^\p{L}ё]/gu, "") ?? "");
  if (openers.length < 3) return 0;
  let repeats = 0;
  for (let index = 1; index < openers.length; index += 1) {
    if (openers[index] && openers[index] === openers[index - 1]) repeats += 1;
  }
  return repeats / (openers.length - 1);
}

export interface AiTellScore {
  score: number; // 0 — человечно, 100 — набор генеративных признаков
  patternDensity: number; // взвешенные попадания на 1000 слов
  burstiness: number;
  openerRepetition: number;
  hits: AiTellHit[];
}

/** Доля «интерфейсных» попаданий: нумерованный лог, счётчики, англ. UI. */
export function interfaceTellShare(text: string): number {
  const hits = detectAiTells(text).filter((hit) => {
    const entry = AI_TELL_CATALOG.find((item) => item.id === hit.id);
    return entry?.category === "interface";
  });
  const wordCount = Math.max(wordsOf(text).length, 1);
  return hits.length / wordCount;
}

/**
 * Доля предложений ≤ maxWords и максимальная цепочка таких подряд.
 * Yandex-AI: shortShare×1.8, maxShortChain×2 vs HUMAN (live 2026-07).
 */
export function shortSentenceStats(text: string, maxWords = 4): {
  share: number;
  maxChain: number;
  count: number;
  total: number;
} {
  const lengths = splitSentences(text).map((sentence) => wordsOf(sentence).length).filter((n) => n > 0);
  if (!lengths.length) return { share: 0, maxChain: 0, count: 0, total: 0 };
  let chain = 0;
  let maxChain = 0;
  let count = 0;
  for (const n of lengths) {
    if (n <= maxWords) {
      count += 1;
      chain += 1;
      maxChain = Math.max(maxChain, chain);
    } else {
      chain = 0;
    }
  }
  return { share: count / lengths.length, maxChain, count, total: lengths.length };
}

export function aiTellScore(text: string): AiTellScore {
  const hits = detectAiTells(text);
  const wordCount = Math.max(wordsOf(text).length, 1);
  const weightById = new Map(AI_TELL_CATALOG.map((entry) => [entry.id, entry.weight]));
  const weighted = hits.reduce((sum, hit) => sum + (weightById.get(hit.id) ?? 1), 0);
  const patternDensity = (weighted / wordCount) * 1000;
  const burstiness = sentenceBurstiness(text);
  const openerRepetition = repeatedOpenerShare(text);
  const interfaceShare = interfaceTellShare(text);
  const short = shortSentenceStats(text, 4);
  const sentences = splitSentences(text);

  // Составляющие: штампы (до 45), UI-лог (до 15), стаккато (до 20), ровный ритм (до 15), зачины (до 10),
  // inventory (до 8), отсутствие thought-verbs (до -5 бонус к human).
  const patternComponent = Math.min(patternDensity * 4, 45);
  const interfaceComponent = Math.min(interfaceShare * 4000, 15);
  // Стаккато: Яндекс-AI shortShare≈0.34 / maxChain≈4 vs HUMAN 0.19 / 2.1
  // Пониженные пороги: ловим тексты с shortShare >= 0.28 и maxChain >= 3.
  let staccatoComponent = 0;
  if (short.total >= 6) {
    if (short.share >= 0.28) staccatoComponent += Math.min((short.share - 0.24) * 70, 12);
    if (short.maxChain >= 3) staccatoComponent += Math.min((short.maxChain - 2) * 4, 10);
  }
  staccatoComponent = Math.min(staccatoComponent, 20);
  // 0.50 — нижняя граница живого коридора после калибровки по авторской главе 1.
  const rhythmFloor = 0.5;
  const rhythmComponent = burstiness >= rhythmFloor
    ? 0
    : Math.min(((rhythmFloor - burstiness) / rhythmFloor) * 15, 15);
  const openerComponent = Math.min(openerRepetition * 50, 10);

  // Inventory-детектор: 3+ предложения подряд описывают физические свойства локации.
  // live data: AI=4.0 vs HUMAN=1.2 (ratio 3.3x) — сильнейший AI-маркер.
  const inventoryComponent = detectInventoryChain(sentences) ? 8 : 0;

  // Thought-verbs бонус: "подумал/решил/понял/осознал" в 1-м лице — сильный HUMAN-маркер.
  // live data: thoughtPer1k HUMAN=12.3 vs AI=3.4 (ratio 0.28 = HUMAN в 3.6x чаще).
  // Если текст >200 слов и thoughtVerbsPerK < 2 — штрафуем (AI-индикатор).
  let thoughtPenalty = 0;
  if (wordCount > 200) {
    const thoughtVerbs = (text.match(/\b(?:подумал|подумала|решил|решила|понял|поняла|осознал|осознала|вспомнил|вспомнила|представил|представила|казались?|показалось?)\b/giu) || []).length;
    const thoughtPerK = (thoughtVerbs / wordCount) * 1000;
    if (thoughtPerK < 2) {
      thoughtPenalty = Math.min((2 - thoughtPerK) * 3, 6);
    }
  }

  const score = Math.round(
    Math.min(
      Math.max(0,
        patternComponent + interfaceComponent + staccatoComponent + rhythmComponent + openerComponent
        + inventoryComponent + thoughtPenalty
      ),
      100,
    ),
  );
  return { score, patternDensity, burstiness, openerRepetition, hits };
}

/** 3+ последовательных описаний физики пространства — инвентарь локации.
 *  Ловит как отдельные предложения, так и списки через запятую
 *  ("Пол твёрже, стены гладкие, риски шли ровно"). */
const SPACE_NOUNS = /(?:стен[аыу]|пол[ау]|потолок[ау]?|двер[аью]|окн[оау]|коридор[ау]?|комнат[ауы]|помещени|пространств|поверхност|туннел|лабиринт|проход[ау]|тупик[ау]?|порог[ау]|косяк[ау]|дверц[ау]|лючок[ау]|колодец|яма|ёмкость|ёмкост|стол[ау]|стул[ау]|шкаф[ау]|кроват|подоконник)/iu;
const SURFACE_ADJ = /(?:гладк[аиеуую]|твёрд[аиеуую]|тверде|тверд|тверже|влажны|сух[аиеуую]|шершав|мягк[аиеуую]|холодн|теплы|тёпл|стар[аиеуую]|нов[аиеуую]|обшарпан|крас[аиеуую]|тёмн|светл)/iu;
const INVENTORY_ITEM = new RegExp(`${SPACE_NOUNS.source}\\s+\\S+\\s*${SURFACE_ADJ.source}|${SURFACE_ADJ.source}\\s+${SPACE_NOUNS.source}`, "giu");
function detectInventoryChain(sentences: string[]): boolean {
  let chain = 0;
  for (const sentence of sentences) {
    // Проверяем отдельные предложения
    if (SPACE_NOUNS.test(sentence) && SURFACE_ADJ.test(sentence)) {
      chain += 1;
      if (chain >= 3) return true;
    } else {
      // Проверяем списки через запятую: "Пол твёрже, стены гладкие, риски..."
      const parts = sentence.split(/[,;]/u).map((p) => p.trim()).filter(Boolean);
      let commaChain = 0;
      for (const part of parts) {
        if (SPACE_NOUNS.test(part) && SURFACE_ADJ.test(part)) {
          commaChain += 1;
          if (commaChain >= 3) return true;
        } else {
          commaChain = 0;
        }
      }
      if (commaChain > 0) {
        chain += 1;
      } else {
        chain = 0;
      }
    }
  }
  return false;
}

// Оценка отдельного абзаца для точечной доводки (короткие блоки иначе недооцениваются).
export function paragraphAiTellScore(block: string): AiTellScore {
  const base = aiTellScore(block);
  // Короткий абзац со штампом: поднимаем score, чтобы он попал в touchup.
  if (base.hits.length > 0 && wordsOf(block).length < 40) {
    return { ...base, score: Math.min(100, Math.max(base.score, 25 + base.hits.length * 10)) };
  }
  return base;
}

/** Минимальная «живость» ритма для gate (ниже — ещё один pass). */
export const DEFAULT_MIN_BURSTINESS = 0.45;

export function heavyStampHits(score: AiTellScore): AiTellHit[] {
  return score.hits.filter((hit) => {
    const entry = AI_TELL_CATALOG.find((item) => item.id === hit.id);
    return (entry?.weight ?? 0) >= 3;
  });
}

export function humanizeGatePassed(
  score: AiTellScore,
  maxScore: number,
  minBurstiness = DEFAULT_MIN_BURSTINESS,
): boolean {
  if (score.score > maxScore) return false;
  if (heavyStampHits(score).length > 0) return false;
  // Для коротких текстов вызывающий код может передать minBurstiness=0.
  if (minBurstiness > 0 && score.burstiness < minBurstiness) return false;
  return true;
}

/** Абзац достаточно «чистый» — touchup его не трогает (сохраняем живые куски). */
export function isCleanBlock(block: string, cleanScoreMax = 10): boolean {
  const trimmed = block.trim();
  if (!trimmed || trimmed.length < 20) return true;
  const score = paragraphAiTellScore(trimmed);
  if (score.score > cleanScoreMax) return false;
  // Любой штамп weight≥2 — не «чистый»
  const weightById = new Map(AI_TELL_CATALOG.map((entry) => [entry.id, entry.weight]));
  return !score.hits.some((hit) => (weightById.get(hit.id) ?? 1) >= 2);
}

// Пресеты голоса для историй без авторского образца (идея «5 voices» из humanizer-скилов).
export interface VoicePreset {
  id: string;
  title: string;
  directives: string;
}

export const VOICE_PRESETS: VoicePreset[] = [
  {
    id: "neutral",
    title: "Нейтрально-тёплый рассказчик",
    directives: "Рассказчик наблюдательный и сдержанно-тёплый. Простые точные слова, конкретные детали быта, короткие вспышки иронии. Эмоции показываются через действие и жест, а не называются.",
  },
  {
    id: "terse",
    title: "Резкий, рубленый",
    directives: "Рассказчик немногословный и жёсткий. Короткие фразы. Глаголы вместо прилагательных. Никаких развёрнутых метафор; сравнение — редкое и бытовое. Паузы и умолчания вместо объяснений.",
  },
  {
    id: "ironic",
    title: "Ироничный наблюдатель",
    directives: "Рассказчик умный и насмешливый, но не циничный. Сухие ремарки в сторону, неожиданные сопоставления, внутренние комментарии героя. Ирония — в деталях, не в открытых шутках.",
  },
  {
    id: "lyrical",
    title: "Лирический, плотный",
    directives: "Рассказчик чувственный, внимательный к свету, запаху, фактуре. Длинные фразы чередуются с очень короткими. Образы свежие и конкретные; запрещены расхожие поэтизмы (луна-серебро, звенящая тишина).",
  },
  {
    id: "conversational",
    title: "Разговорный, от первого лица",
    directives: "Живой устный тон: вводные словечки, оборванные мысли, самоперебивы. Герой говорит с читателем как со знакомым. Просторечие лёгкое, без нарочитых ошибок.",
  },
];

export function voicePresetById(id: unknown): VoicePreset | undefined {
  return typeof id === "string" ? VOICE_PRESETS.find((preset) => preset.id === id) : undefined;
}

// Режимы глубины очеловечивания при генерации главы.
export type HumanizeDepth = "fast" | "balanced" | "maximum";

export interface HumanizeDepthConfig {
  id: HumanizeDepth;
  title: string;
  description: string;
  sceneGeneration: boolean;
  maxTouchupBlocks: number;
  touchupRounds: number;
  bestOfN: number;
  /** Сколько полных черновиков главы генерировать (best-of-N). */
  chapterCandidates: number;
  scoreGate: number;
  minBurstiness: number;
  /** Абзацы с AI-tell ≤ этого порога не трогаем (если нет тяжёлых штампов). */
  cleanScoreMax: number;
  proseTemperature: number;
  sceneTemperature: number;
  minAuthorSampleChars: number; // 0 = sample optional
}

export const HUMANIZE_DEPTHS: Record<HumanizeDepth, HumanizeDepthConfig> = {
  fast: {
    id: "fast",
    title: "Быстро",
    description: "Один проход + лёгкая доводка штампов",
    sceneGeneration: false,
    maxTouchupBlocks: 10,
    touchupRounds: 1,
    bestOfN: 1,
    chapterCandidates: 1,
    scoreGate: 18,
    minBurstiness: 0.4,
    cleanScoreMax: 10,
    proseTemperature: 0.85,
    sceneTemperature: 0.85,
    minAuthorSampleChars: 0,
  },
  balanced: {
    id: "balanced",
    title: "Баланс",
    description: "Сцены + best-of-2 черновиков + доводка",
    sceneGeneration: true,
    maxTouchupBlocks: 16,
    touchupRounds: 2,
    bestOfN: 1,
    chapterCandidates: 2,
    scoreGate: 12,
    minBurstiness: 0.45,
    cleanScoreMax: 10,
    proseTemperature: 0.88,
    sceneTemperature: 0.9,
    minAuthorSampleChars: 0,
  },
  maximum: {
    id: "maximum",
    title: "Максимум",
    description: "Сцены + best-of-3 черновиков + best-of-N абзацев + gate",
    sceneGeneration: true,
    maxTouchupBlocks: 20,
    touchupRounds: 2,
    bestOfN: 2,
    chapterCandidates: 3,
    scoreGate: 8,
    minBurstiness: 0.5,
    cleanScoreMax: 8,
    proseTemperature: 0.9,
    sceneTemperature: 0.92,
    minAuthorSampleChars: 300,
  },
};

/**
 * Ранг кандидата главы: меньше = лучше.
 * Штампы и score важнее; burstiness поощряется; gate-pass даёт бонус.
 */
export function rankChapterCandidate(score: AiTellScore, scoreGate = 12, minBurstiness = 0.45): number {
  const heavy = heavyStampHits(score).length;
  const gateBonus = humanizeGatePassed(score, scoreGate, minBurstiness) ? -8 : 0;
  const burstPenalty = score.burstiness >= minBurstiness
    ? 0
    : ((minBurstiness - score.burstiness) / Math.max(minBurstiness, 0.01)) * 20;
  return score.score + heavy * 12 + burstPenalty + gateBonus;
}

export function pickBestChapterCandidate<T extends { text: string; score: AiTellScore }>(
  candidates: T[],
  scoreGate = 12,
  minBurstiness = 0.45,
): T {
  if (!candidates.length) throw new Error("Нет кандидатов главы");
  let best = candidates[0];
  let bestRank = rankChapterCandidate(best.score, scoreGate, minBurstiness);
  for (let index = 1; index < candidates.length; index += 1) {
    const rank = rankChapterCandidate(candidates[index].score, scoreGate, minBurstiness);
    if (rank < bestRank) {
      best = candidates[index];
      bestRank = rank;
    }
  }
  return best;
}

export function resolveHumanizeDepth(value: unknown): HumanizeDepthConfig {
  if (value === "fast" || value === "maximum" || value === "balanced") {
    return HUMANIZE_DEPTHS[value];
  }
  return HUMANIZE_DEPTHS.balanced;
}

// Негативные few-shot: пара «плохо → хорошо» работает лучше абстрактного запрета.
const NEGATIVE_EXAMPLES = `Примеры (плохо → хорошо):
1) Плохо: «Волна ледяного ужаса накрыла её, и время словно остановилось». Хорошо: «Она перестала слышать лифт за стеной. Пальцы сами собой смяли край рецепта».
2) Плохо: «Это был не просто дом — это была крепость его памяти». Хорошо: «Дом держал его крепче любых замков: под подоконником так и лежала отцовская стамеска».
3) Плохо: «Повисла гробовая тишина, и что-то неуловимое изменилось в его лице». Хорошо: «Никто не ответил. Он дважды моргнул и убрал руки со стола».
4) Плохо: «С одной стороны, он боялся, с другой — надеялся. Важно понять: выбора не было». Хорошо: «Он боялся. И всё равно шагнул».
5) Плохо: «Стены были гладкие. Пол твёрже. Риски шли ровно. Потолок низкий.» Хорошо: «Стены под пальцами — гладкие, будто кто-то шлифовал их веками. Риски на полу сходились к одному месту, и он пошёл туда, стараясь не задевать низкий потолок.»
6) Плохо: «Он достал телефон. Посмотрел на экран. Опустил взгляд. Повернулся. Сел. Встал. Пошёл.» Хорошо: «Телефон показывал двадцать процентов — больше, чем он ожидал.»`;

// 9 levers (harshaneel/humanize 2026), адаптированные под русскую художественную прозу.
const NINE_LEVERS = `ДЕВЯТЬ РЫЧАГОВ ЖИВОГО ТЕКСТА:
1) Слова: убирай гладкие ИИ-формулы; одно-два неожиданных, но точных слова на абзац — из мира сцены, не из словаря «красивой прозы».
2) Ритм: чередуй короткие и длинные фразы естественно; не строй метроном из 15–20-словных предложений.
3) Без смягчителей: вырежи «стоит отметить», «важно понять», «таким образом», «с одной стороны… с другой», если это не прямая речь героя.
4) Структура: не заканчивай абзац выводом-резюме; обрывай на действии или конкретной детали.
5) Конкретика: абстрактное чувство → жест, предмет, число, запах, решение героя.
6) Голос: держи манеру образца (или персоны); допускай самоперебив и бытовую прямоту, если они есть у автора.
7) Связки: не начинай абзацы с «Кроме того», «Между тем», «Вдруг», «Однако» каскадом.
8) Пунктуация: в русской прозе тире в диалогах — норма. Не злоупотребляй тройными восклицаниями и «ударными» финалами каждого абзаца.
9) Сними голос «полезного ассистента»: без сбалансированных лекций, без объяснения читателю «что это значит», без идеально гладкой локальной связности.`;

/**
 * Паттерны, подтверждённые прогонами Yandex-нейродетектора (лабиринт, 2026-07).
 * Вшиваются в генерацию/рерайт, чтобы не оптимизировать «на глаз».
 */
export const YANDEX_DETECTOR_STYLE = `ПАТТЕРНЫ НЕЙРОДЕТЕКТОРА (Yandex lab, live 2026-07; ~108 HUMAN + ~161 AI сегментов «Лабиринт»):
1) СТАККАТО = AI: shortShare AI≈0.34 vs HUMAN≈0.19; цепочки коротких фраз maxChain AI≈4 vs H≈2. Не «Сел. Встал. Пошёл.» и не 3+ коротких подряд.
2) От 1 лица: дневник. HUMAN чаще «подумал» (×4), «решил», «однако». Не вычищай «я» в телеграф.
3) «Дневник инженера»: жест, %, запах, связная фраза. Не inventory локации: «Пол твёрже. Стены гладкие. Риски…».
4) Один проход сцены; ≤1–2 «что дальше?».
5) Запрет: «Начну снова», часы «3:47» без канона, summary дня «стол, кухня, снова стол».
6) UI-флаги AI: «статус:», «шаги:», «на линии», «усик» карты, NFC/CW, «не найдено: N», «обнаружена новая метка», нумерованный лог. Механику — телом; подпись экрана редко.
7) Сон→явь: не резюме дня, а жест → пол/кольцо. Ур.2: без квест-тура по всем датчикам подряд.
8) Ритм: средняя фраза ~9 слов; short≤4 <~25% предложений.
9) Локальный детектор ≠ Яндекс на 100% (см. YANDEX_LOCAL_GAP): ~70% AI-сегментов Яндекса раньше имели низкий stamp-score — ловим стаккато/UI структурно.
10) Сверяй: aiTell + calibrated detector + Yandex; HUMAN-сегменты не трогай.`;

// Базовые правила человечного письма, добавляются к системной инструкции генерации.
export function humanStyleDirectives(): string {
  const bannedExamples = AI_TELL_CATALOG
    .filter((entry) => entry.weight >= 3)
    .map((entry) => entry.label)
    .join(", ");
  return `ПРАВИЛА ЖИВОГО ТЕКСТА (обязательны):
1. Следуй ритму авторского образца. Не конструируй механическое чередование коротких и длинных фраз и не ставь подряд рубленые фразы ради драматизма.
2. Не начинай соседние предложения и абзацы с одного и того же слова или конструкции.
3. Эмоции и атмосферу передавай через конкретное действие, жест, предмет или прямую мысль героя. Не называй чувства абстрактно и не олицетворяй среду («воздух сгустился», «тишина давила»).
4. Запрещены гладкие генеративные формулы, в том числе: ${bannedExamples}. Подбирай вместо них конкретное восприятие сцены.
5. Никакого канцелярита («является», «данный», «осуществлять», «представляет собой») в художественном тексте.
6. Не строй зеркальных конструкций («это не X — это Y») и не отвечай сам себе на риторические вопросы.
7. Метафора допустима, если она одна, свежая и вырастает из мира сцены. Не нанизывай образы подряд.
8. Абзац не обязан заканчиваться выводом или «ударной» финальной фразой. Обрывай там, где закончилось действие.
9. При этом НЕ имитируй человечность искусственно: не вставляй опечатки, лишние частицы, просторечие или ошибки ради «живости». Безупречная грамматика — не признак ИИ, портить её нельзя.
10. Не повторяй одну мысль дважды: сначала в описании, затем во внутренней реплике или выводе. Доверяй читателю и оставляй часть причин неразжёванными.
11. Не превращай сцену в перечень сенсорных каналов и точных характеристик. Числа, запахи, фактуры и термины появляются только тогда, когда влияют на ближайшее решение героя.
12. Если дан авторский образец, его степень простоты и шероховатости — норма. Не заменяй прямую бытовую фразу «более литературным» синонимом и не добавляй украшения, которых автор обычно не использует.
13. Не пиши как «полезный ассистент»: без лекций читателю, без «с одной стороны / с другой», без «важно понять», без подведения итогов в конце сцены.
14. От 1 лица: сохраняй «я» как естественную опору повествования (умеренно). Полное вычищение «я» и сплошной телеграф — вредны и для голоса, и для нейродетектора.
15. Режь воду, а не фактуру: сохраняй факты, цифры, странные конкретные детали, смешанные чувства, отступления и самопоправки. Оценку по возможности меняй на наблюдаемый факт, но не выдумывай его.
16. Ищи сочетания признаков, а не одиночное слово. Одно «однако», тире или вопрос в русской прозе ничего не доказывает; не переписывай чистый абзац ради стерильности.
17. Не анонсируй мысль («давайте разберёмся», «настоящий вопрос в том») и не заполняй неизвестное правдоподобной догадкой. Сразу показывай действие/факт либо честно оставляй пробел.
18. Инвентарь локации: не описывай 3+ физических свойства пространства подряд («Стены гладкие. Пол твёрже. Потолок низкий.»). Одно конкретное наблюдение, связанное с действием героя.
19. Внутренние глаголы: используй «подумал/решил/понял» умеренно — они маркер живого дневника. Но не называй свои эмоции: «осознал, что боится» → сделай жест или действие.
20. Два физических действия подряд (достал→посмотрел→опустил) без внутренней реакции — признак «дневника инженера». Между действиями — одна мысль, одно наблюдение или пауза.
${YANDEX_DETECTOR_STYLE}
${NINE_LEVERS}
${NEGATIVE_EXAMPLES}`;
}

// --- Детерминированные проверки качества переписанных блоков ---

function normalizedSentenceTokens(sentence: string): Set<string> {
  return new Set(sentence.toLowerCase().match(/[а-яёa-z0-9]+/giu) ?? []);
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / (left.size + right.size - shared);
}

// Ловит два известных сбоя редактуры: раздувание блока и «два варианта одного
// абзаца» внутри блока (почти одинаковые длинные предложения рядом).
export function blockQualityIssues(sourceBlock: string, revisedBlock: string): string[] {
  const issues: string[] = [];
  if (revisedBlock.length > sourceBlock.length * 1.6 && revisedBlock.length > sourceBlock.length + 200) {
    issues.push(`блок раздут с ${sourceBlock.length} до ${revisedBlock.length} знаков`);
  }
  if (revisedBlock.length < sourceBlock.length * 0.45 && sourceBlock.length > 120) {
    issues.push(`блок чрезмерно урезан с ${sourceBlock.length} до ${revisedBlock.length} знаков`);
  }
  const sentences = splitSentences(revisedBlock).filter((sentence) => wordsOf(sentence).length >= 6);
  const tokenSets = sentences.map(normalizedSentenceTokens);
  for (let left = 0; left < tokenSets.length; left += 1) {
    for (let right = left + 1; right < tokenSets.length; right += 1) {
      if (jaccard(tokenSets[left], tokenSets[right]) >= 0.75) {
        issues.push("внутри блока два почти одинаковых предложения (черновые варианты)");
        return issues;
      }
    }
  }
  return issues;
}

// Ритмические проблемы отдельного абзаца — для точечной доводки не только по
// штампам, но и по «ровному» генеративному ритму.
export function rhythmIssues(block: string): string[] {
  const sentences = splitSentences(block);
  if (sentences.length < 4) return [];
  const issues: string[] = [];
  if (sentenceBurstiness(block) < 0.35) {
    issues.push("ровный ритм: все предложения близкой длины — нужно чередовать короткие и длинные");
  }
  if (repeatedOpenerShare(block) > 0.4) {
    issues.push("однотипные зачины: соседние предложения начинаются одинаково");
  }
  return issues;
}

// Все issues абзаца для touchup (штампы + ритм + высокий paragraph score).
export function blockHumanizeIssues(block: string): string[] {
  const issues: string[] = [
    ...detectAiTells(block)
      .filter((hit) => {
        const entry = AI_TELL_CATALOG.find((item) => item.id === hit.id);
        return (entry?.weight ?? 0) >= 2;
      })
      .map((hit) => `штамп «${hit.match}» (${hit.label}) — замени конкретным восприятием, действием или прямой мыслью героя`),
    ...rhythmIssues(block),
  ];
  const score = paragraphAiTellScore(block);
  if (score.score >= 22 && !issues.length) {
    issues.push("абзац звучит генеративно: упрости лексику, добавь конкретную деталь, разбей ровный ритм");
  }
  return [...new Set(issues)];
}

export interface FlagBlocksOptions {
  maximum: number;
  /** Не трогать абзацы с score ≤ cleanScoreMax без тяжёлых штампов (по умолчанию 10). */
  cleanScoreMax?: number;
  /** Только ритм (для pass «разбить burstiness»). */
  rhythmOnly?: boolean;
}

// Индексы абзацев, требующих доводки, по убыванию «грязи».
// Чистые абзацы (низкий score, нет штампов weight≥2) пропускаем — иначе Яндекс
// «заглаживает» живые куски.
export function flagBlocksForTouchup(
  blocks: string[],
  maximumOrOptions: number | FlagBlocksOptions,
): number[] {
  const options: FlagBlocksOptions = typeof maximumOrOptions === "number"
    ? { maximum: maximumOrOptions, cleanScoreMax: 10 }
    : { cleanScoreMax: 10, ...maximumOrOptions };

  return blocks
    .map((block, index) => {
      const score = paragraphAiTellScore(block);
      const issues = options.rhythmOnly ? rhythmIssues(block) : blockHumanizeIssues(block);
      const weightById = new Map(AI_TELL_CATALOG.map((entry) => [entry.id, entry.weight]));
      const hasHeavy = score.hits.some((hit) => (weightById.get(hit.id) ?? 1) >= 2);
      const clean = !hasHeavy && score.score <= (options.cleanScoreMax ?? 10);
      return {
        index,
        issues: issues.length,
        score: score.score,
        clean,
        burstiness: score.burstiness,
      };
    })
    .filter((entry) => {
      if (entry.clean && !options.rhythmOnly) return false;
      if (options.rhythmOnly) {
        // Для ритм-pass: только длинные «ровные» абзацы
        return entry.issues > 0 || (entry.burstiness < 0.35 && entry.score >= 5);
      }
      return entry.issues > 0 || entry.score >= 22;
    })
    .sort((left, right) => right.score - left.score || right.issues - left.issues)
    .slice(0, options.maximum)
    .map((entry) => entry.index)
    .sort((left, right) => left - right);
}

/** Извлечь числа из текста (для anti-repeat / факт-check). */
export function extractNumbers(text: string): string[] {
  return [...text.matchAll(/\d+(?:[.,]\d+)?%?/gu)].map((match) => match[0]);
}

/** Грубое пересечение 5-грамм слов между двумя текстами (anti-repeat сцен). */
export function repeatedNgramShare(left: string, right: string, n = 5): number {
  const toGrams = (text: string) => {
    const tokens = text.toLowerCase().match(/[а-яёa-z0-9]+/giu) ?? [];
    const grams = new Set<string>();
    for (let index = 0; index <= tokens.length - n; index += 1) {
      grams.add(tokens.slice(index, index + n).join(" "));
    }
    return grams;
  };
  const a = toGrams(left);
  const b = toGrams(right);
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const gram of a) if (b.has(gram)) shared += 1;
  return shared / Math.min(a.size, b.size);
}

// Доля содержательно изменённых блоков (нормализованное сравнение) — чтобы
// режимы силы редактуры были обещанием результата, а не тона просьбы.
export function changedBlockShare(sourceBlocks: string[], revisedBlocks: string[]): number {
  if (!sourceBlocks.length) return 0;
  const normalize = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  let changed = 0;
  for (let index = 0; index < sourceBlocks.length; index += 1) {
    if (normalize(sourceBlocks[index]) !== normalize(revisedBlocks[index] ?? "")) changed += 1;
  }
  return changed / sourceBlocks.length;
}

// Выбрать лучший из N вариантов абзаца по AI-tell (ниже = лучше).
export function pickBestVariant(source: string, variants: string[]): string {
  const sourceScore = paragraphAiTellScore(source).score;
  const candidates = variants
    .filter((variant) => typeof variant === "string" && variant.trim())
    .filter((variant) => !blockQualityIssues(source, variant).length);
  if (!candidates.length) return source;
  let best = source;
  let bestScore = sourceScore;
  for (const candidate of candidates) {
    const score = paragraphAiTellScore(candidate).score;
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

// Паспорт голоса как персона рассказчика: развёрнутая «биография» даёт более
// человечный и разнообразный текст, чем список правил.
// Количественный портрет голоса по образцу автора: модели заметно лучше держат
// манеру, когда цель измерима, а не описана прилагательными.
export function quantitativeVoiceBlock(sample: string): string {
  const stats = computeStyleStats(sample);
  if (stats.words < 100) return "";
  const lines = [
    `- средняя длина предложения: ~${Math.round(stats.averageSentenceWords)} слов (разброс ±${Math.round(stats.sentenceLengthDeviation)})`,
    `- доля коротких фраз (до 4 слов): ${Math.round(stats.shortSentenceShare * 100)}%`,
    `- доля строк-диалогов: ${Math.round(stats.dialogueLineShare * 100)}%`,
    `- восклицания: ~${stats.exclamationsPerThousandWords.toFixed(1)} на 1000 слов`,
    `- многоточия: ~${stats.ellipsesPerThousandWords.toFixed(1)} на 1000 слов`,
    `- разговорные частицы (же, ведь, ну…): ~${stats.particlesPerThousandWords.toFixed(1)} на 1000 слов`,
    `- сравнения (будто, словно…): ~${stats.similesPerThousandWords.toFixed(1)} на 1000 слов`,
  ];
  return `ИЗМЕРИМЫЙ ПОРТРЕТ ГОЛОСА (статистика образца автора — держи текст в этих пределах, не копируя события):\n${lines.join("\n")}`;
}

export function voicePersonaBlock(voiceSheet: unknown): string {
  if (!voiceSheet || typeof voiceSheet !== "object") return "";
  const sheet = voiceSheet as { summary?: string; voiceRules?: string[]; avoid?: string[] };
  const rules = Array.isArray(sheet.voiceRules) ? sheet.voiceRules.slice(0, 20).join("\n- ") : "";
  const avoid = Array.isArray(sheet.avoid) ? sheet.avoid.slice(0, 12).join("\n- ") : "";
  return `ПЕРСОНА РАССКАЗЧИКА (паспорт голоса автора — пиши от этой манеры, а не «в общем стиле»):
${typeof sheet.summary === "string" ? sheet.summary : ""}
Правила голоса:
- ${rules}
Чего этот автор не делает (не имитируй механически):
- ${avoid}`;
}

// Позитивные few-shot абзацы из образца (не события — только манера).
export function positiveVoiceFewShots(sample: string, maximum = 3): string {
  const paragraphs = sample
    .split(/\n{2,}/u)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length >= 40 && paragraph.length <= 900);
  if (!paragraphs.length) {
    const slice = sample.trim().slice(0, 900);
    return slice ? `Эталонные фрагменты манеры (не копируй сюжет):\n"""\n${slice}\n"""` : "";
  }
  const picked = paragraphs.slice(0, maximum);
  return `Эталонные абзацы манеры автора (ритм и лексика; события и имена из образца НЕ переносить в новую главу):\n${picked.map((paragraph, index) => `${index + 1}) """${paragraph}"""`).join("\n")}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// РАСШИРЕННАЯ СИСТЕМА ОЧЕЛОВЕЧИВАНИЯ v2
// Re-export из humanStyleEnhanced.ts для обратной совместимости.
// Все новые функции доступны через этот файл без изменения импортов в server.ts
// ─────────────────────────────────────────────────────────────────────────────
export {
  // Расширенный каталог паттернов (+50 новых)
  AI_TELL_CATALOG_EXTENDED,
  // Детектор с контекстными весами (жанр / позиция / плотность)
  detectAiTellsEnhanced,
  aiTellScoreEnhanced,
  // Новые метрики стиля
  paragraphLengthCV,
  passiveVoiceShare,
  uniqueWordRatio200,
  connectorDiversity,
  computeExtendedMetrics,
  // 3-фазный humanizer pipeline
  buildRhythmBreakerPrompt,
  buildLexicalDiversifierPrompt,
  buildMicroImperfectionsPrompt,
  DEFAULT_HUMANIZER_CONFIG,
  // Negative Voice Profile
  buildNegativeVoiceProfile,
  negativeVoiceGuidanceBlock,
  // Multi-detector gate
  runMultiDetectorGate,
  // Конфигурационный объект
  HUMANIZER_V2,
} from "./humanStyleEnhanced";

/** Объединённый каталог: оригинальные 80+ паттернов + 50 новых */
export { AI_TELL_CATALOG_EXTENDED as AI_TELL_CATALOG_V2_EXTRA } from "./humanStyleEnhanced";
export { NARRATIVE_ARCHITECTURE_CHECKLIST } from "./humanStyleEnhanced";

/**
 * aiTellScoreFull — расширенная версия aiTellScore(), использующая
 * объединённый каталог (130+ паттернов) с контекстными весами.
 * Drop-in замена aiTellScore() для новых вызовов.
 */
import { AI_TELL_CATALOG_EXTENDED as _EXT_CATALOG, aiTellScoreEnhanced as _scoreEnh } from "./humanStyleEnhanced";

export function aiTellScoreFull(text: string, genre = "general"): number {
  const combined = [...AI_TELL_CATALOG, ..._EXT_CATALOG];
  return _scoreEnh(text, combined, genre as Parameters<typeof _scoreEnh>[2]);
}
