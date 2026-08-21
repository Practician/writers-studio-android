import React, { useEffect, useState } from "react";
import mammoth from "mammoth";
import { CheckCircle2, Fingerprint, Loader2, Save, Trash2, Upload, X } from "lucide-react";
import type { AuthorProfileRecord, AuthorVoiceSheet } from "../types";
import {
  deleteGlobalAuthorProfile,
  loadGlobalAuthorProfile,
  saveGlobalAuthorProfile,
} from "../lib/authorStorage";

interface AuthorProfileModalProps {
  open: boolean;
  onClose: () => void;
  fallbackStoryId?: string;
  selectedModel?: string;
  llmProvider?: "auto" | "gemini" | "nvidia" | "groq" | "openrouter";
  llmApiFields?: Record<string, unknown>;
}

function parseTerms(value: string): string[] {
  return [...new Set(value.split(/[,;\n]/u).map((term) => term.trim()).filter(Boolean))];
}

function VoiceSheetSummary({ voiceSheet }: { voiceSheet: AuthorVoiceSheet }) {
  return (
    <div className="rounded-xl border border-emerald-900/60 bg-emerald-950/20 p-3 text-xs text-slate-300 space-y-2">
      <p className="leading-relaxed">{voiceSheet.summary}</p>
      {voiceSheet.voiceRules.length > 0 && (
        <p className="text-emerald-200"><span className="font-semibold">Сохранять:</span> {voiceSheet.voiceRules.slice(0, 4).join(" · ")}</p>
      )}
      {voiceSheet.avoid.length > 0 && (
        <p className="text-amber-200"><span className="font-semibold">Не имитировать механически:</span> {voiceSheet.avoid.slice(0, 3).join(" · ")}</p>
      )}
    </div>
  );
}

export default function AuthorProfileModal({
  open,
  onClose,
  fallbackStoryId,
  selectedModel,
  llmProvider = "auto",
  llmApiFields,
}: AuthorProfileModalProps) {
  const [sample, setSample] = useState("");
  const [sampleFileName, setSampleFileName] = useState("");
  const [styleDescription, setStyleDescription] = useState("");
  const [protectedTermsText, setProtectedTermsText] = useState("");
  const [voiceSheet, setVoiceSheet] = useState<AuthorVoiceSheet | undefined>();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");

  const hydrate = (profile?: AuthorProfileRecord) => {
    setSample(profile?.sample || "");
    setSampleFileName(profile?.sampleFileName || "");
    setStyleDescription(profile?.styleDescription || "");
    setProtectedTermsText(profile?.protectedTerms?.join(", ") || "");
    setVoiceSheet(profile?.voiceSheet);
  };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setStatus("");
    loadGlobalAuthorProfile(fallbackStoryId)
      .then((profile) => { if (!cancelled) hydrate(profile); })
      .catch(() => { if (!cancelled) setStatus("Не удалось открыть профиль автора"); });
    return () => { cancelled = true; };
  }, [open, fallbackStoryId]);

  const persist = async (changes?: Partial<AuthorProfileRecord>) => {
    const profile = {
      sample,
      sampleFileName,
      styleDescription,
      protectedTerms: parseTerms(protectedTermsText),
      voiceSheet,
      updatedAt: Date.now(),
      ...changes,
    };
    await saveGlobalAuthorProfile(profile);
    return profile;
  };

  const saveProfile = async () => {
    setSaving(true);
    setStatus("");
    try {
      await persist();
      setStatus("Профиль автора сохранён и подключён ко всем книгам.");
    } catch {
      setStatus("Не удалось сохранить профиль автора.");
    } finally {
      setSaving(false);
    }
  };

  const handleSampleFile = async (file?: File) => {
    if (!file) return;
    setStatus("");
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
      await persist({ sample: trimmed, sampleFileName: file.name, voiceSheet: undefined });
      setStatus(trimmed.length >= 300
        ? `Образец «${file.name}» сохранён. Можно построить паспорт голоса.`
        : `Файл загружен, но для паспорта нужно не менее 300 знаков: сейчас ${trimmed.length}.`);
    } catch (error: any) {
      setStatus(error.message || "Не удалось прочитать файл");
    }
  };

  const buildVoiceSheet = async () => {
    if (sample.trim().length < 300) {
      setStatus("Добавьте не менее 300 знаков человеческого образца.");
      return;
    }
    setLoading(true);
    setStatus("Строю паспорт голоса…");
    try {
      const response = await fetch("/api/writer/author", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "profile",
          sample,
          styleDescription,
          ...(llmApiFields || { model: selectedModel, llmProvider }),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Не удалось построить паспорт");
      setVoiceSheet(data.profile);
      await persist({ voiceSheet: data.profile });
      setStatus("Паспорт голоса готов и будет использоваться во всех книгах.");
    } catch (error: any) {
      setStatus(error.message || "Не удалось построить паспорт");
    } finally {
      setLoading(false);
    }
  };

  const clearProfile = async () => {
    if (!window.confirm("Удалить общий образец и паспорт голоса для всех книг?")) return;
    try {
      await deleteGlobalAuthorProfile();
      hydrate(undefined);
      setStatus("Общий профиль автора удалён.");
    } catch {
      setStatus("Не удалось удалить профиль автора.");
    }
  };

  if (!open) return null;

  const sampleLength = sample.trim().length;
  const canBuild = sampleLength >= 300;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="author-profile-modal-title">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-emerald-800/60 bg-[#111827] shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-800 bg-slate-950/50 px-6 py-5">
          <div className="flex items-start gap-3">
            <div className="rounded-xl border border-emerald-700/50 bg-emerald-950/50 p-2.5 text-emerald-300">
              <Fingerprint className="h-5 w-5" />
            </div>
            <div>
              <h2 id="author-profile-modal-title" className="text-base font-bold text-slate-100">Профиль автора</h2>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">Загрузите собственный текст один раз. Голос и защищённые термины будут доступны во всех книгах и сценариях редактора.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-100" title="Закрыть профиль автора">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-6">
          <div className="rounded-xl border border-slate-800 bg-slate-950/35 p-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-200">Образец голоса</h3>
                <p className="mt-0.5 text-[11px] text-slate-500">Минимум 300 знаков текста, написанного вами без ИИ.</p>
              </div>
              <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${canBuild ? "bg-emerald-950/60 text-emerald-300" : "bg-slate-800 text-slate-400"}`}>
                {sampleLength.toLocaleString("ru-RU")} / 300
              </span>
            </div>
            <textarea
              value={sample}
              onChange={(event) => { setSample(event.target.value); setVoiceSheet(undefined); }}
              rows={9}
              placeholder="Вставьте фрагмент своей прозы. Он используется только для анализа манеры, а не как источник событий."
              className="w-full resize-y rounded-lg border border-slate-800 bg-slate-950 p-3 text-sm leading-relaxed text-slate-200 outline-none focus:border-emerald-600"
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-emerald-800/70 px-3 py-2 text-xs font-medium text-emerald-300 hover:bg-emerald-950/30">
                <Upload className="h-3.5 w-3.5" />
                Загрузить TXT или DOCX
                <input type="file" accept=".txt,.docx,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="hidden" onChange={(event) => { void handleSampleFile(event.target.files?.[0]); event.currentTarget.value = ""; }} />
              </label>
              {sampleFileName && <span className="self-center text-xs text-slate-500">Источник: {sampleFileName}</span>}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-300">Ориентир по голосу</label>
              <textarea value={styleDescription} onChange={(event) => setStyleDescription(event.target.value)} rows={4} placeholder="Жанр, тон, дистанция, ограничения…" className="w-full rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs text-slate-200 outline-none focus:border-emerald-600" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-300">Нельзя менять</label>
              <textarea value={protectedTermsText} onChange={(event) => setProtectedTermsText(event.target.value)} rows={4} placeholder="Имена, предметы и термины — через запятую" className="w-full rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs text-slate-200 outline-none focus:border-emerald-600" />
            </div>
          </div>

          {voiceSheet ? <VoiceSheetSummary voiceSheet={voiceSheet} /> : (
            <div className="rounded-xl border border-dashed border-slate-700 bg-slate-950/20 p-3 text-xs leading-relaxed text-slate-500">Постройте паспорт, чтобы редактор мог учитывать характерные ритм, лексику и границы вашего голоса.</div>
          )}

          {status && (
            <div className="flex gap-2 rounded-lg border border-slate-700 bg-slate-900/70 p-3 text-xs text-slate-300">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
              <span>{status}</span>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 bg-slate-950/30 px-6 py-4">
          <button type="button" onClick={() => { void clearProfile(); }} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-red-400 hover:bg-red-950/30">
            <Trash2 className="h-3.5 w-3.5" />
            Удалить профиль
          </button>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => { void saveProfile(); }} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-50">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Сохранить
            </button>
            <button type="button" onClick={() => { void buildVoiceSheet(); }} disabled={loading || !canBuild} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-45">
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Fingerprint className="h-3.5 w-3.5" />}
              Построить паспорт
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
