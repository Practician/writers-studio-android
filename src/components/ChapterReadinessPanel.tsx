import React, { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  FileCheck2,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { Chapter, Story } from "../types";
import { canonDossier, findPreviousCanonChapter } from "../lib/chapterContext";

type BriefField = "goal" | "change" | "emotion" | "protectedFacts" | "effect";

type EditorialBrief = Record<BriefField, string>;

type ReviewCheck = {
  title: string;
  status: "ok" | "attention" | "missing";
  note: string;
};

type ReviewRisk = {
  level: "high" | "medium" | "low";
  title: string;
  explanation: string;
  suggestion: string;
};

type EditorialReview = {
  readiness: string;
  summary: string;
  checks: ReviewCheck[];
  risks: ReviewRisk[];
  nextStep: string;
};

interface ChapterReadinessPanelProps {
  story: Story;
  activeChapter?: Chapter;
  currentDraft: string;
  selectedModel?: string;
  llmProvider?: "auto" | "gemini" | "nvidia" | "groq" | "openrouter";
  llmApiFields?: Record<string, unknown>;
  hasAuthorVoice: boolean;
  onOpenAuthorEditor: () => void;
}

const EMPTY_BRIEF: EditorialBrief = {
  goal: "",
  change: "",
  emotion: "",
  protectedFacts: "",
  effect: "",
};

const BRIEF_FIELDS: Array<{ id: BriefField; title: string; placeholder: string }> = [
  {
    id: "goal",
    title: "Цель сцены",
    placeholder: "Например: героиня получает доступ к архиву.",
  },
  {
    id: "change",
    title: "Что должно измениться к финалу",
    placeholder: "Например: она понимает, что архив ведёт к её семье.",
  },
  {
    id: "emotion",
    title: "Эмоциональный поворот",
    placeholder: "Например: от любопытства к панике.",
  },
  {
    id: "protectedFacts",
    title: "Нельзя менять",
    placeholder: "Имена, факты, предметы и ограничения именно этой сцены.",
  },
  {
    id: "effect",
    title: "Нужный эффект",
    placeholder: "Например: тихий клиффхэнгер без прямого объяснения.",
  },
];

function storageKey(storyId?: string, chapterId?: string) {
  return `writers_studio_editorial_brief_${storyId || "story"}_${chapterId || "chapter"}`;
}

function loadBrief(storyId?: string, chapterId?: string): EditorialBrief {
  try {
    const raw = localStorage.getItem(storageKey(storyId, chapterId));
    if (!raw) return EMPTY_BRIEF;
    const parsed = JSON.parse(raw);
    return { ...EMPTY_BRIEF, ...parsed };
  } catch {
    return EMPTY_BRIEF;
  }
}

function statusIcon(status: "ok" | "attention" | "missing") {
  if (status === "ok") return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
  return <AlertCircle className={`w-3.5 h-3.5 shrink-0 ${status === "missing" ? "text-red-400" : "text-amber-400"}`} />;
}

function riskClasses(level: ReviewRisk["level"]) {
  if (level === "high") return "border-red-900/60 bg-red-950/25 text-red-200";
  if (level === "medium") return "border-amber-900/60 bg-amber-950/20 text-amber-100";
  return "border-slate-800 bg-slate-950/50 text-slate-300";
}

export default function ChapterReadinessPanel({
  story,
  activeChapter,
  currentDraft,
  selectedModel,
  llmProvider = "auto",
  llmApiFields,
  hasAuthorVoice,
  onOpenAuthorEditor,
}: ChapterReadinessPanelProps) {
  const [brief, setBrief] = useState<EditorialBrief>(() => loadBrief(story.id, activeChapter?.id));
  const [review, setReview] = useState<EditorialReview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const previousChapter = useMemo(
    () => activeChapter ? findPreviousCanonChapter(story.chapters || [], activeChapter) : null,
    [activeChapter, story.chapters],
  );
  const worldBible = story.worldBible || story.worldRules?.map((rule) => `[${rule.title}] ${rule.content}`).join("\n\n") || "";
  const bookPlan = story.bookPlan || "";
  const canonicalBrief = activeChapter ? canonDossier(story, activeChapter, previousChapter) : "";

  useEffect(() => {
    setBrief(loadBrief(story.id, activeChapter?.id));
    setReview(null);
    setError("");
  }, [story.id, activeChapter?.id]);

  const preflight = [
    {
      title: "Текст главы",
      detail: currentDraft.trim() ? `${currentDraft.trim().length.toLocaleString("ru-RU")} знаков` : "Нет текста для проверки",
      status: currentDraft.trim() ? "ok" : "missing",
    },
    {
      title: "Синопсис",
      detail: activeChapter?.summary?.trim() ? "Учтён" : "Не заполнен",
      status: activeChapter?.summary?.trim() ? "ok" : "attention",
    },
    {
      title: "Предыдущая глава",
      detail: previousChapter?.content?.trim() ? `«${previousChapter.title}»` : "Нет доступного контекста",
      status: previousChapter?.content?.trim() ? "ok" : "attention",
    },
    {
      title: "Библия мира",
      detail: worldBible.trim() ? "Учтена" : "Не заполнена",
      status: worldBible.trim() ? "ok" : "attention",
    },
    {
      title: "План книги",
      detail: bookPlan.trim() ? "Учтён" : "Не заполнен",
      status: bookPlan.trim() ? "ok" : "attention",
    },
    {
      title: "Голос автора",
      detail: hasAuthorVoice ? "Есть образец" : "Проверка возможна без образца",
      status: hasAuthorVoice ? "ok" : "attention",
    },
  ] as Array<{ title: string; detail: string; status: "ok" | "attention" | "missing" }>;

  const updateBrief = (field: BriefField, value: string) => {
    setBrief((previous) => {
      const next = { ...previous, [field]: value };
      try {
        localStorage.setItem(storageKey(story.id, activeChapter?.id), JSON.stringify(next));
      } catch {
        // Бриф остаётся доступным в рамках текущей сессии, даже если локальное хранилище недоступно.
      }
      return next;
    });
  };

  const runReview = async () => {
    if (!activeChapter || !currentDraft.trim()) {
      setError("Добавьте текст текущей главы — тогда можно будет сформировать редакторскую проверку.");
      return;
    }

    setLoading(true);
    setError("");
    setReview(null);
    try {
      const response = await fetch("/api/writer/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "editorial_review",
          text: currentDraft,
          title: story.title,
          genre: story.genre,
          description: story.description,
          currentChapterTitle: activeChapter.title,
          currentChapterSummary: activeChapter.summary || "",
          previousChapter: previousChapter?.content || "",
          worldBible,
          bookPlan,
          canonDossier: canonicalBrief,
          editorialBrief: brief,
          hasAuthorVoice,
          ...(llmApiFields || { model: selectedModel, llmProvider }),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Не удалось выполнить редакторскую проверку.");
      if (!data.review) throw new Error("Сервис вернул неполный редакторский отчёт. Попробуйте ещё раз.");
      setReview(data.review as EditorialReview);
    } catch (reviewError: any) {
      setError(reviewError.message || "Не удалось выполнить редакторскую проверку.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4" id="chapter-readiness-panel">
      <div className="rounded-xl border border-violet-900/50 bg-violet-950/20 p-3.5 space-y-2">
        <div className="flex items-center gap-2 text-violet-200">
          <ClipboardCheck className="w-4 h-4" />
          <h3 className="text-xs font-bold">Подготовить главу к следующему шагу</h3>
        </div>
        <p className="text-[11px] leading-relaxed text-slate-300">
          Внутренний редактор сверит главу с вашим сюжетом, лором и брифом. Он не меняет текст автоматически: сначала показывает, что проверить и что усилить.
        </p>
      </div>

      <section className="space-y-2" aria-label="Предполётная проверка">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          <ShieldCheck className="w-3.5 h-3.5" />
          Что будет учтено
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {preflight.map((item) => (
            <div key={item.title} className="rounded-lg border border-slate-800 bg-slate-950/45 p-2 text-[10px]">
              <div className="flex items-center gap-1.5 text-slate-200">
                {statusIcon(item.status)}
                <span className="font-medium truncate">{item.title}</span>
              </div>
              <p className="mt-1 truncate text-slate-500" title={item.detail}>{item.detail}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-2" aria-label="Редакторский бриф">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Редакторский бриф</span>
          <span className="text-[10px] text-slate-500">Необязательно, сохраняется для этой главы</span>
        </div>
        <p className="text-[10px] leading-relaxed text-slate-500">
          Несколько коротких ориентиров помогают проверить именно ваш замысел, а не усреднённую версию сцены.
        </p>
        <div className="space-y-2">
          {BRIEF_FIELDS.map((field) => (
            <label key={field.id} className="block space-y-1">
              <span className="text-[10px] text-slate-400">{field.title}</span>
              <textarea
                value={brief[field.id]}
                onChange={(event) => updateBrief(field.id, event.target.value)}
                rows={field.id === "protectedFacts" ? 2 : 1}
                placeholder={field.placeholder}
                className="w-full resize-y rounded-lg border border-slate-800 bg-slate-950 p-2 text-[11px] text-slate-200 outline-none focus:border-violet-600"
              />
            </label>
          ))}
        </div>
      </section>

      <button
        type="button"
        onClick={runReview}
        disabled={loading || !currentDraft.trim()}
        className="w-full rounded-lg bg-gradient-to-r from-violet-700 to-blue-700 py-2.5 text-xs font-bold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-40"
        id="chapter-readiness-run-btn"
      >
        {loading ? <Loader2 className="inline h-4 w-4 animate-spin mr-1" /> : <FileCheck2 className="inline h-4 w-4 mr-1" />}
        {loading ? "Проверяем главу…" : "Сформировать редакторское письмо"}
      </button>

      {error && <div className="rounded-lg border border-red-900/60 bg-red-950/25 p-2.5 text-[11px] text-red-300">{error}</div>}

      {review && (
        <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/50 p-3" id="chapter-readiness-result">
          <div className="flex items-start gap-2">
            <FileCheck2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
            <div>
              <p className="text-xs font-bold text-slate-100">{review.readiness || "Редакторская проверка завершена"}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-300">{review.summary}</p>
            </div>
          </div>

          {review.checks?.length > 0 && (
            <div className="space-y-1.5 border-t border-slate-800 pt-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Что проверено</p>
              {review.checks.map((check, index) => (
                <div key={`${check.title}-${index}`} className="flex items-start gap-1.5 text-[11px] text-slate-300">
                  {statusIcon(check.status)}
                  <p><strong className="font-semibold text-slate-200">{check.title}.</strong> {check.note}</p>
                </div>
              ))}
            </div>
          )}

          {review.risks?.length > 0 && (
            <div className="space-y-2 border-t border-slate-800 pt-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Ручная проверка автора</p>
              {review.risks.map((risk, index) => (
                <div key={`${risk.title}-${index}`} className={`rounded-lg border p-2 text-[10px] ${riskClasses(risk.level)}`}>
                  <p className="font-semibold">{risk.title}</p>
                  <p className="mt-0.5 leading-relaxed opacity-90">{risk.explanation}</p>
                  <p className="mt-1 leading-relaxed"><span className="font-semibold">Действие:</span> {risk.suggestion}</p>
                </div>
              ))}
            </div>
          )}

          <div className="rounded-lg border border-blue-900/50 bg-blue-950/20 p-2.5 text-[11px] text-blue-100">
            <p className="font-semibold text-blue-200">Следующий шаг</p>
            <p className="mt-1 leading-relaxed">{review.nextStep}</p>
          </div>

          <button
            type="button"
            onClick={onOpenAuthorEditor}
            className="w-full rounded-lg border border-emerald-800/70 bg-emerald-950/25 py-2 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-950/45"
          >
            Открыть безопасную редактуру
            <ChevronRight className="inline h-3.5 w-3.5 ml-1" />
          </button>
        </section>
      )}
    </div>
  );
}
