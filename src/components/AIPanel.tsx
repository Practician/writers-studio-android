import React, { useEffect, useRef, useState } from "react";
import { Sparkles, Wand2, ArrowRight, Copy, Check, ChevronRight, HelpCircle, FileText, CheckCircle2, AlertCircle, Square } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Story, Chapter, TextSelection, AuthorEditTarget, AuthorProfileRecord, HumanizeReport } from "../types";
import AuthorEditorPanel from "./AuthorEditorPanel";
import ChapterReadinessPanel from "./ChapterReadinessPanel";
import { loadAuthorProfile, onAuthorProfileUpdated } from "../lib/authorStorage";
import { canonDossier, findPreviousCanonChapter } from "../lib/chapterContext";
import { HUMANIZE_DEPTHS, VOICE_PRESETS, type HumanizeDepth } from "../../server/humanStyle";
import { buildAdaptiveWritingGuidance, loadAdaptiveProfile } from "../lib/adaptiveDetector";
import { generationFinished, generationStarted, type GenerationOutcome } from "../lib/generationFeedback";

interface AIPanelProps {
  story: Story;
  currentDraft: string;
  selectedText: string;
  textSelection: TextSelection | null;
  onInsertText: (text: string, actionType: "append" | "replace") => void;
  onApplyAuthorEdit: (text: string, target: AuthorEditTarget) => boolean;
  activeChapter?: Chapter;
  onUpdateStoryChapters?: (chapters: Chapter[]) => void;
  selectedModel?: string;
  /** gemini | nvidia | groq | openrouter | auto — выбор в шапке */
  llmProvider?: "auto" | "gemini" | "nvidia" | "groq" | "openrouter";
  /** model + llmProvider + apiKeys из шапки */
  llmApiFields?: Record<string, unknown>;
  openAuthorRequest?: number;
  /** Запрос с главного экрана: сразу открыть короткое продолжение без прокрутки. */
  quickContinueRequest?: number;
  onOpenAuthorProfile?: () => void;
  /** Открывает углублённый маршрут агента после быстрой проверки главы. */
  onOpenAgent?: () => void;
}

export default function AIPanel({ story, currentDraft, selectedText, textSelection, onInsertText, onApplyAuthorEdit, activeChapter, onUpdateStoryChapters, selectedModel, llmProvider = "auto", llmApiFields, openAuthorRequest, quickContinueRequest, onOpenAuthorProfile, onOpenAgent }: AIPanelProps) {
  const [activeTool, setActiveTool] = useState<"continue" | "improve" | "author" | "readiness" | "brainstorm">("continue");
  useEffect(() => {
    if (openAuthorRequest) setActiveTool("author");
  }, [openAuthorRequest]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Отмена текущей генерации (Продолжить сюжет / пакет глав / улучшение / идеи). */
  const abortRef = useRef<AbortController | null>(null);

  const handleStopGeneration = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
    setBatchProgress(null);
    setError("Генерация остановлена.");
  };

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // Continuation States
  const [continueMode, setContinueMode] = useState<"paragraphs" | "whole_chapter" | "multi_chapters">("paragraphs");
  useEffect(() => {
    if (!quickContinueRequest) return;
    setActiveTool("continue");
    setContinueMode("paragraphs");
    setResult("");
    setError(null);
  }, [quickContinueRequest]);
  const [continuePrompt, setContinuePrompt] = useState("");
  const [selectedBatchChapters, setSelectedBatchChapters] = useState<string[]>([]);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number; status: string } | null>(null);

  // Style Improver States
  const [stylePreset, setStylePreset] = useState("sensory");
  const [improvePrompt, setImprovePrompt] = useState("");

  // Brainstorming States
  const [brainstormCategory, setBrainstormCategory] = useState("Идея для сюжета");
  const [brainstormTopic, setBrainstormTopic] = useState("");

  // Humanized Generation States
  const [humanize, setHumanize] = useState(true);
  // Авторский режим по умолчанию: самый глубокий пайплайн. Для пустой книги
  // интерфейс всё равно попросит образец голоса перед запуском.
  const [humanizeDepth, setHumanizeDepth] = useState<HumanizeDepth>("maximum");
  const [voicePreset, setVoicePreset] = useState("neutral");
  const [authorProfile, setAuthorProfile] = useState<AuthorProfileRecord | null>(null);
  const [humanizeReport, setHumanizeReport] = useState<HumanizeReport | null>(null);

  /** Явный образец из вкладки «Автор» (≥300 знаков). */
  const profileSample = (authorProfile?.sample || "").trim();
  const hasProfileSample = profileSample.length >= 300;

  /**
   * Fallback: уже написанные главы книги (кроме текущей) — чтобы «Максимум»
   * работал без отдельной загрузки образца, если в проекте уже есть текст.
   */
  const buildFallbackAuthorSample = (excludeChapterId?: string, minChars = 300): string => {
    const candidates = (story.chapters || [])
      .filter((ch) => ch.id !== excludeChapterId && (ch.content || "").trim().length >= 100)
      .map((ch) => (ch.content || "").trim())
      .sort((a, b) => b.length - a.length);
    if (!candidates.length) return "";
    let sample = "";
    for (const text of candidates) {
      if (sample.length >= 10_000) break;
      sample = sample ? `${sample}\n\n${text}` : text;
    }
    return sample.length >= minChars ? sample.slice(0, 12_000) : "";
  };

  const resolveAuthorSample = (excludeChapterId?: string): string => {
    if (hasProfileSample) return profileSample;
    return buildFallbackAuthorSample(excludeChapterId);
  };

  const fallbackSample = buildFallbackAuthorSample(activeChapter?.id);
  const hasAuthorSample = hasProfileSample || fallbackSample.length >= 300;
  const sampleSource: "profile" | "chapters" | "none" = hasProfileSample
    ? "profile"
    : fallbackSample.length >= 300
      ? "chapters"
      : "none";

  const refreshAuthorProfile = () => {
    loadAuthorProfile(story.id)
      .then((profile) => setAuthorProfile(profile ?? null))
      .catch(() => setAuthorProfile(null));
  };

  useEffect(() => {
    let cancelled = false;
    loadAuthorProfile(story.id)
      .then((profile) => { if (!cancelled) setAuthorProfile(profile ?? null); })
      .catch(() => { if (!cancelled) setAuthorProfile(null); });
    return () => { cancelled = true; };
  }, [story.id, activeTool]);

  // Единый профиль автора может измениться из верхней панели в любой момент.
  useEffect(() => onAuthorProfileUpdated(refreshAuthorProfile), [story.id]);

  // Дополняет запрос генерации данными для «очеловечивания с первого прохода»
  const applyHumanizePayload = (payload: any, excludeChapterId?: string) => {
    payload.humanize = humanize;
    if (!humanize) return;
    payload.humanizeDepth = humanizeDepth;
    if (authorProfile?.voiceSheet) payload.voiceSheet = authorProfile.voiceSheet;
    const sample = resolveAuthorSample(excludeChapterId ?? activeChapter?.id);
    if (sample) payload.authorSample = sample;
    if (!authorProfile?.voiceSheet) payload.voicePreset = voicePreset;
    const adaptiveStyleGuidance = buildAdaptiveWritingGuidance(loadAdaptiveProfile(story.id));
    if (adaptiveStyleGuidance) payload.adaptiveStyleGuidance = adaptiveStyleGuidance;
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(result);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleUseResult = (actionType: "append" | "replace") => {
    onInsertText(result, actionType);
  };

  // Detect Materials for Chapter Generation
  const getPrevChapter = () => {
    if (!activeChapter || !story.chapters) return null;
    return findPreviousCanonChapter(story.chapters, activeChapter);
  };

  const getBibleSummary = () => {
    if (story.worldBible && story.worldBible.trim()) {
      return { found: true, text: "Библия мира заполнена" };
    }
    const totalRules = story.worldRules?.length || 0;
    if (totalRules > 0) {
      return { found: true, text: `${totalRules} записей лора` };
    }
    return { found: false, text: "Не заполнено (будет использовано описание книги)" };
  };

  const getPlanSummary = () => {
    if (story.bookPlan && story.bookPlan.trim()) {
      return { found: true, text: "План сюжета заполнен" };
    }
    const planChapter = story.chapters?.find(ch => 
      ch.title.toLowerCase().includes("план") || 
      ch.title.toLowerCase().includes("сюжет")
    );
    if (planChapter && planChapter.content.trim()) {
      return { found: true, text: `Найден («${planChapter.title}»)` };
    }
    return { found: false, text: "Не заполнено (будет использовано описание книги)" };
  };

  const handleBatchGenerate = async () => {
    if (selectedBatchChapters.length === 0) {
      alert("Пожалуйста, выберите хотя бы одну главу для генерации!");
      return;
    }

    // Подтянуть свежий образец из IndexedDB (на случай загрузки во вкладке «Автор»)
    let liveProfile = authorProfile;
    try {
      liveProfile = (await loadAuthorProfile(story.id)) ?? null;
      setAuthorProfile(liveProfile);
    } catch { /* keep current */ }

    const liveSample = (liveProfile?.sample || "").trim().length >= 300
      || buildFallbackAuthorSample().length >= 300;
    if (humanize && humanizeDepth === "maximum" && !liveSample) {
      alert("Режим «Максимум» нужен образец стиля (≥300 знаков): загрузите текст во вкладке «Автор» или напишите хотя бы одну главу в книге. Либо выберите «Баланс» / «Быстро».");
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    setResult("");
    setBatchProgress({ current: 0, total: selectedBatchChapters.length, status: "Подготовка..." });
    void generationStarted();

    let outcome: GenerationOutcome = "success";
    let currentChapters = [...story.chapters];
    let completed = 0;

    try {
      for (let i = 0; i < selectedBatchChapters.length; i++) {
        if (controller.signal.aborted) break;

        const chapterId = selectedBatchChapters[i];
        const ch = currentChapters.find(c => c.id === chapterId);
        if (!ch) continue;

        setBatchProgress({
          current: i + 1,
          total: selectedBatchChapters.length,
          status: `Генерируем «${ch.title}»...`
        });

        const prevCh = findPreviousCanonChapter(currentChapters, ch);
        const prevChapterContent = prevCh ? `Глава: ${prevCh.title}\n\n${prevCh.content}` : "";

        const worldBibleText = story.worldBible || story.worldRules?.map(r => `[${r.title}]: ${r.content}`).join("\n\n") || story.description;
        const bookPlanText = story.bookPlan || "";

        const batchPayload: any = {
          action: "generate_full_chapter",
          title: story.title,
          genre: story.genre,
          description: story.description,
          currentChapterTitle: ch.title,
          currentChapterSummary: ch.summary || "",
          previousChapter: prevChapterContent,
          worldBible: worldBibleText,
          bookPlan: bookPlanText,
          canonDossier: canonDossier(story, ch, prevCh),
          customPrompt: continuePrompt,
          ...(llmApiFields || { model: selectedModel, llmProvider }),
        };
        applyHumanizePayload(batchPayload, ch.id);

        const response = await fetch("/api/writer/ai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(batchPayload),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errData = await response.json();
          throw new Error(`Ошибка при генерации главы «${ch.title}»: ${errData.error || "Неизвестная ошибка"}`);
        }

        const data = await response.json();
        
        currentChapters = currentChapters.map(c => 
          c.id === chapterId ? { ...c, content: data.result } : c
        );

        if (onUpdateStoryChapters) {
          onUpdateStoryChapters(currentChapters);
        }
        completed += 1;
      }

      if (controller.signal.aborted) {
        outcome = "cancelled";
        setError(
          completed > 0
            ? `Генерация остановлена. Успешно сохранено глав: ${completed}.`
            : "Генерация остановлена.",
        );
      } else {
        setResult(`Успешно сгенерировано и сохранено ${selectedBatchChapters.length} глав! 🎉 Вы можете переключить главы в левом меню, чтобы ознакомиться с результатом.`);
        setSelectedBatchChapters([]);
      }
    } catch (err: any) {
      outcome = err?.name === "AbortError" || controller.signal.aborted ? "cancelled" : "error";
      if (err?.name === "AbortError" || controller.signal.aborted) {
        setError(
          completed > 0
            ? `Генерация остановлена. Успешно сохранено глав: ${completed}.`
            : "Генерация остановлена.",
        );
      } else {
        setError(err.message || "Произошла непредвиденная ошибка при пакетной генерации.");
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setLoading(false);
      setBatchProgress(null);
      void generationFinished(outcome);
    }
  };

  const handleAction = async () => {
    // Перед генерацией перечитать образец — мог быть только что загружен во вкладке «Автор»
    const liveProfile = await loadAuthorProfile(story.id).catch(() => null);
    if (liveProfile) setAuthorProfile(liveProfile);

    const liveProfileSample = (liveProfile?.sample || "").trim();
    const liveHasSample =
      liveProfileSample.length >= 300
      || buildFallbackAuthorSample(activeChapter?.id).length >= 300;

    if (
      humanize
      && humanizeDepth === "maximum"
      && !liveHasSample
      && activeTool === "continue"
      && continueMode === "whole_chapter"
    ) {
      setError("Режим «Максимум» нужен образец стиля (≥300 знаков): вкладка «Автор» или уже написанные главы. Либо выберите «Баланс» / «Быстро».");
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    setResult("");
    setHumanizeReport(null);
    void generationStarted();

    let outcome: GenerationOutcome = "success";
    let payload: any = { action: activeTool, ...(llmApiFields || { model: selectedModel, llmProvider }) };
    if (activeTool === "continue" || activeTool === "improve") {
      applyHumanizePayload(payload, activeChapter?.id);
      // State может отставать — явная подстановка свежего образца из IndexedDB
      if (liveProfileSample.length >= 300) {
        payload.authorSample = liveProfileSample;
        if (liveProfile?.voiceSheet) payload.voiceSheet = liveProfile.voiceSheet;
      }
    }

    if (activeTool === "continue") {
      if (continueMode === "whole_chapter") {
        const prevCh = getPrevChapter();
        const prevChapterContent = prevCh ? `Глава: ${prevCh.title}\n\n${prevCh.content}` : "";
        
        // World Bible (joined worldRules)
        const worldBibleText = story.worldBible || story.worldRules?.map(r => `[${r.title}]: ${r.content}`).join("\n\n") || story.description;
        
        // Plan
        const planChapter = story.chapters?.find(ch => 
          ch.title.toLowerCase().includes("план") || 
          ch.title.toLowerCase().includes("сюжет")
        );
        const bookPlanText = story.bookPlan || (planChapter ? planChapter.content : "");

        payload.action = "generate_full_chapter";
        payload.genre = story.genre;
        payload.description = story.description;
        payload.currentChapterTitle = activeChapter?.title || "Без названия";
        payload.previousChapter = prevChapterContent;
        payload.worldBible = worldBibleText;
        payload.bookPlan = bookPlanText;
        if (activeChapter) payload.canonDossier = canonDossier(story, activeChapter, prevCh);
        payload.customPrompt = continuePrompt;
      } else {
        payload.text = currentDraft;
        payload.customPrompt = continuePrompt;
      }
    } else if (activeTool === "improve") {
      payload.text = selectedText || currentDraft; // defaults to full draft if no selection
      payload.stylePreset = stylePreset;
      payload.customPrompt = improvePrompt;
    } else if (activeTool === "brainstorm") {
      payload.category = brainstormCategory;
      payload.topic = brainstormTopic || `История под названием «${story.title}»: ${story.description}`;
    }

    try {
      const response = await fetch("/api/writer/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Ошибка соединения с ИИ.");
      }

      const data = await response.json();
      if (controller.signal.aborted) {
        outcome = "cancelled";
        return;
      }
      setResult(data.result);
      setHumanizeReport(data.humanizeReport ?? null);
    } catch (err: any) {
      outcome = err?.name === "AbortError" || controller.signal.aborted ? "cancelled" : "error";
      if (err?.name === "AbortError" || controller.signal.aborted) {
        setError("Генерация остановлена.");
      } else {
        setError(err.message || "Произошла непредвиденная ошибка ИИ.");
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setLoading(false);
      void generationFinished(outcome);
    }
  };

  const prevCh = getPrevChapter();
  const bibleSummary = getBibleSummary();
  const planSummary = getPlanSummary();

  return (
    <div className="flex min-h-0 flex-col bg-slate-900/50 border border-slate-800 rounded-xl overflow-visible lg:h-full lg:overflow-hidden" id="ai-panel-container">
      {/* Один результат автора — одна точка входа. Детали раскрываются только после выбора действия. */}
      <div className="grid shrink-0 grid-cols-2 sm:grid-cols-4 gap-1 border-b border-slate-800 bg-slate-950/95 p-1 text-[11px] font-semibold">
        <button
          type="button"
          onClick={() => { setActiveTool("continue"); setContinueMode("whole_chapter"); setResult(""); }}
          className={`rounded-lg px-1 py-2 transition-colors cursor-pointer ${
            activeTool === "continue" && continueMode !== "paragraphs"
              ? "bg-blue-600/25 text-blue-300 border border-blue-500/30"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          Написать
        </button>
        <button
          type="button"
          onClick={() => { setActiveTool("continue"); setContinueMode("paragraphs"); setResult(""); }}
          className={`rounded-lg px-1 py-2 transition-colors cursor-pointer ${
            activeTool === "continue" && continueMode === "paragraphs"
              ? "bg-blue-600/25 text-blue-300 border border-blue-500/30"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          Продолжить
        </button>
        <button
          type="button"
          onClick={() => { setActiveTool("improve"); setResult(""); }}
          className={`rounded-lg px-1 py-2 transition-colors cursor-pointer ${
            activeTool === "improve" || activeTool === "author"
              ? "bg-emerald-600/20 text-emerald-300 border border-emerald-500/30"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          Редактировать
        </button>
        <button
          type="button"
          onClick={() => { setActiveTool("readiness"); setResult(""); }}
          className={`rounded-lg px-1 py-2 transition-colors cursor-pointer ${
            activeTool === "readiness"
              ? "bg-violet-600/25 text-violet-300 border border-violet-500/30"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          Проверить
        </button>
      </div>

      {/* Отдельная мобильная панель запуска: всегда видна, даже если длинная форма прокручивается. */}
      {activeTool !== "author" && activeTool !== "readiness" && (
        <div className="lg:hidden shrink-0 border-b border-slate-800 bg-slate-950/95 p-2">
          {loading ? (
            <button type="button" onClick={handleStopGeneration} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-red-800/60 bg-red-950/50 px-3 text-xs font-semibold text-red-200">
              <Square className="h-4 w-4 fill-current" /> Остановить генерацию
            </button>
          ) : activeTool === "continue" && continueMode === "multi_chapters" ? (
            <button type="button" onClick={handleBatchGenerate} disabled={selectedBatchChapters.length === 0} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 px-3 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:from-slate-800 disabled:to-slate-800 disabled:opacity-60">
              <Wand2 className="h-4 w-4" /> Сгенерировать главы ({selectedBatchChapters.length})
            </button>
          ) : (
            <button type="button" onClick={handleAction} disabled={activeTool === "improve" && !selectedText && !currentDraft} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 px-3 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:from-slate-800 disabled:to-slate-800 disabled:opacity-60" id="ai-mobile-action-btn">
              <Wand2 className="h-4 w-4" />
              {activeTool === "continue" && (continueMode === "whole_chapter" ? "Написать главу" : "Сгенерировать продолжение")}
              {activeTool === "improve" && "Отполировать текст"}
              {activeTool === "brainstorm" && "Устроить мозговой штурм"}
            </button>
          )}
        </div>
      )}

      {/* Main Form Fields */}
      <div className="min-h-0 p-4 space-y-4 lg:flex-1 lg:overflow-y-auto">
        {activeTool === "continue" && (
          <div className="space-y-4">
            {/* Mode Switcher */}
            <div className="bg-slate-950/40 p-1 rounded-xl border border-slate-800 flex text-[10px] font-semibold">
              <button
                type="button"
                onClick={() => setContinueMode("paragraphs")}
                className={`flex-1 py-1.5 text-center rounded-lg transition-all ${
                  continueMode === "paragraphs"
                    ? "bg-slate-800 text-slate-100 border border-slate-700/50"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                📄 Абзацы
              </button>
              <button
                type="button"
                onClick={() => setContinueMode("whole_chapter")}
                className={`flex-1 py-1.5 text-center rounded-lg transition-all ${
                  continueMode === "whole_chapter"
                    ? "bg-purple-950/40 text-purple-300 border border-purple-800/40"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                📚 Глава
              </button>
              <button
                type="button"
                onClick={() => setContinueMode("multi_chapters")}
                className={`flex-1 py-1.5 text-center rounded-lg transition-all ${
                  continueMode === "multi_chapters"
                    ? "bg-indigo-950/40 text-indigo-300 border border-indigo-800/40"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                🗂️ Ряд глав
              </button>
            </div>

            {continueMode === "paragraphs" && (
              <div className="space-y-3.5">
                <div className="bg-blue-950/20 border border-blue-900/30 p-3 rounded-lg">
                  <p className="text-[11px] text-blue-400 leading-relaxed">
                    ℹ️ ИИ прочитает текст текущей главы и напишет следующие 1-3 абзаца, идеально подстраиваясь под ваш слог и тон повествования.
                  </p>
                </div>
                <div className="space-y-1">
                  <label className="block text-[11px] text-slate-400 font-semibold uppercase tracking-wider">
                    Пожелание к продолжению (необязательно)
                  </label>
                  <textarea
                    value={continuePrompt}
                    onChange={(e) => setContinuePrompt(e.target.value)}
                    placeholder="Например: Сделай концовку таинственной, пусть неожиданно погаснет свет, или капитан услышит странный шорох."
                    rows={3}
                    className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded p-2.5 text-xs text-slate-200 focus:ring-1 focus:ring-blue-500 outline-none font-sans"
                  />
                </div>
              </div>
            )}

            {continueMode === "whole_chapter" && (
              <div className="space-y-4">
                <div className="bg-purple-950/25 border border-purple-900/30 p-3.5 rounded-xl space-y-3">
                  <h4 className="text-[11px] text-purple-300 font-bold uppercase tracking-wider flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 animate-pulse text-purple-400" />
                    ИИ-синтез всей главы
                  </h4>
                  <p className="text-[10px] text-slate-400 leading-relaxed">
                    Муза автоматически сопоставит законы вашей Библии мира с главами сюжета и напишет полноценную художественную главу с сохранением стиля.
                  </p>

                  <div className="border-t border-purple-900/20 pt-2 space-y-1.5 text-[10px]">
                    <div className="flex justify-between items-center text-slate-300">
                      <span className="text-slate-400">Предыдущая глава:</span>
                      <span className="font-medium flex items-center gap-1">
                        {prevCh ? (
                          <>
                            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                            «{prevCh.title}»
                          </>
                        ) : (
                          <>
                            <AlertCircle className="w-3 h-3 text-amber-400" />
                            Первая глава (Пролог)
                          </>
                        )}
                      </span>
                    </div>

                    <div className="flex justify-between items-center text-slate-300">
                      <span className="text-slate-400">Библия мира:</span>
                      <span className="font-medium flex items-center gap-1">
                        {bibleSummary.found ? (
                          <>
                            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                            {bibleSummary.text}
                          </>
                        ) : (
                          <>
                            <AlertCircle className="w-3 h-3 text-amber-400" />
                            {bibleSummary.text}
                          </>
                        )}
                      </span>
                    </div>

                    <div className="flex justify-between items-center text-slate-300">
                      <span className="text-slate-400">План сюжета:</span>
                      <span className="font-medium flex items-center gap-1">
                        {planSummary.found ? (
                          <>
                            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                            {planSummary.text}
                          </>
                        ) : (
                          <>
                            <AlertCircle className="w-3 h-3 text-amber-400" />
                            {planSummary.text}
                          </>
                        )}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="block text-[11px] text-slate-400 font-semibold uppercase tracking-wider">
                    Особые пожелания и фокус для новой главы
                  </label>
                  <textarea
                    value={continuePrompt}
                    onChange={(e) => setContinuePrompt(e.target.value)}
                    placeholder="Пример: Сэм должен проникнуть в архив корпорации и найти доказательства экспериментов. В конце главы за ним должна начаться погоня."
                    rows={4}
                    className="w-full bg-slate-950 border border-slate-800 focus:border-purple-500 rounded p-2.5 text-xs text-slate-200 outline-none font-sans"
                  />
                </div>
              </div>
            )}

            {continueMode === "multi_chapters" && (
              <div className="space-y-4">
                <div className="bg-indigo-950/25 border border-indigo-900/30 p-3.5 rounded-xl space-y-3">
                  <h4 className="text-[11px] text-indigo-300 font-bold uppercase tracking-wider flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 animate-pulse text-indigo-400" />
                    Пакетное написание глав
                  </h4>
                  <p className="text-[10px] text-slate-400 leading-relaxed">
                    Выберите несколько глав из списка ниже. Муза последовательно сгенерирует художественный текст для каждой из них, опираясь на сюжет и предыдущий контекст.
                  </p>
                </div>

                {/* Chapters Selection List */}
                <div className="space-y-1.5">
                  <label className="block text-[11px] text-slate-400 font-semibold uppercase tracking-wider">
                    Выберите главы для генерации:
                  </label>
                  <div className="max-h-[160px] overflow-y-auto border border-slate-800 bg-slate-950/40 rounded-lg p-2 space-y-1">
                    {story.chapters?.map((ch) => {
                      const isSelected = selectedBatchChapters.includes(ch.id);
                      return (
                        <label
                          key={ch.id}
                          className="flex items-center gap-2 p-1.5 rounded hover:bg-slate-800/40 cursor-pointer text-xs text-slate-300 transition-colors"
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedBatchChapters([...selectedBatchChapters, ch.id]);
                              } else {
                                setSelectedBatchChapters(selectedBatchChapters.filter(id => id !== ch.id));
                              }
                            }}
                            className="rounded border-slate-800 bg-slate-950 text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5"
                          />
                          <span className="truncate flex-1">{ch.title}</span>
                          {ch.content?.trim() ? (
                            <span className="text-[9px] px-1 bg-emerald-950 border border-emerald-900/50 text-emerald-400 rounded">Есть текст</span>
                          ) : (
                            <span className="text-[9px] px-1 bg-slate-900 border border-slate-800 text-slate-400 rounded">Пусто</span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="block text-[11px] text-slate-400 font-semibold uppercase tracking-wider">
                    Общие пожелания к этим главам (необязательно)
                  </label>
                  <textarea
                    value={continuePrompt}
                    onChange={(e) => setContinuePrompt(e.target.value)}
                    placeholder="Например: Сделай диалоги более динамичными, держи атмосферу саспенса."
                    rows={3}
                    className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded p-2.5 text-xs text-slate-200 outline-none font-sans"
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {activeTool === "improve" && (
          <div className="space-y-3.5">
            <div className="bg-slate-950/40 p-3.5 rounded-lg border border-slate-800">
              <span className="text-[10px] text-slate-400 uppercase font-semibold block mb-1">Выделенный фрагмент</span>
              {selectedText ? (
                <p className="text-xs text-slate-300 italic line-clamp-3 bg-slate-900/50 p-2 border border-slate-800/50 rounded">
                  «{selectedText}»
                </p>
              ) : (
                <p className="text-xs text-slate-400 italic">
                  Выделите любой текст в черновике слева, чтобы улучшить конкретно его. Иначе будет отредактирована вся глава.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="block text-[11px] text-slate-400 font-semibold uppercase tracking-wider">
                Стиль улучшения (Пресет)
              </label>
              <div className="grid grid-cols-2 gap-1.5 text-xs" id="style-presets-grid">
                <button
                  onClick={() => setStylePreset("sensory")}
                  className={`p-2 border text-left rounded-lg transition-colors cursor-pointer ${
                    stylePreset === "sensory"
                      ? "bg-purple-950/30 text-purple-300 border-purple-800"
                      : "bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700"
                  }`}
                >
                  🎭 Красочный (Описания)
                </button>
                <button
                  onClick={() => setStylePreset("dramatic")}
                  className={`p-2 border text-left rounded-lg transition-colors cursor-pointer ${
                    stylePreset === "dramatic"
                      ? "bg-purple-950/30 text-purple-300 border-purple-800"
                      : "bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700"
                  }`}
                >
                  ⚡ Драматичный (Накал)
                </button>
                <button
                  onClick={() => setStylePreset("concise")}
                  className={`p-2 border text-left rounded-lg transition-colors cursor-pointer ${
                    stylePreset === "concise"
                      ? "bg-purple-950/30 text-purple-300 border-purple-800"
                      : "bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700"
                  }`}
                >
                  ✂️ Краткий (Динамика)
                </button>
                <button
                  onClick={() => setStylePreset("lyrical")}
                  className={`p-2 border text-left rounded-lg transition-colors cursor-pointer ${
                    stylePreset === "lyrical"
                      ? "bg-purple-950/30 text-purple-300 border-purple-800"
                      : "bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700"
                  }`}
                >
                  ✒️ Поэтичный (Мелодика)
                </button>
                <button
                  onClick={() => setStylePreset("show_dont_tell")}
                  className={`p-2 border col-span-2 text-left rounded-lg transition-colors cursor-pointer ${
                    stylePreset === "show_dont_tell"
                      ? "bg-purple-950/30 text-purple-300 border-purple-800"
                      : "bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700"
                  }`}
                >
                  🎬 Показывай, а не рассказывай
                </button>
              </div>
            </div>

            <div className="space-y-1">
              <label className="block text-[11px] text-slate-400 font-semibold uppercase tracking-wider">
                Особое указание (необязательно)
              </label>
              <input
                type="text"
                value={improvePrompt}
                onChange={(e) => setImprovePrompt(e.target.value)}
                placeholder="Например: Добавь больше мрачных метафор или Сделай акцент на холоде вокруг."
                className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded p-2 text-xs text-slate-200 outline-none"
              />
            </div>
            <button
              type="button"
              onClick={() => { setActiveTool("author"); setResult(""); }}
              className="w-full rounded-lg border border-emerald-900/60 bg-emerald-950/20 px-3 py-2 text-left text-[11px] text-emerald-200 hover:bg-emerald-950/35"
            >
              <span className="font-semibold">Нужна бережная редактура?</span>
              <span className="ml-1 text-emerald-300/70">Покажу diff и проверю голос, факты и защищённые термины.</span>
            </button>
          </div>
        )}

        {activeTool === "brainstorm" && (
          <div className="space-y-3.5">
            <div className="bg-blue-950/20 border border-blue-900/30 p-3 rounded-lg">
              <p className="text-[11px] text-blue-400 leading-relaxed">
                ℹ️ Запустите мозговой штурм с ИИ. Он разработает набор оригинальных концепций, неожиданных поворотов сюжета или сильных конфликтов.
              </p>
            </div>
            
            <div className="space-y-1">
              <label className="block text-[11px] text-slate-400 font-semibold uppercase tracking-wider">
                Категория генерации
              </label>
              <select
                value={brainstormCategory}
                onChange={(e) => setBrainstormCategory(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded p-2 text-xs text-slate-200 outline-none cursor-pointer"
              >
                <option value="Неожиданный сюжетный поворот (Plot Twist)">⚡ Неожиданный сюжетный поворот</option>
                <option value="Завязка сцены / Крючок (Hook)">🎣 Захватывающий зачин сцены</option>
                <option value="Причины конфликта между персонажами">🔥 Причины конфликта персонажей</option>
                <option value="Диалоговая заготовка / Цитаты">💬 Яркие реплики и темы диалога</option>
                <option value="Концовка-клиффхэнгер для главы">⛓️ Остросюжетный финал главы (Клиффхэнгер)</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="block text-[11px] text-slate-400 font-semibold uppercase tracking-wider">
                О чем должна быть идея?
              </label>
              <input
                type="text"
                value={brainstormTopic}
                onChange={(e) => setBrainstormTopic(e.target.value)}
                placeholder="Оставьте пустым для автоанализа вашей книги, либо введите тему"
                className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded p-2 text-xs text-slate-200 outline-none"
              />
            </div>
          </div>
        )}

        {activeTool === "author" && (
          <AuthorEditorPanel
            story={story}
            activeChapter={activeChapter}
            currentDraft={currentDraft}
            selection={textSelection}
            selectedModel={selectedModel}
            llmProvider={llmProvider}
            llmApiFields={llmApiFields}
            onApply={onApplyAuthorEdit}
            onOpenAuthorProfile={onOpenAuthorProfile}
          />
        )}

        {activeTool === "readiness" && (
          <div className="space-y-3">
          <ChapterReadinessPanel
            story={story}
            activeChapter={activeChapter}
            currentDraft={currentDraft}
            selectedModel={selectedModel}
            llmProvider={llmProvider}
            llmApiFields={llmApiFields}
            hasAuthorVoice={hasAuthorSample}
            onOpenAuthorEditor={() => setActiveTool("author")}
          />
          {onOpenAgent && (
            <button
              type="button"
              onClick={onOpenAgent}
              disabled={!currentDraft.trim()}
              className="w-full rounded-xl border border-violet-500/35 bg-violet-950/25 px-3.5 py-3 text-left transition hover:border-violet-400/60 hover:bg-violet-950/40 disabled:cursor-not-allowed disabled:opacity-45"
            >
              <span className="block text-xs font-semibold text-violet-200">Передать главу редакторскому агенту</span>
              <span className="mt-1 block text-[11px] leading-relaxed text-violet-200/65">Глубокая подготовка: контекст → проверка → бережная версия → итоговое письмо. Не создаёт текст с нуля.</span>
            </button>
          )}
          </div>
        )}

        {batchProgress && (
          <div className="p-4 bg-indigo-950/30 border border-indigo-900/40 rounded-xl space-y-3 animate-pulse">
            <div className="flex justify-between items-center text-xs">
              <span className="font-bold text-indigo-300">Пакетная генерация...</span>
              <span className="font-mono text-[10px] text-indigo-400">
                {batchProgress.current} из {batchProgress.total}
              </span>
            </div>
            <div className="w-full bg-slate-950 rounded-full h-1.5 overflow-hidden border border-slate-800">
              <div 
                className="bg-indigo-500 h-1.5 rounded-full transition-all duration-300" 
                style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }}
              />
            </div>
            <p className="text-[10px] text-slate-400 text-center italic">{batchProgress.status}</p>
          </div>
        )}

        {/* Humanized Generation Settings */}
        {(activeTool === "continue" || activeTool === "improve") && (
          <div className="bg-slate-950/40 border border-slate-800 rounded-lg p-2.5 space-y-2">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={humanize}
                onChange={(e) => setHumanize(e.target.checked)}
                className="accent-emerald-500 cursor-pointer"
              />
              <span className="text-xs font-semibold text-slate-200">Очеловечивание текста</span>
              <span className="text-[10px] text-slate-500">сцены, штампы, голос</span>
            </label>
            {humanize && (
              <>
                <div className="grid grid-cols-3 gap-1">
                  {(Object.keys(HUMANIZE_DEPTHS) as HumanizeDepth[]).map((depthId) => {
                    const depth = HUMANIZE_DEPTHS[depthId];
                    const locked = depthId === "maximum" && !hasAuthorSample;
                    return (
                      <button
                        key={depthId}
                        type="button"
                        disabled={locked}
                        title={
                          locked
                            ? "Нужен образец стиля: откройте «Профиль автора» или напишите главу в книге"
                            : depth.description
                        }
                        onClick={() => setHumanizeDepth(depthId)}
                        className={`rounded border px-1.5 py-1.5 text-[10px] leading-tight transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                          humanizeDepth === depthId
                            ? "border-emerald-600 bg-emerald-950/40 text-emerald-300"
                            : "border-slate-800 text-slate-500 hover:text-slate-300"
                        }`}
                      >
                        <span className="font-semibold block">{depth.title}</span>
                        <span className="text-[9px] opacity-80">{depth.description}</span>
                      </button>
                    );
                  })}
                </div>
                {sampleSource === "profile" || authorProfile?.voiceSheet ? (
                  <p className="text-[10px] text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    {authorProfile?.voiceSheet
                      ? "Голос автора подключён — паспорт будет учтён в редактуре"
                      : "Образец автора подключён — манера будет учтена"}
                  </p>
                ) : sampleSource === "chapters" ? (
                  <p className="text-[10px] text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    Образец стиля: уже написанные главы книги (можно уточнить в профиле автора)
                  </p>
                ) : (
                  <div className="space-y-1">
                    <select
                      value={voicePreset}
                      onChange={(e) => setVoicePreset(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-slate-200 cursor-pointer"
                    >
                      {VOICE_PRESETS.map((preset) => (
                        <option key={preset.id} value={preset.id}>{preset.title}</option>
                      ))}
                    </select>
                    <p className="text-[10px] text-amber-400/90">
                      «Максимум» нужен образец стиля (≥300 знаков): профиль автора (TXT/Word) или любая уже написанная глава.
                    </p>
                    <button
                      type="button"
                      onClick={onOpenAuthorProfile}
                      className="text-[10px] text-emerald-400 hover:text-emerald-300 underline cursor-pointer"
                    >
                      Открыть профиль автора
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Action / Stop buttons */}
        {activeTool === "author" || activeTool === "readiness" ? null : loading ? (
          <div className="space-y-2 border-t border-slate-800 bg-slate-950/95 px-4 py-3">
            <div className="w-full py-2.5 bg-slate-800/80 border border-slate-700 text-slate-200 rounded-lg text-xs font-semibold flex items-center justify-center gap-2">
              <div className="w-3.5 h-3.5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
              <span>
                {batchProgress
                  ? `Генерация ${batchProgress.current} из ${batchProgress.total}…`
                  : activeTool === "continue"
                    ? "Пишем продолжение сюжета…"
                    : "ИИ творит волшебство…"}
              </span>
            </div>
            <button
              type="button"
              onClick={handleStopGeneration}
              className="w-full py-2.5 bg-red-950/50 hover:bg-red-900/60 border border-red-800/60 hover:border-red-600/70 text-red-300 hover:text-red-200 rounded-lg text-xs font-semibold cursor-pointer transition-all flex items-center justify-center gap-2"
              id="ai-stop-btn"
              title="Остановить текущую генерацию"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              <span>Остановить</span>
            </button>
          </div>
        ) : activeTool === "continue" && continueMode === "multi_chapters" ? (
          <button
            onClick={handleBatchGenerate}
            disabled={selectedBatchChapters.length === 0}
            className="w-full border-t border-slate-800 bg-gradient-to-r from-indigo-600 to-purple-600 px-3 py-2.5 hover:from-indigo-500 hover:to-purple-500 disabled:from-slate-800 disabled:to-slate-800 disabled:opacity-50 text-white rounded-lg text-xs font-semibold cursor-pointer transition-all flex items-center justify-center gap-2 shadow-lg"
          >
            <Wand2 className="w-4 h-4" />
            <span>Сгенерировать выбранные главы ({selectedBatchChapters.length})</span>
          </button>
        ) : (
          <button
            onClick={handleAction}
            disabled={activeTool === "improve" && !selectedText && !currentDraft}
            className="w-full border-t border-slate-800 bg-gradient-to-r from-blue-600 to-purple-600 px-3 py-2.5 hover:from-blue-500 hover:to-purple-500 disabled:from-slate-800 disabled:to-slate-800 disabled:opacity-50 text-white rounded-lg text-xs font-semibold cursor-pointer transition-all flex items-center justify-center gap-2 shadow-lg"
            id="ai-action-btn"
          >
            <Wand2 className="w-4 h-4" />
            <span>
              {activeTool === "continue" && (continueMode === "whole_chapter" ? "Написать целую главу" : "Сгенерировать продолжение")}
              {activeTool === "improve" && "Отполировать текст"}
              {activeTool === "brainstorm" && "Устроить мозговой штурм"}
            </span>
          </button>
        )}

        {error && (
          <div className="p-3 bg-red-950/30 border border-red-900/50 text-red-400 rounded-lg text-xs">
            {error}
          </div>
        )}

        {/* Result Block */}
        {result && (
          <div className="bg-slate-950/60 border border-slate-800 rounded-xl overflow-hidden mt-4" id="ai-result-block">
            {/* Result Header */}
            <div className="flex justify-between items-center bg-slate-900 p-2 px-3 border-b border-slate-800">
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wide">Результат ИИ</span>
              <div className="flex gap-1">
                <button
                  onClick={handleCopy}
                  className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition-colors flex items-center gap-1 text-[10px] cursor-pointer"
                  title="Копировать в буфер"
                >
                  {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                  <span>{copied ? "Скопировано" : "Копировать"}</span>
                </button>
              </div>
            </div>
            
            {/* Result Body */}
            <div className="p-3.5 max-h-[280px] overflow-y-auto text-xs text-slate-200 leading-relaxed">
              <div className="markdown-body">
                <ReactMarkdown>{result}</ReactMarkdown>
              </div>
            </div>

            {/* Naturalness Meter */}
            {humanizeReport && (
              <div className="px-3 py-2 border-t border-slate-800 bg-slate-950/40">
                <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
                  <span title={humanizeReport.flaggedLabels.length ? `Найденные штампы: ${humanizeReport.flaggedLabels.join(", ")}` : "Штампы не обнаружены"}>
                    Естественность: <span className="font-bold text-slate-200">{Math.max(100 - humanizeReport.scoreAfter, 0)}/100</span>
                    {typeof humanizeReport.scoreBefore === "number" && humanizeReport.scoreBefore !== humanizeReport.scoreAfter && (
                      <span className="text-slate-500"> (было {Math.max(100 - humanizeReport.scoreBefore, 0)})</span>
                    )}
                  </span>
                  <span className="text-slate-500">
                    {humanizeReport.mode === "scenes" && humanizeReport.scenesGenerated
                      ? `сцены: ${humanizeReport.scenesGenerated}`
                      : null}
                    {humanizeReport.refinedBlocks > 0 && (
                      <span className="text-emerald-400 ml-2">правка: {humanizeReport.refinedBlocks} абз.</span>
                    )}
                    {humanizeReport.candidatesTried != null && humanizeReport.candidatesTried > 1 && (
                      <span className="text-sky-400 ml-2">
                        best-of-{humanizeReport.candidatesTried}
                        {humanizeReport.chosenCandidate != null ? ` #${humanizeReport.chosenCandidate + 1}` : ""}
                      </span>
                    )}
                    {humanizeReport.detectorSegmentsRewritten != null && humanizeReport.detectorSegmentsRewritten > 0 && (
                      <span className="text-violet-400 ml-2">AI-сегм: {humanizeReport.detectorSegmentsRewritten}</span>
                    )}
                    {humanizeReport.gatePassed && (
                      <span className="text-emerald-400 ml-2">gate ✓</span>
                    )}
                  </span>
                </div>
                <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${100 - humanizeReport.scoreAfter >= 75 ? "bg-emerald-500" : 100 - humanizeReport.scoreAfter >= 50 ? "bg-yellow-500" : "bg-red-500"}`}
                    style={{ width: `${Math.max(100 - humanizeReport.scoreAfter, 0)}%` }}
                  />
                </div>
                {(humanizeReport.depth || humanizeReport.burstiness != null) && (
                  <p className="text-[10px] text-slate-500 mt-1">
                    {humanizeReport.depth ? `режим: ${humanizeReport.depth}` : ""}
                    {humanizeReport.burstiness != null ? ` · ритм ${humanizeReport.burstiness.toFixed(2)}` : ""}
                    {humanizeReport.passesRun ? ` · проходов: ${humanizeReport.passesRun}` : ""}
                  </p>
                )}
                {(humanizeReport.unresolvedLabels?.length ?? 0) > 0 && (
                  <p className="text-[10px] text-amber-400 mt-1">
                    Не удалось убрать: {humanizeReport.unresolvedLabels!.join(", ")} — просмотрите вручную.
                  </p>
                )}
              </div>
            )}

            {/* Quick Insertion Actions */}
            <div className="bg-slate-950/40 p-2.5 border-t border-slate-800 flex gap-2 justify-end">
              {activeTool === "continue" && (
                <button
                  onClick={() => handleUseResult("append")}
                  className="px-3 py-1.5 bg-blue-600/20 text-blue-400 border border-blue-500/20 hover:bg-blue-600 hover:text-white transition-all text-[11px] rounded font-semibold cursor-pointer flex items-center gap-1"
                >
                  Вставить в конец главы
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
              {activeTool === "improve" && (
                <button
                  onClick={() => handleUseResult(selectedText ? "replace" : "append")}
                  className="px-3 py-1.5 bg-purple-600/20 text-purple-400 border border-purple-500/20 hover:bg-purple-600 hover:text-white transition-all text-[11px] rounded font-semibold cursor-pointer flex items-center gap-1"
                >
                  {selectedText ? "Заменить выделенное" : "Вставить в конец главы"}
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
