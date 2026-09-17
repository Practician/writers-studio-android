/**
 * Живой прогон очеловечивания на коде сборки 72 через служебный LLM-шлюз платформы.
 *
 * Фазы:
 *  1) humanize_draft  — доводка того же черновика, что и в прогоне 12:00;
 *  2) sepia review    — внешняя рубрика sepia (три прохода) по черновику и по доведённому тексту,
 *                       с терпимым разбором ответа (прошлый прогон падал на строгом JSON);
 *  3) generate_full_chapter — полный маршрут главы (план битов → сцены → доводка → приёмка).
 *
 * Запуск:  set -a; source /home/user/.genspark_env; set +a; npx tsx scripts/live-verify-72.ts
 * Флаги окружения: SKIP_PHASE1 / SKIP_PHASE2 / SKIP_PHASE3, LIVE_MODEL, LLM_PROXY_BASE
 */
import fs from "node:fs";
import path from "node:path";
import {
  buildPersonaAndStyle,
  generateHumanizedChapter,
  humanizeProseDraft,
  rewriteDetectorAiSegments,
  type ChapterGenerateInput,
  type GenerateFn,
} from "../server/chapterGenerate.ts";
import { aiTellScore } from "../server/humanStyle.ts";

const OUT = "/home/user/workspace/live-out";
const BASE = process.env.LLM_PROXY_BASE || "https://www.genspark.ai/api/llm_proxy/v1";
const TOKEN = process.env.GSK_TOKEN || "";
const MODEL = process.env.LIVE_MODEL || "deep-seek-v4.1-flash";
const LOG = path.join(OUT, "live72-log.txt");

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(LOG, "");

function log(line: string) {
  const s = `[${new Date().toISOString().slice(11, 19)}] ${line}`;
  fs.appendFileSync(LOG, s + "\n");
  console.log(s);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let proxyCalls = 0;
let proxyErrors = 0;

async function proxyChat(
  messages: Array<{ role: string; content: string }>,
  opts: { maxTokens?: number; temperature?: number } = {},
): Promise<string> {
  if (!TOKEN) throw new Error("GSK_TOKEN не задан");
  // Шлюз отдаёт модель с размышлениями: при малом max_tokens весь бюджет уходит
  // в reasoning_tokens, content приходит пустым (finish_reason=length).
  // Поэтому пол по бюджету и удвоение при обрыве.
  let tokens = Math.max(opts.maxTokens ?? 16000, 16000);
  let lastErr = "unknown";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    proxyCalls += 1;
    const t0 = Date.now();
    try {
      const res = await fetch(`${BASE}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({
          model: MODEL,
          messages,
          temperature: opts.temperature ?? 0.7,
          max_tokens: tokens,
        }),
      });
      const raw = await res.text();
      const ms = Date.now() - t0;
      if (!res.ok) {
        lastErr = `HTTP ${res.status} ${raw.slice(0, 160)}`;
        log(`  proxy call #${proxyCalls} FAIL ${lastErr} (${ms} ms)`);
        await sleep(2500 * attempt);
        continue;
      }
      let text = "";
      let finish = "";
      try {
        const j = JSON.parse(raw) as {
          choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
        };
        text = j.choices?.[0]?.message?.content ?? "";
        finish = j.choices?.[0]?.finish_reason ?? "";
      } catch {
        lastErr = `не JSON: ${raw.slice(0, 160)}`;
        log(`  proxy call #${proxyCalls} FAIL ${lastErr}`);
        await sleep(2000 * attempt);
        continue;
      }
      if (!text.trim()) {
        lastErr = `пустой ответ (finish=${finish}, max_tokens=${tokens})`;
        log(`  proxy call #${proxyCalls} ${lastErr} за ${ms} ms — бюджет ушёл в размышления, поднимаю до ${tokens * 2}`);
        tokens = Math.min(tokens * 2, 48000);
        await sleep(1000);
        continue;
      }
      log(`  proxy #${proxyCalls} ok ${text.length} симв. за ${ms} ms`);
      return text;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
      log(`  proxy call #${proxyCalls} THROW ${lastErr}`);
      await sleep(2500 * attempt);
    }
  }
  proxyErrors += 1;
  throw new Error(`LLM-шлюз не ответил: ${lastErr}`);
}

const generate: GenerateFn = async (params) => {
  // Надбавка на размышления шлюзовой модели: приложение просит 2048–8192 токенов,
  // reasoning съедает их целиком, и content приходит пустым. Надбавка — свойство
  // стенда, а не приложения; в отчёте это указано.
  const headroom = Number(process.env.REASONING_HEADROOM ?? 14000);
  return proxyChat(
    [
      { role: "system", content: params.systemInstruction || "" },
      { role: "user", content: params.contents },
    ],
    { maxTokens: (params.maxOutputTokens ?? 8000) + headroom, temperature: params.temperature ?? 0.7 },
  );
};

// ---------------------------------------------------------------- терпимый разбор

/** Достать JSON из ответа модели: чистый, в ```-блоке, или первый сбалансированный фрагмент. */
function tolerantJson<T>(raw: string): T | null {
  const direct = (s: string): T | null => {
    try {
      return JSON.parse(s) as T;
    } catch {
      return null;
    }
  };
  const trimmed = raw.trim();
  const d0 = direct(trimmed);
  if (d0 != null) return d0;

  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    const d1 = direct(fence[1].trim());
    if (d1 != null) return d1;
  }
  for (const opener of ["{", "["]) {
    const closer = opener === "{" ? "}" : "]";
    let depth = 0;
    let start = -1;
    let inStr = false;
    let esc = false;
    for (let i = 0; i < trimmed.length; i += 1) {
      const ch = trimmed[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === opener) {
        if (depth === 0) start = i;
        depth += 1;
      } else if (ch === closer) {
        depth -= 1;
        if (depth === 0 && start >= 0) {
          const candidate = trimmed.slice(start, i + 1);
          const d2 = direct(candidate);
          if (d2 != null) return d2;
          start = -1;
        }
      }
    }
  }
  return null;
}

interface Finding {
  pass: string;
  row: string;
  severity: number;
  quote: string;
  why: string;
}

/** Нормализовать любую форму ответа в список находок. */
function extractFindings(raw: string, passId: string): { findings: Finding[]; shape: string } {
  const payload = tolerantJson<unknown>(raw);
  let list: unknown[] = [];
  let shape = "нет JSON";
  if (Array.isArray(payload)) {
    list = payload;
    shape = "массив";
  } else if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    const key = ["findings", "issues", "signals", "results", "items", "diagnosis"].find(
      (k) => Array.isArray(obj[k]),
    );
    if (key) {
      list = obj[key] as unknown[];
      shape = `объект.${key}`;
    } else if (obj.raw || obj.text) {
      list = [];
      shape = "объект без массива находок";
    }
  }
  const findings: Finding[] = [];
  for (const item of list) {
    if (typeof item === "string") {
      if (item.trim()) findings.push({ pass: passId, row: "—", severity: 2, quote: item.trim().slice(0, 200), why: "" });
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const pick = (...keys: string[]) => {
      for (const k of keys) {
        const v = o[k];
        if (typeof v === "string" && v.trim()) return v.trim();
        if (typeof v === "number") return String(v);
      }
      return "";
    };
    const quote = pick("quote", "quoted", "evidence", "пример", "цитата", "passage", "text");
    const row = pick("row", "feature", "signal", "marker", "name", "heading", "строка", "признак");
    const why = pick("why", "note", "observation", "reason", "comment", "наблюдение", "комментарий");
    const sevRaw = o.severity ?? o.sev ?? o.level ?? o.weight;
    const severity = typeof sevRaw === "number" ? sevRaw : Number.parseInt(String(sevRaw ?? "2"), 10) || 2;
    if (!quote && !row) continue;
    findings.push({ pass: passId, row: row || "—", severity, quote: quote.slice(0, 240), why: why.slice(0, 300) });
  }
  // Страховка: модель отдала прозу без JSON — вытащим хотя бы строки-цитаты.
  if (!findings.length && shape.startsWith("нет")) {
    const quoted = [...raw.matchAll(/[«"“]([^»"”]{25,200})[»"”]/g)].map((m) => m[1].trim());
    for (const q of quoted.slice(0, 8)) {
      findings.push({ pass: passId, row: "проза без JSON", severity: 2, quote: q, why: "цитата из неструктурированного ответа" });
    }
    if (quoted.length) shape = `проза, цитат ${quoted.length}`;
  }
  return { findings, shape };
}

// ---------------------------------------------------------------- вход

const draftPath = path.join(OUT, "draft.txt");
const draft = fs.readFileSync(draftPath, "utf8");
log(`Черновик: ${draft.length} симв., ${draft.trim().split(/\s+/).length} слов`);

const input: ChapterGenerateInput = {
  title: "Лабиринт",
  genre: "психологический триллер",
  description:
    "Инженер спускается в подземный технический коридор под закрытым НИИ, чтобы найти пропавшего брата; под землёй он теряет связь с поверхностью и с собственными воспоминаниями.",
  currentChapterTitle: "Глава 5. Ниже уровня земли",
  currentChapterSummary:
    "Герой входит в подземный коридор, идёт по нему, замечает следы чужого присутствия и понимает, что его никто не ищет.",
  previousChapter: draft,
  worldBible:
    "Закрытый НИИ на окраине, 1994 год. Под институтом — технический ярус: коридоры, узлы связи, бомбоубежище. Связь с поверхностью только по кабелю; мобильной нет.",
  bookPlan:
    "1) пропажа брата; 2) попытка узнать правду; 3) спуск под землю; 4) коридор и следы; 5) потеря связи; 6) выход не туда, куда он шёл.",
  canonDossier:
    "Герой — 34 года, инженер-связист, не пьёт, курит редко. Брат — старший, пропал 11 дней назад. Фонарик — телефон с севшей наполовину батареей.",
  customPrompt: "Писать плотно, без объяснений от автора, много телесных деталей и звука.",
  humanizeDepth: "balanced",
  model: MODEL,
  chapterCandidates: 1,
};

const { personaBlock } = buildPersonaAndStyle(input);

// ---------------------------------------------------------------- фаза 1

async function phase1() {
  log("=== ФАЗА 1: humanize_draft на коде 72 ===");
  const before = aiTellScore(draft);
  log(`до: score=${before.score} burst=${before.burstiness.toFixed(2)} hits=${before.hits.length} [${[...new Set(before.hits.map((h) => h.label))].join("; ")}]`);
  const t0 = Date.now();
  const res = await humanizeProseDraft(draft, generate, {
    model: MODEL,
    personaBlock,
    humanizeDepth: "maximum",
  });
  const ms = Date.now() - t0;
  fs.writeFileSync(path.join(OUT, "after72-humanize_draft.txt"), res.text);
  log(`humanize_draft за ${ms} ms → ${JSON.stringify(res.humanizeReport)}`);
  log(`текст изменился: ${res.text.trim() !== draft.trim()}`);
  return res;
}

// ---------------------------------------------------------------- фаза 2

const sepiaDir = process.env.SEPIA_REFS || "/home/user/workspace/sepia/skills/sepia/references";
const PASSES = [
  { id: "narrative", file: "narrative-pass.md" },
  { id: "discourse", file: "discourse-pass.md" },
  { id: "style", file: "style-pass.md" },
];

async function sepiaReview(name: string, text: string): Promise<Finding[]> {
  const rubric = fs.readFileSync(path.join(sepiaDir, "rubric.md"), "utf8");
  const all: Finding[] = [];
  for (const p of PASSES) {
    const guide = fs.readFileSync(path.join(sepiaDir, p.file), "utf8");
    const system =
      "Ты — редактор-диагност по протоколу sepia. Работай строго по присланной рубрике и инструкции одного прохода. " +
      "Каждое наблюдение обязано опираться на дословную короткую цитату из текста. Никаких оценок вероятностей авторства.";
    const user =
      `# Общая рубрика\n${rubric}\n\n# Инструкция прохода «${p.id}»\n${guide}\n\n` +
      `# Текст для анализа (${text.trim().split(/\s+/).length} слов)\n${text}\n\n` +
      `Верни ТОЛЬКО JSON без пояснений:\n` +
      `{"pass":"${p.id}","findings":[{"row":"<название строки рубрики дословно>","severity":2,"quote":"<дословная короткая цитата>","why":"<наблюдение>"}],"notes":"<кратко: что n/a>"}\n` +
      `Если сигналов нет — findings: []. severity: 1 = слабый, 2 = заметный, 3 = явный.`;
    const raw = await proxyChat(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      { maxTokens: 3500, temperature: 0.2 },
    );
    fs.writeFileSync(path.join(OUT, `sepia72-${name}-${p.id}-raw.txt`), raw);
    const { findings, shape } = extractFindings(raw, p.id);
    log(`  sepia ${name}/${p.id}: разбор=${shape}, находок ${findings.length}`);
    all.push(...findings);
  }
  return all;
}

async function phase2(afterText: string) {
  log("=== ФАЗА 2: приёмка sepia (внешняя рубрика, три прохода) ===");
  if (process.env.SEPIA_FILE) {
    const name = process.env.SEPIA_NAME || "extra";
    const txt = fs.readFileSync(process.env.SEPIA_FILE, "utf8");
    log(`приёмка по внешнему файлу ${name}: ${txt.length} симв.`);
    const f = await sepiaReview(name, txt);
    fs.writeFileSync(path.join(OUT, `sepia72-findings-${name}.json`), JSON.stringify(f, null, 1));
    const byPass = PASSES.map((p) => `${p.id} ${f.filter((x) => x.pass === p.id).length}`).join(", ");
    log(`находок sepia для ${name}: ${f.length} (${byPass}), сумма severity ${f.reduce((a, b) => a + b.severity, 0)}`);
    return { draftFindings: [], afterFindings: f };
  }
  const draftFindings = await sepiaReview("draft", draft);
  const afterFindings = await sepiaReview("after", afterText);
  fs.writeFileSync(path.join(OUT, "sepia72-findings-draft.json"), JSON.stringify(draftFindings, null, 1));
  fs.writeFileSync(path.join(OUT, "sepia72-findings-after.json"), JSON.stringify(afterFindings, null, 1));
  const fmt = (f: Finding[]) => f.map((x) => `  [${x.pass}] ${x.row} (sev ${x.severity}) «${x.quote}» ${x.why ? "— " + x.why : ""}`).join("\n");
  log(`находок: черновик ${draftFindings.length} → после доводки ${afterFindings.length}`);
  fs.writeFileSync(path.join(OUT, "sepia72-report.md"),
    `# Приёмка sepia, код 72\n\nМодель-исполнитель: ${MODEL}\n\n## Черновик: ${draftFindings.length} находок\n${fmt(draftFindings)}\n\n## После доводки: ${afterFindings.length} находок\n${fmt(afterFindings)}\n`);
  return { draftFindings, afterFindings };
}

// ---------------------------------------------------------------- фаза 3

async function phase3() {
  log("=== ФАЗА 3: полный маршрут generate_full_chapter ===");
  const t0 = Date.now();
  const res = await generateHumanizedChapter(input, generate);
  const ms = Date.now() - t0;
  fs.writeFileSync(path.join(OUT, "full-chapter-72.txt"), res.text);
  log(`generate_full_chapter за ${ms} ms, ${res.text.length} симв., ${res.text.trim().split(/\s+/).length} слов`);
  log(`отчёт: ${JSON.stringify(res.humanizeReport)}`);
  const direct = aiTellScore(res.text);
  log(`независимый локальный аудит финального текста: score=${direct.score} burst=${direct.burstiness.toFixed(2)} hits=${direct.hits.length}`);
  return res;
}

// ---------------------------------------------------------------- прогон

async function main() {
  log(`Шлюз: ${BASE}, модель ${MODEL}`);
  let afterText = fs.existsSync(path.join(OUT, "after-humanize_draft.txt"))
    ? fs.readFileSync(path.join(OUT, "after-humanize_draft.txt"), "utf8")
    : draft;

  if (!process.env.SKIP_PHASE1) {
    try {
      const r = await phase1();
      afterText = r.text;
    } catch (err) {
      log(`ФАЗА 1 упала: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (!process.env.SKIP_PHASE2) {
    try {
      await phase2(afterText);
    } catch (err) {
      log(`ФАЗА 2 упала: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (!process.env.SKIP_PHASE3) {
    try {
      const full = await phase3();
      if (!process.env.SKIP_PHASE2) {
        try {
          log("--- приёмка sepia по финальному тексту полного маршрута ---");
          const f = await sepiaReview("full", full.text);
          fs.writeFileSync(path.join(OUT, "sepia72-findings-full.json"), JSON.stringify(f, null, 1));
          log(`находок sepia в финале полного маршрута: ${f.length}`);
        } catch (err) {
          log(`sepia по финалу упала: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } catch (err) {
      log(`ФАЗА 3 упала: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Заодно: сегментная перезапись на том же черновике.
  if (!process.env.SKIP_PHASE4) {
    try {
      log("=== ФАЗА 4: rewrite_detector_segments ===");
      const parts = draft.split(/\n\s*\n/).filter((s) => s.trim());
      const segments = parts.map((text, i) => ({ text, label: i % 3 === 2 ? "HUMAN" : "AI" }));
      const r = await rewriteDetectorAiSegments(segments, generate, { model: MODEL, personaBlock, humanizeDepth: "maximum" });
      log(`сегментов ${segments.length}, переписано ${r.rewrittenCount}, отчёт ${JSON.stringify(r.humanizeReport)}`);
      fs.writeFileSync(path.join(OUT, "after72-rewrite_segments.txt"), r.text);
      fs.writeFileSync(path.join(OUT, "before72-rewrite_segments.txt"), draft);
    } catch (err) {
      log(`ФАЗА 4 упала: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  log(`ИТОГО: вызовов шлюза ${proxyCalls}, отказов ${proxyErrors}`);
}

main().then(
  () => log("ГОТОВО"),
  (err) => log(`КРАХ: ${err instanceof Error ? err.stack : String(err)}`),
);
