import React, { useEffect, useMemo, useState } from "react";
import mammoth from "mammoth";
import {
  AlertTriangle,
  CheckCircle2,
  FileSearch,
  Fingerprint,
  GitCompare,
  History,
  Loader2,
  Save,
  ShieldCheck,
  Upload,
  Trash2,
  ArrowLeft,
} from "lucide-react";
import {
  AuthorEditAudit,
  AuthorEditTarget,
  AuthorProfileRecord,
  AuthorRevisionRecord,
  AuthorVoiceSheet,
  Chapter,
  Story,
  TextSelection,
} from "../types";
import { auditStyleSignals, compareStyle, hashText } from "../lib/authorAudit";
import { DetectorReport, isAiSegment, readDetectorReport } from "../lib/detectorReport";
import {
  AdaptiveDetectorProfile,
  buildAdaptiveWritingGuidance,
  learnFromDetectorReport,
  loadAdaptiveProfile,
  resetAdaptiveProfile,
  saveAdaptiveProfile,
  scoreCalibratedLocalDetector,
  scoreWithAdaptiveProfile,
} from "../lib/adaptiveDetector";
import { YANDEX_LOCAL_GAP } from "../../server/humanStyle";
import { diffParagraphs } from "../lib/textDiff";
import {
  listAuthorRevisions,
  deleteAuthorProfile,
  loadAuthorProfile,
  saveAuthorProfile,
  saveAuthorRevision,
} from "../lib/authorStorage";

interface AuthorEditorPanelProps {
  story: Story;
  activeChapter?: Chapter;
  currentDraft: string;
  selection: TextSelection | null;
  selectedModel?: string;
  llmProvider?: "auto" | "gemini" | "nvidia" | "groq" | "openrouter";
  llmApiFields?: Record<string, unknown>;
  onApply: (text: string, target: AuthorEditTarget) => boolean;
  onOpenAuthorProfile?: () => void;
}

type Scope = "selection" | "chapter" | "detector";
type Strength = "conservative" | "balanced" | "deep";

function parseTerms(value: string): string[] {
  return [...new Set(value.split(/[,;\n]/u).map((term) => term.trim()).filter(Boolean))];
}

function createId(): string {
  return globalThis.crypto?.randomUUID?.() || `revision-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function ProfileView({ profile }: { profile: AuthorVoiceSheet }) {
  return (
    <div className="space-y-2 text-[11px] text-slate-300" id="author-profile-summary">
      <p className="leading-relaxed">{profile.summary}</p>
      <div>
        <span className="font-semibold text-emerald-300">Сохранять:</span>
        <ul className="mt-1 space-y-1 list-disc pl-4">
          {profile.voiceRules.slice(0, 6).map((rule, index) => <li key={`${rule}-${index}`}>{rule}</li>)}
        </ul>
      </div>
      {profile.avoid.length > 0 && (
        <div>
          <span className="font-semibold text-amber-300">Не имитировать механически:</span>
          <ul className="mt-1 space-y-1 list-disc pl-4">
            {profile.avoid.slice(0, 4).map((rule, index) => <li key={`${rule}-${index}`}>{rule}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function DiffView({ original, revised }: { original: string; revised: string }) {
  const blocks = useMemo(() => diffParagraphs(original, revised), [original, revised]);
  return (
    <div className="max-h-64 overflow-y-auto space-y-1 font-mono text-[10px]" id="author-diff-view">
      {blocks.map((block, index) => (
        <div
          key={`${block.kind}-${index}`}
          className={`whitespace-pre-wrap rounded border px-2 py-1.5 ${
            block.kind === "added"
              ? "bg-emerald-950/35 border-emerald-900/50 text-emerald-200"
              : block.kind === "removed"
                ? "bg-red-950/30 border-red-900/50 text-red-200 line-through decoration-red-700"
                : "bg-slate-950/40 border-slate-800/60 text-slate-500"
          }`}
        >
          <span className="mr-1 select-none">{block.kind === "added" ? "+" : block.kind === "removed" ? "−" : " "}</span>
          {block.text || "∅"}
        </div>
      ))}
    </div>
  );
}

export default function AuthorEditorPanel({
  story,
  activeChapter,
  currentDraft,
  selection,
  selectedModel,
  llmProvider = "auto",
  llmApiFields,
  onApply,
  onOpenAuthorProfile,
}: AuthorEditorPanelProps) {
  const [sample, setSample] = useState("");
  const [sampleFileName, setSampleFileName] = useState("");
  const [styleDescription, setStyleDescription] = useState("");
  const [protectedTermsText, setProtectedTermsText] = useState("");
  const [voiceSheet, setVoiceSheet] = useState<AuthorVoiceSheet | undefined>();
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileStatus, setProfileStatus] = useState("");
  const [scope, setScope] = useState<Scope>(selection ? "selection" : "chapter");
  const [strength, setStrength] = useState<Strength>("deep");
  const [instructions, setInstructions] = useState("");
  const [detectorReport, setDetectorReport] = useState<DetectorReport | null>(null);
  const [detectorSegmentIndex, setDetectorSegmentIndex] = useState<number | null>(null);
  const [adaptiveProfile, setAdaptiveProfile] = useState<AdaptiveDetectorProfile>(() => loadAdaptiveProfile(story.id));
  const [adaptiveStatus, setAdaptiveStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const [audit, setAudit] = useState<AuthorEditAudit | null>(null);
  const [modelUsed, setModelUsed] = useState("");
  const [overrideConfirmed, setOverrideConfirmed] = useState(false);
  const [revisions, setRevisions] = useState<AuthorRevisionRecord[]>([]);
  const [currentRevision, setCurrentRevision] = useState<AuthorRevisionRecord | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSample("");
    setSampleFileName("");
    setStyleDescription("");
    setProtectedTermsText("");
    setVoiceSheet(undefined);
    loadAuthorProfile(story.id)
      .then((profile) => {
        if (cancelled || !profile) return;
        setSample(profile.sample);
        setSampleFileName(profile.sampleFileName || "");
        setStyleDescription(profile.styleDescription);
        setProtectedTermsText(profile.protectedTerms.join(", "));
        setVoiceSheet(profile.voiceSheet);
      })
      .catch(() => {
        if (!cancelled) setProfileStatus("Локальный профиль пока недоступен");
      });
    return () => { cancelled = true; };
  }, [story.id]);

  useEffect(() => {
    setAdaptiveProfile(loadAdaptiveProfile(story.id));
    setAdaptiveStatus("");
  }, [story.id]);

  useEffect(() => {
    if (!activeChapter) return;
    listAuthorRevisions(story.id, activeChapter.id)
      .then(setRevisions)
      .catch(() => setRevisions([]));
  }, [story.id, activeChapter?.id]);

  useEffect(() => {
    if (!selection && scope === "selection") setScope("chapter");
  }, [selection, scope]);

  const selectedDetectorSegment = detectorSegmentIndex == null ? null : detectorReport?.segments[detectorSegmentIndex] || null;
  const sourceText = scope === "selection" && selection
    ? selection.text
    : scope === "detector" && selectedDetectorSegment
      ? selectedDetectorSegment.text
      : currentDraft;
  const reportMatchesChapter = Boolean(detectorReport && detectorReport.fullText === currentDraft);

  const target = useMemo<AuthorEditTarget | null>(() => {
    if (!activeChapter) return null;
    if (scope === "selection" && selection) {
      return {
        chapterId: activeChapter.id,
        kind: "selection",
        start: selection.start,
        end: selection.end,
        original: selection.text,
        sourceHash: selection.sourceHash,
      };
    }
    if (scope === "detector" && selectedDetectorSegment) {
      if (!reportMatchesChapter) return null;
      return {
        chapterId: activeChapter.id,
        kind: "detector-segment",
        start: selectedDetectorSegment.start,
        end: selectedDetectorSegment.end,
        original: selectedDetectorSegment.text,
        sourceHash: hashText(currentDraft),
      };
    }
    return {
      chapterId: activeChapter.id,
      kind: "chapter",
      original: currentDraft,
      sourceHash: hashText(currentDraft),
    };
  }, [activeChapter, currentDraft, reportMatchesChapter, scope, selectedDetectorSegment, selection]);

  const localSignals = useMemo(() => auditStyleSignals(sourceText), [sourceText]);
  const styleComparison = useMemo(
    () => sample.trim().length >= 300 && sourceText.trim() ? compareStyle(sample, sourceText) : null,
    [sample, sourceText],
  );
  const adaptiveScore = useMemo(
    () => scoreWithAdaptiveProfile(sourceText, adaptiveProfile),
    [adaptiveProfile, sourceText],
  );
  const calibratedScore = useMemo(
    () => scoreCalibratedLocalDetector(sourceText, adaptiveProfile),
    [adaptiveProfile, sourceText],
  );

  const persistProfile = async (
    options?: {
      voiceSheet?: AuthorVoiceSheet;
      clearVoiceSheet?: boolean;
      sample?: string;
      sampleFileName?: string;
      styleDescription?: string;
      protectedTerms?: string[];
    },
  ) => {
    const profile: AuthorProfileRecord = {
      storyId: story.id,
      sample: options?.sample ?? sample,
      sampleFileName: options?.sampleFileName ?? sampleFileName,
      styleDescription: options?.styleDescription ?? styleDescription,
      protectedTerms: options?.protectedTerms ?? parseTerms(protectedTermsText),
      voiceSheet: options?.clearVoiceSheet ? undefined : (options?.voiceSheet ?? voiceSheet),
      updatedAt: Date.now(),
    };
    await saveAuthorProfile(profile);
  };

  const handleSampleFile = async (file?: File) => {
    if (!file) return;
    setProfileStatus("");
    try {
      const lowerName = file.name.toLowerCase();
      let text = "";
      if (lowerName.endsWith(".txt")) {
        text = await file.text();
      } else if (lowerName.endsWith(".docx")) {
        const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
        text = result.value;
      } else {
        throw new Error("Поддерживаются файлы TXT и DOCX");
      }
      const trimmed = text.trim();
      if (!trimmed) throw new Error("В файле не найден текст");
      setSample(trimmed);
      setSampleFileName(file.name);
      setVoiceSheet(undefined);
      // Сразу в IndexedDB — иначе «Максимум» и другие вкладки не видят образец
      await persistProfile({
        sample: trimmed,
        sampleFileName: file.name,
        clearVoiceSheet: true,
      });
      const chars = trimmed.length;
      setProfileStatus(
        chars >= 300
          ? `Образец «${file.name}» сохранён (${chars.toLocaleString("ru-RU")} знаков). Можно строить паспорт или сразу писать в режиме «Максимум».`
          : `Файл «${file.name}» загружен, но мало текста (${chars} из 300). Добавьте ещё или загрузите другую главу.`,
      );
    } catch (fileError: any) {
      setProfileStatus(fileError.message || "Не удалось прочитать файл");
    }
  };

  const clearProfile = async () => {
    if (!confirm("Удалить образец и паспорт голоса этой книги?")) return;
    await deleteAuthorProfile(story.id);
    setSample("");
    setSampleFileName("");
    setStyleDescription("");
    setProtectedTermsText("");
    setVoiceSheet(undefined);
    setProfileStatus("Образец и паспорт голоса удалены");
  };

  const clearSampleOnly = async () => {
    setSample("");
    setSampleFileName("");
    setVoiceSheet(undefined);
    try {
      await persistProfile({ sample: "", sampleFileName: "", clearVoiceSheet: true });
      setProfileStatus("Образец очищен (сохранён пустой)");
    } catch {
      setProfileStatus("Не удалось очистить сохранённый образец");
    }
  };

  const buildProfile = async () => {
    if (sample.trim().length < 300) {
      setProfileStatus("Добавьте не менее 300 знаков человеческого образца");
      return;
    }
    setProfileLoading(true);
    setProfileStatus("Строю доказательный паспорт голоса…");
    try {
      const response = await fetch("/api/writer/author", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "profile", sample, styleDescription, ...(llmApiFields || { model: selectedModel, llmProvider }) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Не удалось построить профиль");
      setVoiceSheet(data.profile);
      await persistProfile({ voiceSheet: data.profile, sample, sampleFileName });
      setProfileStatus("Паспорт голоса сохранён для этой книги");
    } catch (profileError: any) {
      setProfileStatus(profileError.message || "Не удалось построить профиль");
    } finally {
      setProfileLoading(false);
    }
  };

  const saveSettings = async () => {
    try {
      await persistProfile();
      setProfileStatus("Настройки сохранены локально");
    } catch {
      setProfileStatus("Не удалось сохранить настройки");
    }
  };

  const handleDetectorFile = async (file?: File) => {
    if (!file) return;
    setError("");
    try {
      const report = await readDetectorReport(file);
      setDetectorReport(report);
      const firstAi = report.segments.findIndex(isAiSegment);
      setDetectorSegmentIndex(firstAi >= 0 ? firstAi : 0);
      setScope("detector");
      if (report.fullText === currentDraft) {
        const learning = learnFromDetectorReport(adaptiveProfile, report);
        if (learning.duplicate) {
          setAdaptiveStatus("Этот отчёт уже учтён — повторно профиль не изменён.");
        } else {
          saveAdaptiveProfile(learning.profile);
          setAdaptiveProfile(learning.profile);
          setAdaptiveStatus(
            `Самообучение: добавлено HUMAN ${learning.learnedHuman}, AI ${learning.learnedAi}`
            + (learning.ignored ? `, пропущено коротких/неизвестных ${learning.ignored}` : ""),
          );
        }
      } else {
        setAdaptiveStatus("Самообучение пропущено: отчёт не совпадает с текущим текстом главы.");
      }
    } catch (reportError: any) {
      setDetectorReport(null);
      setDetectorSegmentIndex(null);
      setError(reportError.message || "Не удалось прочитать отчёт детектора");
    }
  };

  const runRewrite = async () => {
    if (!activeChapter || !sourceText.trim()) {
      setError("Нет текста для редактуры");
      return;
    }
    if (sample.trim().length < 300) {
      setError("Сначала добавьте человеческий образец автора — минимум 300 знаков");
      return;
    }
    setLoading(true);
    setError("");
    setResult("");
    setAudit(null);
    setOverrideConfirmed(false);
    setCurrentRevision(null);
    try {
      await persistProfile();
      const chapterIndex = story.chapters.findIndex((chapter) => chapter.id === activeChapter.id);
      const previousChapter = chapterIndex > 0 ? story.chapters[chapterIndex - 1] : undefined;
      const nextChapter = chapterIndex >= 0 ? story.chapters[chapterIndex + 1] : undefined;
      const worldBible = story.worldBible || story.worldRules.map((rule) => `[${rule.title}] ${rule.content}`).join("\n\n");
      const response = await fetch("/api/writer/author", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "rewrite",
          sourceText,
          authorSample: sample,
          styleDescription,
          voiceSheet,
          protectedTerms: parseTerms(protectedTermsText),
          strength,
          instructions,
          adaptiveStyleGuidance: buildAdaptiveWritingGuidance(adaptiveProfile),
          context: {
            title: story.title,
            genre: story.genre,
            description: story.description,
            chapterTitle: activeChapter.title,
            chapterSummary: activeChapter.summary,
            worldBible,
            bookPlan: story.bookPlan || "",
            previousChapter: previousChapter?.content.slice(-12_000) || "",
            nextChapterSummary: nextChapter?.summary || "",
          },
          ...(llmApiFields || { model: selectedModel, llmProvider }),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Авторская редактура не выполнена");
      setResult(data.result);
      setAudit(data.audit);
      setVoiceSheet(data.voiceSheet);
      setModelUsed(data.model || selectedModel || "");
      await persistProfile({ voiceSheet: data.voiceSheet, sample, sampleFileName });

      const revisionTarget = target || {
        chapterId: activeChapter.id,
        kind: "chapter" as const,
        original: sourceText,
        sourceHash: hashText(currentDraft),
      };
      const revision: AuthorRevisionRecord = {
        id: createId(),
        storyId: story.id,
        chapterId: activeChapter.id,
        storyChapterKey: `${story.id}:${activeChapter.id}`,
        createdAt: Date.now(),
        original: sourceText,
        revised: data.result,
        target: revisionTarget,
        audit: data.audit,
        applied: false,
        model: data.model || selectedModel || "",
      };
      await saveAuthorRevision(revision);
      setCurrentRevision(revision);
      setRevisions((previous) => [revision, ...previous.filter((item) => item.id !== revision.id)]);
    } catch (rewriteError: any) {
      setError(rewriteError.message || "Авторская редактура не выполнена");
    } finally {
      setLoading(false);
    }
  };

  const applyResult = async () => {
    const applyTarget = currentRevision?.target || target;
    if (!result || !applyTarget || !audit) return;
    const applied = onApply(result, applyTarget);
    if (!applied) {
      setError("Исходный текст изменился после запуска. Повторите редактуру для текущей версии.");
      return;
    }
    if (currentRevision) {
      const updated = { ...currentRevision, applied: true };
      await saveAuthorRevision(updated);
      setCurrentRevision(updated);
      setRevisions((previous) => previous.map((item) => item.id === updated.id ? updated : item));
    }
  };

  const loadRevision = (revision: AuthorRevisionRecord) => {
    setResult(revision.revised);
    setAudit(revision.audit);
    setModelUsed(revision.model);
    setCurrentRevision(revision);
    setOverrideConfirmed(false);
  };

  const canApply = Boolean(result && audit && (currentRevision?.target || target) && (audit.passed || overrideConfirmed));

  return (
    <div className="space-y-4" id="author-editor-panel">
      <div className="rounded-xl border border-emerald-900/50 bg-emerald-950/20 p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-emerald-300">
              <Fingerprint className="w-4 h-4" />
              <h3 className="text-xs font-bold">Голос автора</h3>
            </div>
            <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
              {sample.trim().length >= 300
                ? voiceSheet
                  ? "Паспорт подключён и будет учтён при бережной редактуре."
                  : "Образец подключён. Постройте паспорт в профиле для более точной настройки."
                : "Добавьте собственный образец, чтобы редактура сохраняла ваш голос."}
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenAuthorProfile}
            className="shrink-0 rounded-lg border border-emerald-800/70 px-2.5 py-1.5 text-[10px] font-semibold text-emerald-300 hover:bg-emerald-950/40"
          >
            Профиль автора
          </button>
        </div>
        {sample.trim().length >= 300 && (
          <div className="mt-2 flex items-center gap-2 text-[10px] text-emerald-300">
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>{sampleFileName ? `Образец: ${sampleFileName}` : `Образец: ${sample.trim().length.toLocaleString("ru-RU")} знаков`}</span>
          </div>
        )}
      </div>

      <div className="space-y-2">
        {activeChapter && (
          <div className="flex items-center gap-2 rounded-lg border border-blue-900/50 bg-blue-950/20 p-2 text-[11px] text-blue-300">
            <ArrowLeft className="w-3.5 h-3.5" />
            <span className="truncate">Из рукописи: {activeChapter.title}</span>
          </div>
        )}
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Источник правки</span>
        <div className="grid grid-cols-2 gap-1.5 text-[11px]">
          <button
            onClick={() => setScope("selection")}
            disabled={!selection}
            className={`rounded-lg border p-2 ${scope === "selection" ? "border-blue-700 bg-blue-950/40 text-blue-300" : "border-slate-800 text-slate-400"} disabled:opacity-35`}
          >
            Выделение{selection ? ` · ${selection.text.length} зн.` : ""}
          </button>
          <button
            onClick={() => setScope("chapter")}
            className={`rounded-lg border p-2 ${scope === "chapter" ? "border-blue-700 bg-blue-950/40 text-blue-300" : "border-slate-800 text-slate-400"}`}
          >
            Вся глава
          </button>
        </div>
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-slate-700 p-2 text-[11px] text-slate-400 hover:border-slate-600">
          <Upload className="w-3.5 h-3.5" />
          Импорт отчёта детектора .json / .zip
          <input
            id="detector-report-input"
            type="file"
            accept=".json,.zip,application/json,application/zip"
            className="hidden"
            onChange={(event) => handleDetectorFile(event.target.files?.[0])}
          />
        </label>
        {detectorReport && (
          <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-2 space-y-2">
            <div className="flex items-center justify-between text-[10px] text-slate-400">
              <span>Сегментов: {detectorReport.stats.segments_count}</span>
              <span>AI/вероятно AI: {detectorReport.stats.AI_count + detectorReport.stats.LIKELY_AI_count}</span>
            </div>
            <select
              value={detectorSegmentIndex ?? ""}
              onChange={(event) => { setDetectorSegmentIndex(Number(event.target.value)); setScope("detector"); }}
              className="w-full rounded border border-slate-800 bg-slate-950 p-2 text-[11px] text-slate-300"
            >
              {detectorReport.segments.map((segment, index) => (
                <option key={`${segment.start}-${index}`} value={index}>
                  {index + 1}. {segment.label} · {segment.len} знаков
                </option>
              ))}
            </select>
            {!reportMatchesChapter && (
              <p className="text-[10px] text-amber-400">Отчёт не совпадает побуквенно с текущей главой. Сегмент можно проверить, но применение заблокировано.</p>
            )}
            {reportMatchesChapter && (detectorReport.stats.AI_count + detectorReport.stats.LIKELY_AI_count) > 0 && (
              <button
                type="button"
                disabled={loading || sample.trim().length < 300}
                onClick={async () => {
                  if (!activeChapter || !detectorReport) return;
                  setLoading(true);
                  setError("");
                  setResult("");
                  setAudit(null);
                  try {
                    const response = await fetch("/api/writer/ai", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        action: "rewrite_detector_segments",
                        detectorSegments: detectorReport.segments.map((segment) => ({
                          text: segment.text,
                          label: segment.label,
                        })),
                        authorSample: sample,
                        voiceSheet,
                        humanizeDepth: "maximum",
                        adaptiveStyleGuidance: buildAdaptiveWritingGuidance(adaptiveProfile),
                        ...(llmApiFields || { model: selectedModel, llmProvider }),
                      }),
                    });
                    const data = await response.json();
                    if (!response.ok) throw new Error(data.error || "Не удалось переписать AI-сегменты");
                    setResult(data.result);
                    setModelUsed(data.model || selectedModel || "detector-ai-only");
                    setAudit({
                      passed: true,
                      summary: `Переписано AI-сегментов: ${data.rewrittenCount ?? data.humanizeReport?.detectorSegmentsRewritten ?? "—"}. HUMAN-сегменты не трогались. Локальный AI-tell: ${data.humanizeReport?.scoreBefore} → ${data.humanizeReport?.scoreAfter}.`,
                      factIssues: [],
                      protectedTermIssues: [],
                      voiceNotes: data.humanizeReport?.flaggedLabels || [],
                      naturalnessNotes: data.humanizeReport?.gatePassed
                        ? ["Gate очеловечивания пройден"]
                        : ["Gate не пройден — просмотрите вручную"],
                    });
                    setScope("chapter");
                  } catch (rewriteError: any) {
                    setError(rewriteError.message || "Ошибка правки AI-сегментов");
                  } finally {
                    setLoading(false);
                  }
                }}
                className="w-full rounded border border-emerald-800/60 bg-emerald-950/30 py-1.5 text-[10px] font-semibold text-emerald-300 disabled:opacity-40"
              >
                Очеловечить только AI-сегменты
              </button>
            )}
          </div>
        )}
        <div className="rounded-lg border border-violet-900/50 bg-violet-950/20 p-2 text-[10px] text-violet-200 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold">Самообучение детектора</span>
            {(adaptiveProfile.human.count + adaptiveProfile.ai.count) > 0 && (
              <button
                type="button"
                className="text-violet-300 hover:text-red-300"
                onClick={() => {
                  if (!window.confirm("Сбросить весь накопленный профиль детектора для этой книги?")) return;
                  setAdaptiveProfile(resetAdaptiveProfile(story.id));
                  setAdaptiveStatus("Накопленный профиль сброшен.");
                }}
              >
                Сбросить
              </button>
            )}
          </div>
          <p className="text-violet-300/75">
            Опыт: HUMAN {adaptiveProfile.human.count} · AI {adaptiveProfile.ai.count}.
            {adaptiveProfile.fusion
              ? ` Калибровка Яндекс: w=${adaptiveProfile.fusion.adaptiveWeight}`
                + (adaptiveProfile.fusion.looAccuracy != null
                  ? ` · LOO ${(adaptiveProfile.fusion.looAccuracy * 100).toFixed(0)}%`
                  : "")
              : " Учится на совпавших отчётах."}
          </p>
          <p
            className="text-violet-400/70 leading-snug"
            title={YANDEX_LOCAL_GAP.reasonsNot100.join("\n")}
          >
            Локальный ≠ 100% Яндекса (LOO ~{Math.round(YANDEX_LOCAL_GAP.stats.looAccuracyApprox * 100)}%):
            ловит стаккато/UI/штампы; latent style Яндекса не воспроизводится полностью.
          </p>
          {adaptiveStatus && <p>{adaptiveStatus}</p>}
        </div>
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-2.5 space-y-2">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1 text-[10px] font-semibold uppercase text-slate-400"><FileSearch className="w-3.5 h-3.5" /> Локальные сигналы</span>
          {styleComparison && (
            <span
              className="text-[10px] text-blue-300"
              title={`Слабые метрики: ${styleComparison.weakestMetrics.join(", ")}`}
            >
              эталон HUMAN: {styleComparison.similarity}/100
            </span>
          )}
        </div>
        {calibratedScore && (
          <div className="flex items-center justify-between gap-2 rounded border border-violet-900/50 bg-violet-950/20 px-2 py-1.5 text-[10px]">
            <span className="text-violet-200" title="Fusion: стиль по сегментам Яндекса + aiTell-штампы">
              локально (Яндекс-калибр.): {calibratedScore.calibratedHumanProbability}% HUMAN → {calibratedScore.predictedLabel}
            </span>
            <span className="text-violet-400" title="style-only / aiTell">
              style {calibratedScore.adaptiveHumanProbability}% · tell {calibratedScore.aiTellScore}
            </span>
          </div>
        )}
        {!calibratedScore && adaptiveScore && (
          <div className="flex items-center justify-between gap-2 rounded border border-violet-900/50 bg-violet-950/20 px-2 py-1.5 text-[10px]">
            <span className="text-violet-200">адаптивно: {adaptiveScore.humanProbability}% HUMAN</span>
            <span className="text-violet-400" title="Уверенность растёт с числом размеченных сегментов">
              уверенность {adaptiveScore.confidence}%
            </span>
          </div>
        )}
        {localSignals.length ? localSignals.map((signal) => (
          <div key={signal.category} className="flex items-start justify-between gap-2 text-[10px] text-slate-400">
            <span>{signal.category}: {signal.message}</span><strong>{signal.count}</strong>
          </div>
        )) : <p className="text-[10px] text-slate-500">Явных поверхностных сигналов не найдено. Это не сертификат авторства.</p>}
      </div>

      <div className="space-y-2">
        <div className="grid grid-cols-3 gap-1 text-[10px]">
          {(["conservative", "balanced", "deep"] as Strength[]).map((value) => (
            <button
              key={value}
              onClick={() => setStrength(value)}
              className={`rounded border p-1.5 ${strength === value ? "border-purple-700 bg-purple-950/35 text-purple-300" : "border-slate-800 text-slate-500"}`}
            >
              {value === "conservative" ? "Бережно" : value === "balanced" ? "Баланс" : "Глубоко"}
            </button>
          ))}
        </div>
        <textarea
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
          rows={2}
          placeholder="Дополнительное пожелание автора — необязательно"
          className="w-full rounded-lg border border-slate-800 bg-slate-950 p-2 text-xs text-slate-200 outline-none"
        />
        <button
          id="author-run-btn"
          onClick={runRewrite}
          disabled={loading || !sourceText.trim() || sample.trim().length < 300}
          className="w-full rounded-lg bg-gradient-to-r from-emerald-700 to-blue-700 py-2.5 text-xs font-bold text-white disabled:opacity-40"
        >
          {loading ? <Loader2 className="inline w-4 h-4 animate-spin mr-1" /> : <ShieldCheck className="inline w-4 h-4 mr-1" />}
          {loading ? "Голос → факты → редактура → аудит…" : "Предложить безопасную редактуру"}
        </button>
      </div>

      {error && <div className="rounded-lg border border-red-900/60 bg-red-950/30 p-2.5 text-[11px] text-red-300">{error}</div>}

      {result && audit && (
        <div className="space-y-3" id="author-result">
          <div className={`rounded-lg border p-3 ${audit.passed ? "border-emerald-900/60 bg-emerald-950/25" : "border-amber-900/60 bg-amber-950/25"}`}>
            <div className="flex items-center gap-2">
              {audit.passed ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <AlertTriangle className="w-4 h-4 text-amber-400" />}
              <strong className={`text-xs ${audit.passed ? "text-emerald-300" : "text-amber-300"}`}>{audit.passed ? "Проверки пройдены" : "Нужна проверка автора"}</strong>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-300">{audit.summary}</p>
            {audit.factIssues.map((issue, index) => (
              <p key={`fact-${index}`} className="mt-1 text-[10px] text-red-300">• {issue.problem}{issue.sourceFact ? `: ${issue.sourceFact}` : ""}</p>
            ))}
            {audit.protectedTermIssues.map((issue, index) => <p key={`term-${index}`} className="mt-1 text-[10px] text-red-300">• {issue}</p>)}
            {modelUsed && <p className="mt-2 text-[9px] text-slate-500">Модель: {modelUsed}</p>}
          </div>

          <div>
            <div className="mb-2 flex items-center gap-1 text-[10px] font-semibold uppercase text-slate-400"><GitCompare className="w-3.5 h-3.5" /> Изменения по абзацам</div>
            <DiffView original={currentRevision?.original || sourceText} revised={result} />
          </div>

          {!audit.passed && (
            <label className="flex items-start gap-2 text-[10px] text-amber-300">
              <input type="checkbox" checked={overrideConfirmed} onChange={(event) => setOverrideConfirmed(event.target.checked)} className="mt-0.5" />
              Я прочитал замечания и хочу применить вариант вручную.
            </label>
          )}
          <button
            id="author-apply-btn"
            onClick={applyResult}
            disabled={!canApply}
            className="w-full rounded-lg border border-emerald-800 bg-emerald-900/30 py-2 text-xs font-semibold text-emerald-300 disabled:opacity-35"
          >
            Перенести отредактированную главу обратно в рукопись
          </button>
        </div>
      )}

      {revisions.length > 0 && (
        <div className="space-y-2 border-t border-slate-800 pt-3">
          <div className="flex items-center gap-1 text-[10px] font-semibold uppercase text-slate-400"><History className="w-3.5 h-3.5" /> История вариантов</div>
          {revisions.slice(0, 5).map((revision) => (
            <button
              key={revision.id}
              onClick={() => loadRevision(revision)}
              className="flex w-full items-center justify-between rounded-lg border border-slate-800 bg-slate-950/40 p-2 text-left text-[10px] text-slate-400 hover:border-slate-700"
            >
              <span>{new Date(revision.createdAt).toLocaleString("ru-RU")}</span>
              <span className={revision.applied ? "text-emerald-400" : "text-slate-500"}>{revision.applied ? "применено" : "вариант"}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
