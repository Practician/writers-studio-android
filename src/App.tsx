import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
// mammoth (~400 КБ) загружается динамически только при импорте .docx — см. extractDocxText
const extractDocxText = async (arrayBuffer: ArrayBuffer): Promise<string> => {
  const mammoth = (await import("mammoth")).default;
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value;
};
import { 
  BookOpen, 
  Plus, 
  Trash2, 
  Eraser,
  RefreshCw,
  Sparkles, 
  FileText, 
  Wand2, 
  ChevronRight, 
  Download, 
  Eye, 
  EyeOff, 
  BookMarked,
  Info,
  Layers,
  Sparkle,
  Upload,
  Globe,
  Check,
  Save,
  Settings,
  Cpu,
  Loader2,
  Fingerprint,
  X
} from "lucide-react";
import { Story, Chapter, Character, WorldRule, TextSelection, AuthorEditTarget } from "./types";
import { hashText } from "./lib/authorAudit";
import { DEFAULT_STORIES } from "./defaultData";
import {
  LABYRINTH_STORY_ID,
  buildLabyrinthAuthorProfile,
  ensureLabyrinthChapterSlots,
  mergeLabyrinthCanonIntoStories,
  shouldSeedLabyrinthAuthorProfile,
} from "./data/labyrinthCanon";
import { loadGlobalAuthorProfile, saveGlobalAuthorProfile } from "./lib/authorStorage";
import { isAutonomousApk } from "./lib/directLlmClient";
import { fetchOpenRouterRoleplayModels, type OpenRouterCatalogModel } from "./lib/openrouterCatalog";
import {
  defaultModelForProvider,
  GEMINI_LITERARY_MODELS,
  GROQ_LITERARY_MODELS,
  loadGeminiModel,
  loadGroqModel,
  loadNvidiaModel,
  loadOpenrouterLiteraryModel,
  NVIDIA_LITERARY_MODELS,
  OPENROUTER_LITERARY_MODELS,
  loadLlmKeys,
  loadStoredLlmKeys,
  loadLlmProvider,
  llmRequestFields,
  providerLabel,
  saveLlmKeys,
  saveLlmProvider,
  saveGeminiModel,
  saveGroqModel,
  saveNvidiaModel,
  saveOpenrouterLiteraryModel,
  type LlmProviderChoice,
  type StoredLlmKeys,
} from "./lib/llmSettings";
// Боковые панели грузятся лениво: они не нужны при первом рендере редактора,
// а MuseChat/AIPanel тянут за собой react-markdown со всей remark-экосистемой.
const MuseChat = React.lazy(() => import("./components/MuseChat"));
const AIPanel = React.lazy(() => import("./components/AIPanel"));
const AgentPanel = React.lazy(() => import("./components/AgentPanel"));
const BookPanel = React.lazy(() => import("./components/BookPanel"));
const AuthorProfileModal = React.lazy(() => import("./components/AuthorProfileModal"));

export default function App() {
  const [stories, setStories] = useState<Story[]>([]);
  const storiesRef = useRef<Story[]>([]);
  storiesRef.current = stories;
  const [selectedStoryId, setSelectedStoryId] = useState<string>("");
  const [selectedChapterId, setSelectedChapterId] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"text" | "book" | "muse">(() => {
    const saved = localStorage.getItem("writers_studio_global_active_tab");
    if (saved === "muse") return "muse";
    if (saved === "book" || saved === "characters" || saved === "world" || saved === "codex") return "book";
    return "text";
  });
  const [selectedText, setSelectedText] = useState("");
  const [textSelection, setTextSelection] = useState<TextSelection | null>(null);
  const [openAuthorRequest, setOpenAuthorRequest] = useState(0);
  const [quickContinueRequest, setQuickContinueRequest] = useState(0);
  const [focusMode, setFocusMode] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showStoryDetailsModal, setShowStoryDetailsModal] = useState(false);
  const [showNewStoryModal, setShowNewStoryModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);

  // LLM: в Android APK ключи загружаются из зашифрованного device storage.
  const [llmProvider, setLlmProvider] = useState<LlmProviderChoice>(() => loadLlmProvider());
  const [llmKeys, setLlmKeys] = useState<StoredLlmKeys>(() => loadLlmKeys());
  const [llmKeysReady, setLlmKeysReady] = useState(() => !isAutonomousApk());
  const [nvidiaModel, setNvidiaModel] = useState(() => loadNvidiaModel());
  const [nvidiaModelDraft, setNvidiaModelDraft] = useState(() => loadNvidiaModel());
  const [geminiModel, setGeminiModel] = useState(() => loadGeminiModel());
  const [geminiModelDraft, setGeminiModelDraft] = useState(() => loadGeminiModel());
  const [groqModel, setGroqModel] = useState(() => loadGroqModel());
  const [groqModelDraft, setGroqModelDraft] = useState(() => loadGroqModel());
  const [openrouterModel, setOpenrouterModel] = useState(() => loadOpenrouterLiteraryModel());
  const [openrouterModelDraft, setOpenrouterModelDraft] = useState(() => loadOpenrouterLiteraryModel());
  const [openrouterCatalog, setOpenrouterCatalog] = useState<OpenRouterCatalogModel[]>([]);
  const [openrouterCatalogQuery, setOpenrouterCatalogQuery] = useState("");
  const [openrouterCatalogState, setOpenrouterCatalogState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [openrouterCatalogError, setOpenrouterCatalogError] = useState("");
  const [openrouterFallbackNotice, setOpenrouterFallbackNotice] = useState<string | null>(null);
  const [showLlmSettings, setShowLlmSettings] = useState(false);
  const [showAuthorProfile, setShowAuthorProfile] = useState(false);
  const [showAgent, setShowAgent] = useState(false);
  // На телефоне главы и инструменты открываются как отдельные панели, не как постоянные колонки.
  const [mobilePanel, setMobilePanel] = useState<"chapters" | "assistant" | null>(null);
  const [llmKeysDraft, setLlmKeysDraft] = useState<StoredLlmKeys>(() => loadLlmKeys());
  const [openrouterKeyCheck, setOpenrouterKeyCheck] = useState<{
    state: "idle" | "loading" | "success" | "error";
    message?: string;
    label?: string;
    limit?: number | null;
    remaining?: number | null;
    isFreeTier?: boolean;
  }>({ state: "idle" });
  const [llmStatus, setLlmStatus] = useState<{
    geminiKeys: number;
    nvidiaConfigured: boolean;
    groqConfigured: boolean;
    openrouterConfigured: boolean;
    nvidiaDefaultModel: string;
    groqDefaultModel: string;
    openrouterDefaultModel: string;
    keysFromEnv: { gemini: boolean; nvidia: boolean; groq: boolean; openrouter: boolean };
  } | null>(null);

  useEffect(() => {
    saveLlmProvider(llmProvider);
  }, [llmProvider]);

  // В APK ключи намеренно не остаются в localStorage. Восстанавливаем их из
  // Android Keystore до первого запроса, иначе после перезапуска API получал пустые ключи.
  useEffect(() => {
    let cancelled = false;
    void loadStoredLlmKeys().then((keys) => {
      if (cancelled) return;
      setLlmKeys(keys);
      setLlmKeysDraft(keys);
      setLlmKeysReady(true);
    }).catch(() => {
      if (!cancelled) setLlmKeysReady(true);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/llm/status")
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) {
          setLlmStatus({
            geminiKeys: data.geminiKeys ?? 0,
            nvidiaConfigured: Boolean(data.nvidiaConfigured),
            groqConfigured: Boolean(data.groqConfigured),
            openrouterConfigured: Boolean(data.openrouterConfigured),
            nvidiaDefaultModel: data.nvidiaDefaultModel || "deepseek-ai/deepseek-v4-flash",
            groqDefaultModel: data.groqDefaultModel || "llama-3.3-70b-versatile",
            openrouterDefaultModel: data.openrouterDefaultModel || "openrouter/auto",
            keysFromEnv: data.keysFromEnv || { gemini: false, nvidia: false, groq: false, openrouter: false },
          });
        }
      })
      .catch(() => {
        if (!cancelled) setLlmStatus(null);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const handleOpenRouterFallback = (event: Event) => {
      const detail = (event as CustomEvent<{ from?: string; to?: string }>).detail;
      if (!detail?.to) return;
      setOpenrouterFallbackNotice(`${detail.from || "Выбранная модель"} недоступна или не вернула текст. Для этого запроса использован ${detail.to}; итог виден в журнале ИИ.`);
    };
    window.addEventListener("writers-studio-openrouter-fallback", handleOpenRouterFallback);
    return () => window.removeEventListener("writers-studio-openrouter-fallback", handleOpenRouterFallback);
  }, []);

  // Автономный APK не использует серверную SSE-ленту. Показываем в этом же
  // журнале только безопасные сведения о фактическом прямом запросе: без ключа и текста.
  useEffect(() => {
    if (!isAutonomousApk()) return;
    const handleApiTrace = (event: Event) => {
      const detail = (event as CustomEvent<{
        provider?: string; model?: string; endpoint?: string; keyPresent?: boolean;
        keySuffix?: string; keyIndex?: number; keyCount?: number; status?: number;
        outputChars?: number; finishReason?: string; message?: string;
      }>).detail;
      if (!detail?.provider || !detail.model || !detail.endpoint) return;
      const key = detail.keyPresent
        ? `ключ ${detail.keyIndex || 1}/${detail.keyCount || 1} (…${detail.keySuffix || "????"})`
        : "ключ не передан";
      const status = detail.status ? `HTTP ${detail.status}` : "без HTTP-статуса";
      const output = typeof detail.outputChars === "number" ? `ответ ${detail.outputChars} символов` : null;
      const finish = detail.finishReason ? `завершение ${detail.finishReason}` : null;
      const message = [detail.endpoint, `модель ${detail.model}`, key, status, output, finish, detail.message].filter(Boolean).join(" · ");
      setLlmLogs((prev) => [...prev, {
        level: detail.status && (detail.status >= 400 || detail.outputChars === 0) ? "error" : "success",
        provider: detail.provider,
        message,
        ts: Date.now(),
      }].slice(-40));
      setShowLlmLog(true);
    };
    window.addEventListener("writers-studio-api-trace", handleApiTrace);
    return () => window.removeEventListener("writers-studio-api-trace", handleApiTrace);
  }, []);

  useEffect(() => {
    if (!isAutonomousApk()) return;
    const handleHumanizePass = (event: Event) => {
      const detail = (event as CustomEvent<{ depth?: string; beforeChars?: number; afterChars?: number; scoreBefore?: number; scoreAfter?: number; gatePassed?: boolean; passesRun?: number }>).detail;
      if (!detail?.depth || typeof detail.beforeChars !== "number" || typeof detail.afterChars !== "number") return;
      const hasAudit = typeof detail.scoreBefore === "number" && typeof detail.scoreAfter === "number";
      const auditPart = hasAudit
        ? ` · локальный аудит: ${detail.scoreBefore} → ${detail.scoreAfter} (${detail.gatePassed ? "gate пройден" : "gate не пройден"}${detail.passesRun && detail.passesRun > 1 ? `, проходов: ${detail.passesRun}` : ""})`
        : "";
      setLlmLogs((prev) => [...prev, {
        level: hasAudit && !detail.gatePassed ? "warn" : "success",
        provider: llmProvider === "auto" ? undefined : llmProvider,
        message: `Очеловечивание ${detail.depth}: отдельный литературный проход выполнен (${detail.beforeChars} → ${detail.afterChars} символов)${auditPart}.`,
        ts: Date.now(),
      }].slice(-40));
      setShowLlmLog(true);
    };
    window.addEventListener("writers-studio-humanize-pass", handleHumanizePass);
    return () => window.removeEventListener("writers-studio-humanize-pass", handleHumanizePass);
  }, [llmProvider]);

  useEffect(() => {
    if (!isAutonomousApk()) return;
    const handleChapterVolume = (event: Event) => {
      const detail = (event as CustomEvent<{ words?: number; segments?: number; target?: number; complete?: boolean }>).detail;
      if (typeof detail?.words !== "number" || typeof detail?.segments !== "number" || typeof detail?.target !== "number") return;
      setLlmLogs((prev) => [...prev, {
        level: detail.complete ? "success" : "warn",
        message: detail.complete
          ? `Глава собрана: ${detail.words}/${detail.target} слов, фрагментов: ${detail.segments}.`
          : `Глава короче цели: ${detail.words}/${detail.target} слов после ${detail.segments} фрагментов.`,
        ts: Date.now(),
      }].slice(-40));
      setShowLlmLog(true);
    };
    window.addEventListener("writers-studio-chapter-volume", handleChapterVolume);
    return () => window.removeEventListener("writers-studio-chapter-volume", handleChapterVolume);
  }, []);

  useEffect(() => {
    if (!isAutonomousApk()) return;
    const handleKeyRotation = (event: Event) => {
      const detail = (event as CustomEvent<{ provider?: string; from?: number; to?: number; total?: number; status?: number }>).detail;
      if (!detail?.provider || !detail.from || !detail.to || !detail.total) return;
      setLlmLogs((prev) => [...prev, {
        level: "warn",
        provider: detail.provider,
        message: `Лимит HTTP ${detail.status || 0}: переключение ключа ${detail.from}/${detail.total} → ${detail.to}/${detail.total}.`,
        ts: Date.now(),
      }].slice(-40));
      setShowLlmLog(true);
    };
    window.addEventListener("writers-studio-api-key-rotation", handleKeyRotation);
    return () => window.removeEventListener("writers-studio-api-key-rotation", handleKeyRotation);
  }, []);

  // Модели выбираются только из встроенных литературных профилей, без ручного model id.
  const selectedModel = llmProvider === "openrouter"
    ? openrouterModel
    : llmProvider === "nvidia"
      ? nvidiaModel
      : llmProvider === "gemini"
        ? geminiModel
        : llmProvider === "groq"
          ? groqModel
          : defaultModelForProvider(llmProvider, llmStatus);
  const llmApiFields = useMemo(
    () => llmRequestFields(llmProvider, llmKeys, llmProvider === "auto" ? undefined : selectedModel),
    [llmProvider, llmKeys, selectedModel],
  );

  const providerHasKey = (id: LlmProviderChoice): boolean => {
    if (!llmKeysReady) return false;
    if (id === "auto") return true;
    if (id === "gemini") return Boolean(llmKeys.gemini.trim()) || Boolean(llmStatus?.keysFromEnv?.gemini) || (llmStatus?.geminiKeys ?? 0) > 0;
    if (id === "nvidia") return Boolean(llmKeys.nvidia.trim()) || Boolean(llmStatus?.keysFromEnv?.nvidia) || Boolean(llmStatus?.nvidiaConfigured);
    if (id === "groq") return Boolean(llmKeys.groq.trim()) || Boolean(llmStatus?.keysFromEnv?.groq) || Boolean(llmStatus?.groqConfigured);
    if (id === "openrouter") return Boolean(llmKeys.openrouter.trim()) || Boolean(llmStatus?.keysFromEnv?.openrouter) || Boolean(llmStatus?.openrouterConfigured);
    return false;
  };

  const loadOpenrouterCatalog = async () => {
    setOpenrouterCatalogState("loading");
    setOpenrouterCatalogError("");
    try {
      const catalog = await fetchOpenRouterRoleplayModels();
      setOpenrouterCatalog(catalog);
      setOpenrouterCatalogState("ready");
    } catch (error: any) {
      setOpenrouterCatalogState("error");
      setOpenrouterCatalogError(error?.message || "Не удалось загрузить каталог OpenRouter.");
    }
  };

  const openLlmSettings = () => {
    setLlmKeysDraft({ ...llmKeys });
    setNvidiaModelDraft(nvidiaModel);
    setGeminiModelDraft(geminiModel);
    setGroqModelDraft(groqModel);
    setOpenrouterModelDraft(openrouterModel);
    setOpenrouterCatalogQuery("");
    setShowLlmSettings(true);
    void loadOpenrouterCatalog();
  };

  const saveLlmSettings = () => {
    saveLlmKeys(llmKeysDraft);
    saveNvidiaModel(nvidiaModelDraft);
    saveGeminiModel(geminiModelDraft);
    saveGroqModel(groqModelDraft);
    saveOpenrouterLiteraryModel(openrouterModelDraft);
    setLlmKeys({ ...llmKeysDraft });
    setNvidiaModel(nvidiaModelDraft);
    setGeminiModel(geminiModelDraft);
    setGroqModel(groqModelDraft);
    setOpenrouterModel(openrouterModelDraft);
    setShowLlmSettings(false);
  };

  const checkOpenRouterKey = async () => {
    const key = llmKeysDraft.openrouter.split(/[\n,;]/).map((item) => item.trim()).find(Boolean) || "";
    if (!key) {
      setOpenrouterKeyCheck({ state: "error", message: "Сначала вставьте ключ OpenRouter в поле выше." });
      return;
    }

    setOpenrouterKeyCheck({ state: "loading" });
    try {
      const response = await fetch("https://openrouter.ai/api/v1/key", {
        headers: { Authorization: `Bearer ${key}` },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error?.message || `OpenRouter вернул ошибку ${response.status}`);
      const data = payload?.data || payload || {};
      setOpenrouterKeyCheck({
        state: "success",
        label: data.label || "без названия",
        limit: data.limit ?? null,
        remaining: data.limit_remaining ?? null,
        isFreeTier: Boolean(data.is_free_tier),
      });
    } catch (error: any) {
      setOpenrouterKeyCheck({ state: "error", message: error?.message || "Не удалось проверить ключ OpenRouter." });
    }
  };

  // Chapter Publishing states
  const [showPublishSuccessModal, setShowPublishSuccessModal] = useState(false);
  const [publishedChapterDetails, setPublishedChapterDetails] = useState<{ title: string; wordCount: number } | null>(null);
  const [showSaveSuccess, setShowSaveSuccess] = useState(false);

  // LLM Activity Log — SSE-лента событий ротации ключей/провайдеров
  const [llmLogs, setLlmLogs] = useState<Array<{ level: string; provider?: string; message: string; ts: number }>>([]);
  const [showLlmLog, setShowLlmLog] = useState(false);
  const [llmLogCollapsed, setLlmLogCollapsed] = useState(false);
  const [llmLogCopied, setLlmLogCopied] = useState(false);
  const llmLogEndRef = useRef<HTMLDivElement>(null);

  const copyLlmLog = useCallback(async () => {
    const text = llmLogs
      .map((entry) => {
        const time = new Date(entry.ts).toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        const provider = entry.provider ? `[${entry.provider}] ` : "";
        return `${time} ${provider}${entry.message}`;
      })
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Фолбэк для окружений без Clipboard API (старые WebView).
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      try { document.execCommand("copy"); } catch {}
      document.body.removeChild(textarea);
    }
    setLlmLogCopied(true);
    setTimeout(() => setLlmLogCopied(false), 1_500);
  }, [llmLogs]);

  useEffect(() => {
    if (isAutonomousApk()) return;
    const es = new EventSource("/api/llm/log-stream");
    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        setLlmLogs((prev) => {
          const next = [...prev, event].slice(-40);
          return next;
        });
        setShowLlmLog(true);
        // Авто-скрыть через 8с после последнего события
        clearTimeout((window as any).__llmLogHideTimer);
        (window as any).__llmLogHideTimer = setTimeout(() => setShowLlmLog(false), 8_000);
      } catch {}
    };
    return () => es.close();
  }, []);

  useEffect(() => {
    if (showLlmLog && !llmLogCollapsed) {
      llmLogEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [llmLogs, showLlmLog, llmLogCollapsed]);


  // Metadata Edit States (Modal)
  const [editTitle, setEditTitle] = useState("");
  const [editGenre, setEditGenre] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editBookPlan, setEditBookPlan] = useState("");
  const [editWorldBible, setEditWorldBible] = useState("");
  const [editCustomPrompt, setEditCustomPrompt] = useState("");
  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false);
  const [isGeneratingBible, setIsGeneratingBible] = useState(false);

  // File Import state
  const [importTarget, setImportTarget] = useState<"chapter" | "worldRule" | "character" | "currentChapter" | "auto" | "bookPlan" | "worldBible">("chapter");
  const [importFileTitle, setImportFileTitle] = useState("");
  const [importFileContent, setImportFileContent] = useState("");
  const [importFileName, setImportFileName] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isParsingFile, setIsParsingFile] = useState(false);
  const [parsedResult, setParsedResult] = useState<{
    chapters: Array<{ title: string; summary: string; content: string }>;
    characters: Array<{ name: string; role: string; traits: string; goals: string; description: string }>;
    worldRules: Array<{ title: string; content: string }>;
  } | null>(null);

  // New Story Form state
  const [newTitle, setNewTitle] = useState("");
  const [newGenre, setNewGenre] = useState("Фантастика");
  const [newDesc, setNewDesc] = useState("");
  const [newWorldBible, setNewWorldBible] = useState("");
  const [newBookPlan, setNewBookPlan] = useState("");
  const [newBibleFileName, setNewBibleFileName] = useState("");
  const [newPlanFileName, setNewPlanFileName] = useState("");
  const [isCreatingStory, setIsCreatingStory] = useState(false);
  const [creationError, setCreationError] = useState<string | null>(null);

  // Handle files for New Book Modal
  const handleNewBibleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setNewBibleFileName(file.name);
    
    if (file.name.endsWith(".docx") || file.name.endsWith(".doc")) {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const arrayBuffer = event.target?.result as ArrayBuffer;
        try {
          setNewWorldBible(await extractDocxText(arrayBuffer));
        } catch (err) {
          alert("Ошибка при чтении Word файла.");
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = (event) => {
        setNewWorldBible(event.target?.result as string);
      };
      reader.readAsText(file);
    }
  };

  const handleNewPlanFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setNewPlanFileName(file.name);
    
    if (file.name.endsWith(".docx") || file.name.endsWith(".doc")) {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const arrayBuffer = event.target?.result as ArrayBuffer;
        try {
          setNewBookPlan(await extractDocxText(arrayBuffer));
        } catch (err) {
          alert("Ошибка при чтении Word файла.");
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = (event) => {
        setNewBookPlan(event.target?.result as string);
      };
      reader.readAsText(file);
    }
  };

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Track and save active tab
  useEffect(() => {
    if (activeTab) {
      localStorage.setItem("writers_studio_global_active_tab", activeTab);
      if (selectedStoryId) {
        localStorage.setItem(`writers_studio_active_tab_${selectedStoryId}`, activeTab);
      }
    }
  }, [activeTab, selectedStoryId]);

  // Track and save selected story ID
  useEffect(() => {
    if (selectedStoryId) {
      localStorage.setItem("writers_studio_selected_story_id", selectedStoryId);
      
      // Restore this specific story's active tab
      const savedStoryTab = localStorage.getItem(`writers_studio_active_tab_${selectedStoryId}`);
      if (savedStoryTab === "muse") {
        setActiveTab("muse");
      } else if (["book", "characters", "world", "codex"].includes(savedStoryTab || "")) {
        setActiveTab("book");
      } else if (savedStoryTab) {
        setActiveTab("text");
      }
      
      // Restore this specific story's active chapter
      const savedStoryChapter = localStorage.getItem(`writers_studio_active_chapter_${selectedStoryId}`);
      const story = storiesRef.current.find(s => s.id === selectedStoryId);
      if (story) {
        const chapterExists = story.chapters?.find(c => c.id === savedStoryChapter);
        if (chapterExists && savedStoryChapter) {
          setSelectedChapterId(savedStoryChapter);
        } else if (story.chapters && story.chapters.length > 0) {
          setSelectedChapterId(story.chapters[0].id);
        }
      }
    }
  }, [selectedStoryId]);

  // Track and save selected chapter ID
  useEffect(() => {
    if (selectedChapterId) {
      localStorage.setItem("writers_studio_selected_chapter_id", selectedChapterId);
      if (selectedStoryId) {
        localStorage.setItem(`writers_studio_active_chapter_${selectedStoryId}`, selectedChapterId);
      }
    }
  }, [selectedChapterId, selectedStoryId]);

  // 1. Initial Load and Seeding (+ влитие канона «Лабиринт» в bible/plan/гл.5–6)
  useEffect(() => {
    const seedAuthorStyle = (storiesList: Story[]) => {
      // Образец голоса из Word-гл.6 → IndexedDB, чтобы «Максимум»/generate продолжали паттерны
      const lab =
        storiesList.find((s) => s.id === LABYRINTH_STORY_ID) ||
        storiesList.find(
          (s) => /лабиринт/i.test(s.title || "") && /путь\s*домой/i.test(s.title || ""),
        );
      if (!lab) return;
      void loadGlobalAuthorProfile(lab.id)
        .then((existing) => {
          if (!shouldSeedLabyrinthAuthorProfile(existing)) return;
          return saveGlobalAuthorProfile(buildLabyrinthAuthorProfile());
        })
        .catch((err) => console.warn("Labyrinth author profile seed skipped", err));
    };

    const saved = localStorage.getItem("writers_studio_stories");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.length > 0) {
          const merged = mergeLabyrinthCanonIntoStories(parsed);
          setStories(merged);
          localStorage.setItem("writers_studio_stories", JSON.stringify(merged));
          seedAuthorStyle(merged);

          const savedStoryId = localStorage.getItem("writers_studio_selected_story_id");
          const savedChapterId = localStorage.getItem("writers_studio_selected_chapter_id");

          // Sort by updatedAt descending to fallback to the most recently edited story
          const sorted = [...merged].sort((a: any, b: any) => (b.updatedAt || 0) - (a.updatedAt || 0));
          const targetStory = merged.find((s: any) => s.id === savedStoryId) || sorted[0] || merged[0];

          setSelectedStoryId(targetStory.id);

          const chapterExists = targetStory.chapters?.find((c: any) => c.id === savedChapterId);
          if (chapterExists) {
            setSelectedChapterId(savedChapterId!);
          } else if (targetStory.chapters && targetStory.chapters.length > 0) {
            setSelectedChapterId(targetStory.chapters[0].id);
          }
          return;
        }
      } catch (e) {
        console.error("Failed to parse stories", e);
      }
    }

    // Seed default (Лабиринт первым)
    const seeded = mergeLabyrinthCanonIntoStories(DEFAULT_STORIES);
    setStories(seeded);
    setSelectedStoryId(seeded[0].id);
    setSelectedChapterId(seeded[0].chapters[0].id);
    localStorage.setItem("writers_studio_stories", JSON.stringify(seeded));
    seedAuthorStyle(seeded);
  }, []);

  // Get active story and active chapter
  const activeStory = stories.find(s => s.id === selectedStoryId) || stories[0];
  const activeChapter = activeStory?.chapters.find(c => c.id === selectedChapterId) || activeStory?.chapters[0];

  // Sync edit story metadata states when modal opens or active story changes
  useEffect(() => {
    if (showStoryDetailsModal && activeStory) {
      setEditTitle(activeStory.title);
      setEditGenre(activeStory.genre);
      setEditDesc(activeStory.description);
      setEditBookPlan(activeStory.bookPlan || "");
      setEditWorldBible(activeStory.worldBible || "");
      setEditCustomPrompt("");
    }
  }, [showStoryDetailsModal, activeStory]);

  // Auto-load labirint files for empty stories
  useEffect(() => {
    if (activeStory && !activeStory.worldBible) {
      fetch("/api/dev/load-labirint")
        .then(res => res.json())
        .then(data => {
          if (data.bible && data.plan) {
            const updated = { ...activeStory, worldBible: data.bible, bookPlan: data.plan, updatedAt: Date.now() };
            const newStories = stories.map(s => s.id === updated.id ? updated : s);
            setStories(newStories);
            localStorage.setItem("writers_studio_stories", JSON.stringify(newStories));
            console.log("Автоматически загружены Библия мира и План из Лабиринта");
          }
        })
        .catch(console.error);
    }
  }, [activeStory?.id]);

  // 2. Auto-save triggers
  const saveAllStories = (updatedStories: Story[]) => {
    setStories(updatedStories);
    setIsSaving(true);
    localStorage.setItem("writers_studio_stories", JSON.stringify(updatedStories));
    setTimeout(() => setIsSaving(false), 800);
  };

  // 3. Handle Editor Changes
  const handleEditorChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (!activeStory || !activeChapter) return;
    
    const newContent = e.target.value;
    if (textSelection) {
      setTextSelection(null);
      setSelectedText("");
    }
    const updatedChapters = activeStory.chapters.map(c => 
      c.id === activeChapter.id ? { ...c, content: newContent } : c
    );

    const updatedStory = {
      ...activeStory,
      chapters: updatedChapters,
      updatedAt: Date.now()
    };

    const updatedStories = stories.map(s => 
      s.id === activeStory.id ? updatedStory : s
    );

    saveAllStories(updatedStories);
  };

  // 4. Track Text Selection (for style improver)
  const handleTextSelection = () => {
    if (textareaRef.current) {
      const start = textareaRef.current.selectionStart;
      const end = textareaRef.current.selectionEnd;
      if (start !== end) {
        const text = textareaRef.current.value.substring(start, end);
        setSelectedText(text);
        if (activeChapter) {
          setTextSelection({
            chapterId: activeChapter.id,
            start,
            end,
            text,
            sourceHash: hashText(textareaRef.current.value),
          });
        }
      } else {
        setSelectedText("");
        setTextSelection(null);
      }
    }
  };

  // 5. Insert AI generation results (Append or Replace selection)
  const handleInsertText = (aiText: string, actionType: "append" | "replace") => {
    if (!textareaRef.current || !activeChapter || !activeStory) return;

    let newContent = "";
    if (
      actionType === "replace" &&
      textSelection &&
      textSelection.chapterId === activeChapter.id &&
      textSelection.sourceHash === hashText(activeChapter.content) &&
      activeChapter.content.slice(textSelection.start, textSelection.end) === textSelection.text
    ) {
      const start = textSelection.start;
      const end = textSelection.end;
      const currentVal = textareaRef.current.value;
      newContent = currentVal.substring(0, start) + aiText + currentVal.substring(end);
    } else {
      // Append at the end or at the current cursor
      const cursor = textareaRef.current.selectionStart || textareaRef.current.value.length;
      const currentVal = textareaRef.current.value;
      newContent = currentVal.substring(0, cursor) + "\n\n" + aiText + currentVal.substring(cursor);
    }

    // Sync state and save
    const updatedChapters = activeStory.chapters.map(c => 
      c.id === activeChapter.id ? { ...c, content: newContent } : c
    );

    const updatedStory = {
      ...activeStory,
      chapters: updatedChapters,
      updatedAt: Date.now()
    };

    saveAllStories(stories.map(s => s.id === activeStory.id ? updatedStory : s));
    setSelectedText("");
    setTextSelection(null);
  };

  const handleApplyAuthorEdit = (text: string, target: AuthorEditTarget): boolean => {
    if (!activeStory || !activeChapter || target.chapterId !== activeChapter.id) return false;
    const currentContent = activeChapter.content;
    if (hashText(currentContent) !== target.sourceHash) return false;

    let newContent: string;
    if (target.kind === "chapter") {
      if (currentContent !== target.original) return false;
      newContent = text;
    } else {
      if (target.start == null || target.end == null) return false;
      if (currentContent.slice(target.start, target.end) !== target.original) return false;
      newContent = currentContent.slice(0, target.start) + text + currentContent.slice(target.end);
    }

    const updatedChapters = activeStory.chapters.map((chapter) =>
      chapter.id === activeChapter.id ? { ...chapter, content: newContent } : chapter
    );
    const updatedStory = { ...activeStory, chapters: updatedChapters, updatedAt: Date.now() };
    saveAllStories(stories.map((story) => story.id === activeStory.id ? updatedStory : story));
    setSelectedText("");
    setTextSelection(null);
    return true;
  };

  const [isMicroEditing, setIsMicroEditing] = useState(false);
  const handleMicroEdit = async (action: string) => {
    if (!textSelection || !activeChapter || !activeStory) return;
    setIsMicroEditing(true);
    try {
      const res = await fetch(`/api/editor/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: textSelection.text,
          ...llmApiFields
        })
      });
      const data = await res.json();
      if (res.ok && data.result) {
        handleInsertText(data.result, "replace");
      } else {
        alert("Ошибка: " + (data.error || "Не удалось выполнить микро-редактуру"));
      }
    } catch (e: any) {
      alert("Ошибка: " + e.message);
    } finally {
      setIsMicroEditing(false);
    }
  };

  // 6. Chapter Management
  const handleAddChapter = () => {
    if (!activeStory) return;
    const nextNum = activeStory.chapters.length + 1;
    const newCh: Chapter = {
      id: "chapter-" + Math.random().toString(36).substr(2, 9),
      title: `Глава ${nextNum}: Новое начало`,
      summary: "Опишите краткое содержание главы...",
      content: ""
    };

    const updatedStory = {
      ...activeStory,
      chapters: [...activeStory.chapters, newCh],
      updatedAt: Date.now()
    };

    saveAllStories(stories.map(s => s.id === activeStory.id ? updatedStory : s));
    setSelectedChapterId(newCh.id);
  };

  const handleUpdateChapterDetails = (title: string, summary: string) => {
    if (!activeStory || !activeChapter) return;
    const updatedChapters = activeStory.chapters.map(c => 
      c.id === activeChapter.id ? { ...c, title, summary } : c
    );

    const updatedStory = {
      ...activeStory,
      chapters: updatedChapters,
      updatedAt: Date.now()
    };

    saveAllStories(stories.map(s => s.id === activeStory.id ? updatedStory : s));
  };

  const handleDeleteChapter = (id: string) => {
    if (!activeStory) return;
    if (confirm("Удалить главу из оглавления? Текст будет потерян (слот можно вернуть кнопкой «Канон», если это Лабиринт).")) {
      const filtered = activeStory.chapters.filter(c => c.id !== id);
      const updatedStory = {
        ...activeStory,
        chapters: filtered,
        updatedAt: Date.now()
      };

      saveAllStories(stories.map(s => s.id === activeStory.id ? updatedStory : s));
      setSelectedChapterId(filtered[0]?.id || "");
    }
  };

  /** Стереть текст текущей главы (слот в оглавлении остаётся). */
  const handleClearActiveChapterContent = () => {
    if (!activeStory || !activeChapter) return;
    if (!activeChapter.content?.trim()) {
      alert("В этой главе уже нет текста.");
      return;
    }
    if (!confirm(`Стереть текст «${activeChapter.title}»?\nНазвание главы в оглавлении останется.`)) return;
    const updatedChapters = activeStory.chapters.map((c) =>
      c.id === activeChapter.id ? { ...c, content: "" } : c,
    );
    saveAllStories(
      stories.map((s) =>
        s.id === activeStory.id
          ? { ...activeStory, chapters: updatedChapters, updatedAt: Date.now() }
          : s,
      ),
    );
  };

  /**
   * Восстановить слоты 1–20 из пользовательского плана и текст 5–7 для текущей книги.
   * Работает даже если книгу переименовали — слоты кладутся в activeStory.
   */
  const handleResyncLabyrinthCanon = () => {
    if (!activeStory) return;
    if (
      !confirm(
        "Восстановить структуру канона в этой книге?\n• Появятся недостающие главы 1–20\n• Главы 5–7: текст из канона (перезапишет)\n• Текст остальных глав не затирается",
      )
    ) {
      return;
    }
    // 1) всегда правим активную книгу напрямую
    const fixedActive = ensureLabyrinthChapterSlots(activeStory);
    let next = stories.map((s) => (s.id === activeStory.id ? fixedActive : s));
    // 2) плюс общий merge (на случай второй копии / id story-labyrinth)
    next = mergeLabyrinthCanonIntoStories(next);
    // если merge затронул другую запись — всё равно оставим fixedActive в выбранной
    const still = next.find((s) => s.id === activeStory.id);
    if (still && still.chapters.length < fixedActive.chapters.length) {
      next = next.map((s) => (s.id === activeStory.id ? fixedActive : s));
    } else if (still) {
      // merge мог обновить bible — но слоты active уже должны быть полными
      const ensured = ensureLabyrinthChapterSlots(still);
      next = next.map((s) => (s.id === activeStory.id ? ensured : s));
    }
    saveAllStories(next);
    const lab = next.find((s) => s.id === activeStory.id) || next[0];
    if (lab) {
      setSelectedStoryId(lab.id);
      const prefer =
        lab.chapters.find((c) => /глава\s*7/i.test(c.title)) ||
        lab.chapters.find((c) => /глава\s*6/i.test(c.title)) ||
        lab.chapters[lab.chapters.length - 1];
      if (prefer) setSelectedChapterId(prefer.id);
      alert(`Готово: в оглавлении ${lab.chapters.length} глав. Глава 7: ${
        lab.chapters.some((c) => /глава\s*7/i.test(c.title)) ? "есть" : "нет — напишите в чат"
      }.`);
    }
  };

  const handleOpenInAuthorEditor = (chapterId: string) => {
    setSelectedChapterId(chapterId);
    setSelectedText("");
    setTextSelection(null);
    setActiveTab("text");
    setMobilePanel("assistant");
    setOpenAuthorRequest((value) => value + 1);
  };

  // 7. Characters/World rules update wrappers
  const handleUpdateCharacters = (chars: Character[]) => {
    if (!activeStory) return;
    const updatedStory = { ...activeStory, characters: chars, updatedAt: Date.now() };
    saveAllStories(stories.map(s => s.id === activeStory.id ? updatedStory : s));
  };

  const handleUpdateWorldRules = (rules: WorldRule[]) => {
    if (!activeStory) return;
    const updatedStory = { ...activeStory, worldRules: rules, updatedAt: Date.now() };
    saveAllStories(stories.map(s => s.id === activeStory.id ? updatedStory : s));
  };

  const handleUpdateStoryChapters = (chapters: Chapter[]) => {
    if (!activeStory) return;
    const updatedStory = { ...activeStory, chapters, updatedAt: Date.now() };
    saveAllStories(stories.map(s => s.id === activeStory.id ? updatedStory : s));
  };

  // 8. Create a New Book
  const handleCreateNewStory = async () => {
    if (!newTitle.trim()) return;

    setIsCreatingStory(true);
    setCreationError(null);

    let evaluationResult = "";
    const initialWorldRules: WorldRule[] = [];
    const initialCharacters: Character[] = [];
    const initialChapters: Chapter[] = [];
    let hasParsedChapters = false;

    if (newWorldBible.trim()) {
      initialWorldRules.push({
        id: "rule-bible-" + Math.random().toString(36).substr(2, 9),
        title: "Библия мира (Сеттинг)",
        content: newWorldBible
      });
    }

    if (newWorldBible.trim() || newBookPlan.trim()) {
      try {
        // Run both evaluation and extraction in parallel for fast loading
        const [evalResponse, parseResponse] = await Promise.all([
          fetch("/api/writer/ai", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "evaluate_idea",
              title: newTitle,
              genre: newGenre,
              description: newDesc,
              worldBible: newWorldBible,
              bookPlan: newBookPlan,
              ...llmApiFields,
            }),
          }),
          fetch("/api/writer/ai", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "parse_import",
              text: `Библия мира (сеттинг):\n${newWorldBible}\n\nПлан сюжета и книга:\n${newBookPlan}`,
              ...llmApiFields,
            }),
          })
        ]);

        if (evalResponse.ok) {
          const evalData = await evalResponse.json();
          evaluationResult = evalData.result;
        }

        if (parseResponse.ok) {
          const parseData = await parseResponse.json();
          try {
            const parsed = JSON.parse(parseData.result);
            
            // Extract parsed characters
            if (parsed.characters && Array.isArray(parsed.characters)) {
              parsed.characters.forEach((char: any) => {
                initialCharacters.push({
                  id: "char-ext-" + Math.random().toString(36).substr(2, 9),
                  name: char.name || "Без имени",
                  role: char.role || "Главный",
                  traits: char.traits || "",
                  goals: char.goals || "",
                  description: char.description || ""
                });
              });
            }

            // Extract parsed world rules
            if (parsed.worldRules && Array.isArray(parsed.worldRules)) {
              parsed.worldRules.forEach((rule: any) => {
                if (rule.title && rule.content) {
                  initialWorldRules.push({
                    id: "rule-ext-" + Math.random().toString(36).substr(2, 9),
                    title: rule.title,
                    content: rule.content
                  });
                }
              });
            }

            // Extract parsed chapters
            if (parsed.chapters && Array.isArray(parsed.chapters) && parsed.chapters.length > 0) {
              parsed.chapters.forEach((ch: any) => {
                initialChapters.push({
                  id: "chapter-ext-" + Math.random().toString(36).substr(2, 9),
                  title: ch.title || "Новая глава",
                  summary: ch.summary || "Синопсис из плана",
                  content: ch.content || ""
                });
              });
              hasParsedChapters = true;
            }
          } catch (e) {
            console.error("Failed to parse extracted JSON from Gemini", e);
          }
        }
      } catch (err) {
        console.error("Story creation extraction & evaluation error:", err);
      }
    }

    const storyId = "story-" + Math.random().toString(36).substr(2, 9);

    if (!hasParsedChapters) {
      if (newBookPlan.trim()) {
        initialChapters.push({
          id: "chapter-plan-" + Math.random().toString(36).substr(2, 9),
          title: "План сюжета",
          summary: "План и структура книги.",
          content: newBookPlan
        });
      } else {
        initialChapters.push({
          id: "chapter-1",
          title: "Глава 1: Пролог",
          summary: "Первая вводная глава.",
          content: ""
        });
      }
    }

    const newBook: Story = {
      id: storyId,
      title: newTitle,
      genre: newGenre,
      description: newDesc || "Без описания.",
      updatedAt: Date.now(),
      chapters: initialChapters,
      characters: initialCharacters,
      worldRules: initialWorldRules,
      bookPlan: newBookPlan,
      worldBible: newWorldBible
    };

    // Save Muse chat greeting + evaluation result
    const initialMessages = [];
    const extractedStats = `Я успешно извлекла для тебя: **${initialCharacters.length} персонажей** и **${initialWorldRules.length} лор-записей** прямо в твои рабочие вкладки справа! Теперь мы можем легко обращаться к ним при написании.`;
    
    if (evaluationResult) {
      initialMessages.push({
        id: "eval-asst-" + Math.random().toString(36).substr(2, 9),
        role: "assistant",
        content: `Привет! Я твоя творческая Муза. ✨🎨\n\nЯ внимательно изучила загруженную тобой Библию мира и План сюжета для твоей новой книги **«${newTitle}»**.\n\n${initialCharacters.length > 0 || initialWorldRules.length > 0 ? `⚡ **Интеграция Лора и Персонажей**: ${extractedStats}\n\n` : ""}Вот моя подробная профессиональная оценка твоей идеи:\n\n${evaluationResult}`,
        timestamp: Date.now()
      });
    } else {
      initialMessages.push({
        id: "welcome-asst-" + Math.random().toString(36).substr(2, 9),
        role: "assistant",
        content: `Привет! Рада познакомиться. Я твоя творческая Муза. ✨ Я помогу тебе написать книгу **«${newTitle}»**!\n\nОпиши мне своих персонажей, подробности мира или просто поделись сомнениями — и мы вместе сделаем эту историю незабываемой. С чего начнем?`,
        timestamp: Date.now()
      });
    }
    localStorage.setItem(`muse_chat_${storyId}`, JSON.stringify(initialMessages));

    const updatedStories = [...stories, newBook];
    setStories(updatedStories);
    setSelectedStoryId(newBook.id);
    setSelectedChapterId(newBook.chapters[0].id);
    localStorage.setItem("writers_studio_stories", JSON.stringify(updatedStories));

    // Reset Form
    setNewTitle("");
    setNewGenre("Фантастика");
    setNewDesc("");
    setNewWorldBible("");
    setNewBookPlan("");
    setNewBibleFileName("");
    setNewPlanFileName("");
    setIsCreatingStory(false);
    setShowNewStoryModal(false);
    // Keep the current active tab
  };

  // 9. Delete active book
  const handleDeleteStory = () => {
    if (stories.length <= 1) {
      alert("Нельзя удалить единственную книгу!");
      return;
    }

    if (confirm(`Вы уверены, что хотите БЕЗВОЗВРАТНО удалить книгу «${activeStory.title}» со всеми главами, персонажами и заметками?`)) {
      const filtered = stories.filter(s => s.id !== activeStory.id);
      setStories(filtered);
      setSelectedStoryId(filtered[0].id);
      if (filtered[0].chapters && filtered[0].chapters.length > 0) {
        setSelectedChapterId(filtered[0].chapters[0].id);
      }
      localStorage.setItem("writers_studio_stories", JSON.stringify(filtered));
    }
  };

  // 10. Edit active book metadata
  const handleUpdateStoryMetadata = (title: string, genre: string, desc: string, bookPlan?: string, worldBible?: string) => {
    if (!activeStory) return;
    const updatedStory = {
      ...activeStory,
      title,
      genre,
      description: desc,
      bookPlan,
      worldBible,
      updatedAt: Date.now()
    };
    saveAllStories(stories.map(s => s.id === activeStory.id ? updatedStory : s));
    setShowStoryDetailsModal(false);
  };

  const handleAIGeneratePlan = async () => {
    setIsGeneratingPlan(true);
    try {
      const response = await fetch("/api/writer/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate_plan",
          title: editTitle,
          genre: editGenre,
          description: editDesc,
          bookPlan: editBookPlan,
          worldBible: editWorldBible,
          customPrompt: editCustomPrompt,
          ...llmApiFields,
        })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Ошибка генерации плана");
      }

      const data = await response.json();
      setEditBookPlan(data.result);
    } catch (err: any) {
      alert(`Ошибка при генерации сюжета: ${err.message}`);
    } finally {
      setIsGeneratingPlan(false);
    }
  };

  const handleAIGenerateBible = async () => {
    setIsGeneratingBible(true);
    try {
      const response = await fetch("/api/writer/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate_bible",
          title: editTitle,
          genre: editGenre,
          description: editDesc,
          bookPlan: editBookPlan,
          worldBible: editWorldBible,
          customPrompt: editCustomPrompt,
          ...llmApiFields,
        })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Ошибка генерации Библии");
      }

      const data = await response.json();
      setEditWorldBible(data.result);
    } catch (err: any) {
      alert(`Ошибка при генерации Библии мира: ${err.message}`);
    } finally {
      setIsGeneratingBible(false);
    }
  };

  const handleLoadLabirint = async () => {
    try {
      const response = await fetch("/api/dev/load-labirint");
      if (!response.ok) throw new Error("Failed to load");
      const { bible, plan } = await response.json();
      setEditWorldBible(bible);
      setEditBookPlan(plan);
      alert("Данные загружены! Нажмите 'Сохранить'.");
    } catch (e) {
      alert("Не удалось загрузить файлы Лабиринта.");
    }
  };

  const handleApplyPlanToChapters = () => {
    if (!activeStory) return;
    
    const planText = editBookPlan || activeStory.bookPlan || "";
    if (!planText.trim()) {
      alert("План пуст! Загрузите план сюжета, прежде чем разбивать его на главы.");
      return;
    }

    if (!confirm("Внимание! Это удалит все текущие главы (сейчас их " + activeStory.chapters.length + ") и создаст новые согласно тексту плана. Вы уверены?")) return;
    
    const regex = /Глава\s+\d+[.\-:]?\s*([^\n]+)\n([\s\S]*?)(?=(?:Глава\s+\d+)|$)/gi;
    const matches = [...planText.matchAll(regex)];
    
    const newChapters = matches.map((match, index) => {
      const title = match[1].trim();
      let summary = match[2].trim();
      summary = summary.replace(/АКТ \d+.*?$/si, '').replace(/ГЛАВНЫЕ ПОВОРОТЫ.*?$/si, '').replace(/ФИНАЛ.*?$/si, '').trim();
      
      return {
        id: crypto.randomUUID(),
        title: `Глава ${index + 1}. ${title}`,
        summary: summary,
        content: ""
      };
    });

    if (newChapters.length === 0) {
      alert("Не найдено ни одной главы в плане. Убедитесь, что текст содержит 'Глава 1. Название' и описания.");
      return;
    }

    const updated = { ...activeStory, chapters: newChapters, updatedAt: Date.now() };
    const newStories = stories.map(s => s.id === updated.id ? updated : s);
    setStories(newStories);
    localStorage.setItem("writers_studio_stories", JSON.stringify(newStories));
    alert(`Успешно создано ${newChapters.length} глав! Обновите страницу или закройте настройки, чтобы увидеть изменения.`);
  };

  // 10.5. File Import logic
  const readAndSetFile = (file: File) => {
    const isDocx = file.name.endsWith(".docx") || file.name.endsWith(".doc");
    const isTxt = file.name.endsWith(".txt");

    if (!isDocx && !isTxt) {
      alert("Пожалуйста, загрузите файл с расширением .txt или .docx / .doc");
      return;
    }

    if (isDocx) {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const arrayBuffer = event.target?.result as ArrayBuffer;
        try {
          setImportFileContent(await extractDocxText(arrayBuffer));
          setImportFileName(file.name);
          const titleWithoutExt = file.name.replace(/\.[^/.]+$/, "");
          setImportFileTitle(titleWithoutExt);
        } catch (err) {
          console.error(err);
          alert("Не удалось прочитать Word-файл. Пожалуйста, убедитесь, что это корректный файл .docx / .doc");
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result as string;
        setImportFileContent(text);
        setImportFileName(file.name);
        // Strip extension for title
        const titleWithoutExt = file.name.replace(/\.[^/.]+$/, "");
        setImportFileTitle(titleWithoutExt);
      };
      reader.readAsText(file);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    readAndSetFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      readAndSetFile(file);
    }
  };

  const handleAIParseFile = async () => {
    if (!importFileContent.trim()) return;
    setIsParsingFile(true);
    setParsedResult(null);
    try {
      const response = await fetch("/api/writer/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "parse_import",
          text: importFileContent,
          ...llmApiFields,
        })
      });
      if (!response.ok) {
        throw new Error("Не удалось связаться с ИИ-сервером");
      }
      const data = await response.json();
      const parsed = JSON.parse(data.result);
      setParsedResult({
        chapters: parsed.chapters || [],
        characters: parsed.characters || [],
        worldRules: parsed.worldRules || []
      });
    } catch (err: any) {
      console.error(err);
      alert("Ошибка при распознавании файла: " + err.message + ". Пожалуйста, попробуйте еще раз.");
    } finally {
      setIsParsingFile(false);
    }
  };

  const handleExecuteImport = () => {
    if (!activeStory || !importFileContent.trim()) return;

    let updatedStory = { ...activeStory };
    let newSelectedChapterId = selectedChapterId;

    if (importTarget === "auto") {
      if (!parsedResult) {
        alert("Пожалуйста, сначала запустите ИИ-анализ файла!");
        return;
      }
      
      const newChapters = parsedResult.chapters.map(ch => ({
        id: "chapter-" + Math.random().toString(36).substr(2, 9),
        title: ch.title || "Импортированная глава",
        summary: ch.summary || "Распознано ИИ",
        content: ch.content || ""
      }));

      const newCharacters = parsedResult.characters.map(ch => ({
        id: "char-" + Math.random().toString(36).substr(2, 9),
        name: ch.name || "Безымянный персонаж",
        role: ch.role || "Второстепенный",
        traits: ch.traits || "Распознано ИИ",
        goals: ch.goals || "Не указана",
        description: ch.description || ""
      }));

      const newRules = parsedResult.worldRules.map(r => ({
        id: "rule-" + Math.random().toString(36).substr(2, 9),
        title: r.title || "Правило лора",
        content: r.content || ""
      }));

      updatedStory.chapters = [...updatedStory.chapters, ...newChapters];
      updatedStory.characters = [...updatedStory.characters, ...newCharacters];
      updatedStory.worldRules = [...updatedStory.worldRules, ...newRules];

      if (newChapters.length > 0) {
        newSelectedChapterId = newChapters[0].id;
      }
      setActiveTab("muse");
    } else if (importTarget === "chapter") {
      const newCh: Chapter = {
        id: "chapter-" + Math.random().toString(36).substr(2, 9),
        title: importFileTitle || "Импортированная глава",
        summary: "Импортировано из файла " + importFileName,
        content: importFileContent
      };
      updatedStory.chapters = [...updatedStory.chapters, newCh];
      newSelectedChapterId = newCh.id;
    } else if (importTarget === "currentChapter") {
      if (!activeChapter) {
        alert("Нет активной главы для вставки!");
        return;
      }
      updatedStory.chapters = updatedStory.chapters.map(c => 
        c.id === activeChapter.id ? { ...c, content: c.content + (c.content ? "\n\n" : "") + importFileContent } : c
      );
    } else if (importTarget === "worldRule") {
      const newRule: WorldRule = {
        id: "rule-" + Math.random().toString(36).substr(2, 9),
        title: importFileTitle || "Импортированное правило",
        content: importFileContent
      };
      updatedStory.worldRules = [...updatedStory.worldRules, newRule];
      setActiveTab("book");
    } else if (importTarget === "character") {
      const newChar: Character = {
        id: "char-" + Math.random().toString(36).substr(2, 9),
        name: importFileTitle || "Новый персонаж",
        role: "Второстепенный",
        description: importFileContent,
        traits: "Импортировано",
        goals: "Неизвестно"
      };
      updatedStory.characters = [...updatedStory.characters, newChar];
      setActiveTab("book");
    } else if (importTarget === "bookPlan") {
      updatedStory.bookPlan = importFileContent;
      setActiveTab("text");
    } else if (importTarget === "worldBible") {
      updatedStory.worldBible = importFileContent;
      setActiveTab("text");
    }

    updatedStory.updatedAt = Date.now();
    saveAllStories(stories.map(s => s.id === activeStory.id ? updatedStory : s));
    
    if (importTarget === "chapter" || (importTarget === "auto" && parsedResult && parsedResult.chapters.length > 0)) {
      setSelectedChapterId(newSelectedChapterId);
    }

    // Reset and close
    setImportFileContent("");
    setImportFileName("");
    setImportFileTitle("");
    setParsedResult(null);
    setShowImportModal(false);
  };

  // 11. Export as TXT / Word
  const handleExportTxt = () => {
    if (!activeStory) return;
    
    let textOut = `=== КНИГА: ${activeStory.title} ===\nЖанр: ${activeStory.genre}\nОписание: ${activeStory.description}\n\n`;
    
    activeStory.chapters.forEach((ch, idx) => {
      textOut += `\n\n-----------------------------\n${ch.title}\n-----------------------------\n\n${ch.content}\n`;
    });

    // Character listing
    textOut += `\n\n=============================\nПЕРСОНАЖИ\n=============================\n`;
    activeStory.characters.forEach(char => {
      textOut += `\nИмя: ${char.name}\nРоль: ${char.role}\nЧерты: ${char.traits}\nЦель: ${char.goals}\nОписание:\n${char.description}\n`;
    });

    const element = document.createElement("a");
    const file = new Blob([textOut], { type: "text/plain;charset=utf-8" });
    element.href = URL.createObjectURL(file);
    element.download = `${activeStory.title}.txt`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const handleExportDoc = async () => {
    if (!activeStory) return;
    try {
      const { exportStoryDocx } = await import("./lib/exportDocx");
      const result = await exportStoryDocx(activeStory);
      if (result.savedNatively && !result.openedInDocumentApp) {
        alert(`Word-файл сохранён в Загрузки: ${result.filename}. Установите Word или другой редактор DOCX, чтобы открыть его.`);
      }
    } catch (err) {
      console.error(err);
      alert("Не удалось сформировать Word-файл (.docx). Попробуйте ещё раз.");
    }
  };

  const handleManualSave = () => {
    setIsSaving(true);
    localStorage.setItem("writers_studio_stories", JSON.stringify(stories));
    setShowSaveSuccess(true);
    setTimeout(() => {
      setIsSaving(false);
      setShowSaveSuccess(false);
    }, 1200);
  };

  const handleExportSingleChapterDoc = async (ch: Chapter) => {
    if (!activeStory) return;
    try {
      const { exportChapterDocx } = await import("./lib/exportDocx");
      const result = await exportChapterDocx(activeStory.title, ch);
      if (result.savedNatively && !result.openedInDocumentApp) {
        alert(`Word-файл сохранён в Загрузки: ${result.filename}. Установите Word или другой редактор DOCX, чтобы открыть его.`);
      }
    } catch (err) {
      console.error(err);
      alert("Не удалось сформировать Word-файл (.docx). Попробуйте ещё раз.");
    }
  };

  // Metrics
  const getWordCount = (text: string) => {
    if (!text.trim()) return 0;
    return text.trim().split(/\s+/).length;
  };

  const getCharCount = (text: string) => {
    return text.length;
  };

  const handlePublishChapter = (chapterId: string) => {
    if (!activeStory) return;
    const ch = activeStory.chapters.find(c => c.id === chapterId);
    if (!ch) return;

    const wordCount = getWordCount(ch.content);

    // Update isPublished field of the chapter
    const updatedChapters = activeStory.chapters.map(c => 
      c.id === chapterId ? { ...c, isPublished: true } : c
    );

    const updatedStory = {
      ...activeStory,
      chapters: updatedChapters,
      updatedAt: Date.now()
    };

    const updatedStories = stories.map(s => 
      s.id === activeStory.id ? updatedStory : s
    );

    saveAllStories(updatedStories);
    setPublishedChapterDetails({ title: ch.title, wordCount });
    setShowPublishSuccessModal(true);
  };

  return (
    <div
      className="notranslate flex flex-col h-[100dvh] w-full bg-[#0b0f19] text-slate-100 selection:bg-blue-600/30 overflow-hidden"
      id="main-app-container"
      lang="ru"
      translate="no"
    >
      {/* Top Navigation Panel */}
      <header className="flex items-center gap-2 px-3 sm:px-5 h-14 bg-[#0e1424] border-b border-slate-800/80 shrink-0 z-10">
        {/* Book Selector Dropdown */}
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
          <BookMarked className="hidden sm:block w-5 h-5 text-blue-400" />
          <div className="flex items-center gap-1.5">
            <select
              value={selectedStoryId}
              onChange={(e) => {
                const s = stories.find(story => story.id === e.target.value);
                if (s) {
                  setSelectedStoryId(s.id);
                  if (s.chapters && s.chapters.length > 0) {
                    setSelectedChapterId(s.chapters[0].id);
                  }
                }
              }}
              className="max-w-[12.5rem] sm:max-w-none bg-slate-900 border border-slate-800 text-slate-100 px-2.5 py-1.5 text-xs sm:text-sm rounded-lg font-medium outline-none focus:border-blue-500 cursor-pointer"
              id="book-selector"
            >
              {stories.map(s => (
                <option key={s.id} value={s.id}>{s.title}</option>
              ))}
            </select>
            
            <button
              onClick={() => setShowStoryDetailsModal(true)}
              title="Материалы и параметры книги"
              className="p-1.5 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded-lg cursor-pointer transition-colors"
            >
              <Info className="w-4 h-4" />
            </button>
          </div>

          <button
            onClick={() => setShowNewStoryModal(true)}
            className="hidden sm:flex px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded-lg items-center gap-1 cursor-pointer transition-colors whitespace-nowrap"
            id="create-new-book-btn"
            title="Добавить новую книгу в студию"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Добавить новую книгу</span>
          </button>
        </div>

        <div className="flex lg:hidden items-center gap-1.5 shrink-0">
          <button type="button" onClick={openLlmSettings} className="min-h-10 min-w-10 grid place-items-center rounded-xl border border-amber-800/50 bg-amber-950/30 text-amber-200" aria-label="Ключи API" title="Ключи API"><Settings className="w-4 h-4" /></button>
          <button type="button" onClick={() => setShowAuthorProfile(true)} className="min-h-10 min-w-10 grid place-items-center rounded-xl border border-emerald-800/50 bg-emerald-950/30 text-emerald-200" aria-label="Профиль автора" title="Профиль автора"><Fingerprint className="w-4 h-4" /></button>
        </div>

        {/* Desktop sync and global actions */}
        <div className="hidden lg:flex items-center gap-4">

          <div className="text-xs text-slate-400 flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full ${isSaving ? "bg-amber-400 animate-pulse" : "bg-emerald-500"}`} />
            <span>{isSaving ? "Сохранение..." : "Автосохранение включено"}</span>
          </div>

          <div className="h-4 w-px bg-slate-800" />

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            {/* LLM provider switch + API keys.
                translate="no" — иначе переводчик браузера ломает бренды:
                NVIDIA→«ВИДА», Gemini→«Близнецы», Groq→«Грок». */}
            <div
              className="notranslate flex items-center gap-1 pl-1 pr-0.5 py-0.5 rounded-xl bg-gradient-to-r from-slate-900 via-slate-900 to-slate-900/80 border border-slate-700/80 shadow-inner max-w-[min(100vw-2rem,32rem)] overflow-x-auto"
              title={`Сейчас: ${providerLabel(llmProvider)} · модель: ${selectedModel}`}
              id="llm-provider-switch"
              translate="no"
              lang="en"
            >
              <button
                type="button"
                onClick={openLlmSettings}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold text-amber-200/90 bg-amber-950/40 border border-amber-800/40 hover:bg-amber-900/50 hover:text-amber-100 cursor-pointer shrink-0 transition-colors"
                title="Настройки ключей API"
                id="llm-settings-btn"
              >
                <Settings className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">API</span>
              </button>
              <div className="w-px h-5 bg-slate-700/80 shrink-0" />
              <Cpu className="w-3.5 h-3.5 text-slate-500 ml-0.5 shrink-0" />
              {(
                [
                  { id: "auto" as const, label: "Авто", active: "bg-violet-600/35 text-violet-200 border-violet-600/50", hint: "Автовыбор: Gemini → Groq → NVIDIA" },
                  { id: "gemini" as const, label: "Gemini", active: "bg-blue-600/35 text-blue-200 border-blue-600/50", hint: "Google Gemini" },
                  { id: "groq" as const, label: "Groq", active: "bg-orange-600/35 text-orange-200 border-orange-600/50", hint: "Groq API" },
                  { id: "nvidia" as const, label: "NVIDIA", active: "bg-green-600/35 text-green-200 border-green-600/50", hint: "NVIDIA NIM" },
                  { id: "openrouter" as const, label: "OpenRouter", active: "bg-pink-600/35 text-pink-200 border-pink-600/50", hint: "OpenRouter" },
                ] as const
              ).map((opt) => {
                const ok = providerHasKey(opt.id);
                const selected = llmProvider === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    disabled={!ok && opt.id !== "auto"}
                    onClick={() => setLlmProvider(opt.id)}
                    className={`notranslate px-2 py-1 rounded-lg text-[10px] sm:text-[11px] font-medium transition-all cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed whitespace-nowrap border ${
                      selected
                        ? opt.active
                        : "text-slate-400 hover:text-slate-100 border-transparent hover:bg-slate-800/60"
                    }`}
                    id={`llm-provider-${opt.id}`}
                    translate="no"
                    lang="en"
                    title={
                      ok || opt.id === "auto"
                        ? `${opt.hint}${selected ? ` · модель: ${selectedModel}` : ""}`
                        : "Нет ключа — откройте API"
                    }
                  >
                    {/* <span> + unicode isolates — Chrome Translate часто не трогает */}
                    <span translate="no" className="notranslate">
                      {"\u2068"}{opt.label}{"\u2069"}
                    </span>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => setShowAuthorProfile(true)}
              className="p-2 rounded-lg cursor-pointer transition-all flex items-center gap-1.5 text-xs font-medium border bg-emerald-950/25 border-emerald-900/60 text-emerald-300 hover:bg-emerald-950/45 hover:text-emerald-200"
              title="Открыть единый профиль автора: образец, паспорт голоса и защищённые термины"
              id="author-profile-open-btn"
            >
              <Fingerprint className="w-4 h-4" />
              <span>Профиль автора</span>
            </button>

            <button
              onClick={() => setFocusMode(!focusMode)}
              className={`p-2 rounded-lg cursor-pointer transition-all flex items-center gap-1.5 text-xs font-medium border ${
                focusMode 
                  ? "bg-purple-950/40 text-purple-400 border-purple-800" 
                  : "bg-slate-900 border-slate-800 text-slate-300 hover:text-white"
              }`}
              title={focusMode ? "Выйти из режима фокуса" : "Включить режим фокуса (скрыть ИИ)"}
              id="focus-mode-toggle"
            >
              {focusMode ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              <span>Режим Фокуса</span>
            </button>

            <button
              onClick={() => setShowImportModal(true)}
              className="p-2 bg-[#10b981]/15 hover:bg-[#10b981]/25 border border-[#10b981]/30 hover:border-[#10b981]/50 text-[#34d399] hover:text-[#6ee7b7] text-xs rounded-lg flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap"
              title="Загрузить план, библию мира, персонажа или главу из .TXT или Word (.docx)"
              id="import-txt-btn"
            >
              <Upload className="w-4 h-4" />
              <span>Загрузить TXT / Word</span>
            </button>

            <button
              onClick={handleExportTxt}
              className="p-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white text-xs rounded-lg flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap"
              title="Скачать всю рукопись (.txt)"
              id="export-book-btn"
            >
              <Download className="w-4 h-4" />
              <span>Скачать .TXT</span>
            </button>

            <button
              onClick={handleExportDoc}
              className="p-2 bg-blue-600/15 hover:bg-blue-600/25 border border-blue-500/30 hover:border-blue-500/50 text-blue-400 hover:text-blue-300 text-xs rounded-lg flex items-center gap-1.5 transition-all cursor-pointer"
              title="Скачать всю рукопись с разметкой глав, персонажей и лора в формате Word (.docx)"
              id="export-doc-btn"
            >
              <FileText className="w-4 h-4" />
              <span>Скачать в Word</span>
            </button>

            <button
              onClick={handleDeleteStory}
              className="p-2 text-slate-400 hover:text-red-400 hover:bg-slate-800/50 rounded-lg cursor-pointer transition-colors"
              title="Удалить текущую книгу полностью"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <div className="lg:hidden flex items-center gap-2 overflow-x-auto border-b border-slate-800/80 bg-[#0e1424] px-3 py-2 shrink-0" aria-label="Экспорт рукописи">
        <button
          type="button"
          onClick={() => activeChapter && handleExportSingleChapterDoc(activeChapter)}
          disabled={!activeChapter}
          className="min-h-10 shrink-0 rounded-xl border border-indigo-500/35 bg-indigo-950/35 px-3 text-xs font-semibold text-indigo-200 disabled:cursor-not-allowed disabled:opacity-40 flex items-center gap-1.5"
          title="Скачать текущую главу как Word (.docx)"
          id="mobile-export-chapter-doc-btn"
        >
          <FileText className="h-4 w-4" />
          <span>Глава в Word</span>
        </button>
        <button
          type="button"
          onClick={handleExportDoc}
          disabled={!activeStory}
          className="min-h-10 shrink-0 rounded-xl border border-blue-500/35 bg-blue-950/35 px-3 text-xs font-semibold text-blue-200 disabled:cursor-not-allowed disabled:opacity-40 flex items-center gap-1.5"
          title="Скачать всю книгу как Word (.docx)"
          id="mobile-export-book-doc-btn"
        >
          <Download className="h-4 w-4" />
          <span>Вся книга в Word</span>
        </button>
      </div>

      {openrouterFallbackNotice && (
        <div role="status" className="fixed inset-x-3 top-3 z-[70] mx-auto flex max-w-lg items-start gap-3 rounded-xl border border-amber-500/40 bg-slate-950/95 p-3 text-xs text-amber-100 shadow-2xl">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
          <p className="flex-1 leading-relaxed">{openrouterFallbackNotice}</p>
          <button type="button" onClick={() => setOpenrouterFallbackNotice(null)} className="min-h-8 min-w-8 rounded-lg text-amber-200 hover:bg-amber-500/15" aria-label="Закрыть уведомление"><X className="h-4 w-4" /></button>
        </div>
      )}

      {/* Main Workspace Frame */}
      <div className="flex flex-1 overflow-hidden w-full relative pb-[4.5rem] lg:pb-0">
        
        {/* Leftmost Chapter Sidebar */}
        {!focusMode && activeStory && (
          <aside className="hidden lg:flex w-64 bg-[#0e1424]/60 border-r border-slate-800/80 p-4 flex-col shrink-0" id="chapters-sidebar">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800/60 mb-3">
              <span className="text-xs uppercase font-bold tracking-wider text-slate-400 flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-blue-400" />
                Оглавление
              </span>
              <div className="flex items-center gap-0.5">
                <button
                  onClick={handleResyncLabyrinthCanon}
                  className="p-1.5 hover:bg-slate-800 text-slate-200 hover:text-emerald-300 rounded-lg transition-colors cursor-pointer"
                  title="Восстановить главы 1–9 (в т.ч. 7-ю) и текст 5–6"
                  id="resync-canon-btn"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
                <button
                  onClick={handleAddChapter}
                  className="p-1.5 hover:bg-slate-800 text-slate-200 hover:text-white rounded-lg transition-colors cursor-pointer"
                  title="Добавить главу"
                  id="add-chapter-btn"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto space-y-1.5" id="chapters-list">
              {activeStory.chapters.map((ch) => (
                <div
                  key={ch.id}
                  onClick={() => {
                    setSelectedChapterId(ch.id);
                    setSelectedText("");
                    setTextSelection(null);
                  }}
                  className={`p-2.5 rounded-xl border cursor-pointer transition-all group flex justify-between items-center gap-1 ${
                    selectedChapterId === ch.id
                      ? "bg-blue-600/10 text-blue-400 border-blue-500/40"
                      : "bg-transparent text-slate-300 border-transparent hover:bg-slate-800/40 hover:text-slate-100"
                  }`}
                >
                  <div className="flex items-center gap-2 overflow-hidden min-w-0">
                    <FileText className="w-4 h-4 shrink-0 opacity-70" />
                    <span className="text-xs font-medium truncate">{ch.title}</span>
                  </div>
                  
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteChapter(ch.id);
                    }}
                    className="opacity-70 group-hover:opacity-100 text-slate-500 hover:text-red-400 p-1 rounded transition-opacity shrink-0"
                    title="Удалить главу из оглавления"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
            
            {/* Story Quick Info card */}
            <div className="mt-4 p-3 bg-slate-950/40 border border-slate-800/80 rounded-xl">
              <span className="text-[10px] text-slate-400 font-bold block mb-1">О ПИСАТЕЛЬСКОМ ИНСТРУМЕНТЕ:</span>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                Студия Писателя объединяет удобный редактор с мощной языковой моделью. Выделяйте фрагменты в тексте для точечного улучшения стиля, обсуждайте сюжетные дыры с Музой в чате или создавайте персонажей за секунды.
              </p>
            </div>
          </aside>
        )}

        {/* Center Section: The Editor Workspace */}
        <main className="min-w-0 flex-1 flex flex-col bg-[#0b0f19] h-full overflow-hidden relative">
          {activeChapter ? (
            <div className="flex-1 flex flex-col h-full overflow-hidden p-3 sm:p-4 lg:p-6 max-w-4xl mx-auto w-full">
              
              {/* Chapter Title Edit Block */}
              <div className="mb-3 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-3 border-b border-slate-800/40 pb-3" id="chapter-title-edit-block">
                <div className="flex-1 space-y-1 w-full">
                  <input
                    type="text"
                    value={activeChapter.title}
                    onChange={(e) => handleUpdateChapterDetails(e.target.value, activeChapter.summary)}
                    placeholder="Заголовок главы..."
                    className="bg-transparent text-slate-100 text-xl sm:text-2xl font-bold tracking-tight outline-none w-full pb-0.5"
                  />
                  <input
                    type="text"
                    value={activeChapter.summary}
                    onChange={(e) => handleUpdateChapterDetails(activeChapter.title, e.target.value)}
                    placeholder="Коротко о событиях главы..."
                    className="bg-transparent text-slate-400 text-xs italic outline-none w-full"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    onClick={() => handleOpenInAuthorEditor(activeChapter.id)}
                    className="min-h-10 px-3 py-1.5 bg-emerald-600/10 hover:bg-emerald-600/20 text-emerald-400 border border-emerald-500/20 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all"
                    title="Открыть бережную редактуру с голосом автора"
                  >
                    <Wand2 className="w-3.5 h-3.5" />
                    <span>В бережную редактуру</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleClearActiveChapterContent}
                    disabled={!activeChapter.content?.trim()}
                    className="min-h-10 px-3 py-1.5 bg-red-950/30 hover:bg-red-900/50 border border-red-900/50 hover:border-red-700/70 text-red-300 hover:text-red-100 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Стереть текст текущей главы, сохранив её название и место в оглавлении"
                    id="clear-chapter-content-btn"
                  >
                    <Eraser className="w-3.5 h-3.5" />
                    <span>Стереть главу</span>
                  </button>

                  {/* Words metric tag */}
                  <div className={`px-2.5 py-1 rounded-lg text-[10px] font-mono border ${
                    getWordCount(activeChapter.content) >= 1500
                      ? "bg-emerald-950/20 text-emerald-400 border-emerald-900/30"
                      : "bg-slate-950 text-slate-400 border-slate-800"
                  }`} title="Рекомендуемый объём главы">
                    {getWordCount(activeChapter.content)} / 1500 слов
                  </div>

                  {/* Save button */}
                  <button
                    onClick={handleManualSave}
                    className={`min-h-10 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer border ${
                      showSaveSuccess
                        ? "bg-emerald-950/40 text-emerald-400 border-emerald-900/50"
                        : "bg-slate-900 hover:bg-slate-800 text-slate-300 border-slate-850"
                    }`}
                  >
                    <Save className={`w-3.5 h-3.5 ${showSaveSuccess ? "animate-bounce" : ""}`} />
                    <span>{showSaveSuccess ? "Сохранено!" : "Сохранить"}</span>
                  </button>

                  {/* Download as Word button */}
                  <button
                    onClick={() => handleExportSingleChapterDoc(activeChapter)}
                    className="hidden sm:flex min-h-10 px-3 py-1.5 bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-400 hover:text-indigo-300 border border-indigo-500/20 rounded-lg text-xs font-semibold items-center gap-1.5 transition-all cursor-pointer"
                    title="Скачать эту главу как Word документ (.docx)"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Скачать в Word</span>
                  </button>

                  {/* Clear current chapter text only */}
                  <button
                    onClick={handleClearActiveChapterContent}
                    className="hidden sm:flex min-h-10 px-3 py-1.5 bg-amber-600/10 hover:bg-amber-600/20 text-amber-400 hover:text-amber-300 border border-amber-500/20 rounded-lg text-xs font-semibold items-center gap-1.5 transition-all cursor-pointer"
                    title="Стереть текст этой главы (название в оглавлении останется)"
                    id="clear-chapter-content-btn"
                  >
                    <Eraser className="w-3.5 h-3.5" />
                    <span>Стереть</span>
                  </button>
                </div>
              </div>

              {/* Distraction-Free Textarea Editor */}
              <div className="flex-1 bg-slate-900/30 border border-slate-800/60 rounded-xl overflow-hidden flex flex-col relative">
                <textarea
                  ref={textareaRef}
                  value={activeChapter.content}
                  onChange={handleEditorChange}
                  onMouseUp={handleTextSelection}
                  onKeyUp={handleTextSelection}
                  placeholder="Начните писать свой роман здесь... Вы также можете выделить нужный кусок и воспользоваться Редактором Стиля справа."
                  className="flex-1 w-full p-4 sm:p-6 text-[15px] sm:text-sm leading-7 sm:leading-relaxed bg-transparent text-slate-100 outline-none resize-none font-sans scrollbar-thin placeholder:text-slate-600"
                  id="draft-editor-textarea"
                />

                {/* Selection floating helper & Micro-editing Toolbar */}
                {selectedText && (
                  <div className="hidden sm:flex absolute top-4 right-8 px-2 py-1.5 bg-slate-900 border border-emerald-900/50 text-slate-300 text-[11px] font-medium rounded-lg shadow-2xl flex items-center gap-2 z-10 transition-all shadow-emerald-900/20">
                    <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Выделено {getWordCount(selectedText)} слов</span>
                    <div className="h-4 w-px bg-slate-700 mx-1"></div>
                    <button
                      disabled={isMicroEditing}
                      onClick={() => handleMicroEdit("rewrite")}
                      className="px-2 py-1 rounded bg-slate-800 hover:bg-emerald-900/40 hover:text-emerald-300 disabled:opacity-50 cursor-pointer transition-colors"
                    >
                      Переписать
                    </button>
                    <button
                      disabled={isMicroEditing}
                      onClick={() => handleMicroEdit("show-dont-tell")}
                      className="px-2 py-1 rounded bg-slate-800 hover:bg-emerald-900/40 hover:text-emerald-300 disabled:opacity-50 cursor-pointer transition-colors"
                    >
                      Показывай, а не рассказывай
                    </button>
                    <button
                      disabled={isMicroEditing}
                      onClick={() => handleMicroEdit("sensory")}
                      className="px-2 py-1 rounded bg-slate-800 hover:bg-emerald-900/40 hover:text-emerald-300 disabled:opacity-50 cursor-pointer transition-colors"
                    >
                      Больше чувств
                    </button>
                    <button
                      disabled={isMicroEditing}
                      onClick={() => handleMicroEdit("expand")}
                      className="px-2 py-1 rounded bg-slate-800 hover:bg-emerald-900/40 hover:text-emerald-300 disabled:opacity-50 cursor-pointer transition-colors"
                    >
                      Расширить
                    </button>
                    {isMicroEditing && <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400 ml-1" />}
                  </div>
                )}

                {/* Editor Footer / Metric Counter */}
                <div className="h-10 border-t border-slate-800/60 px-3 sm:px-4 bg-slate-950/40 flex justify-between items-center shrink-0 text-[11px] sm:text-xs font-mono text-slate-400">
                  <div className="flex gap-2 sm:gap-4">
                    <span>Слов: <strong>{getWordCount(activeChapter.content)}</strong></span>
                    <span className="hidden sm:inline">Символов: <strong>{getCharCount(activeChapter.content)}</strong></span>
                  </div>
                  <div className="hidden sm:block text-[10px] text-slate-500 uppercase">
                    UTF-8 • Draft Mode
                  </div>
                </div>
              </div>

              {/* Bottom Quick AI Continuer helper */}
              {!focusMode && (
                <div className="mt-3 flex items-center justify-between gap-3 p-3 bg-slate-900/40 border border-slate-800/80 rounded-xl shrink-0">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 bg-blue-500/10 text-blue-400 rounded-lg">
                      <Sparkle className="w-4 h-4 animate-spin-slow" />
                    </div>
                    <div>
                      <h4 className="text-xs font-semibold text-slate-200">Достигли тупика в главе?</h4>
                      <p className="text-[10px] text-slate-400">Позвольте ИИ предложить плавное продолжение сцены.</p>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setActiveTab("text");
                      setShowAgent(false);
                      setMobilePanel("assistant");
                      // Открываем короткий режим продолжения напрямую: прокрутка на Android не нужна.
                      setQuickContinueRequest((request) => request + 1);
                    }}
                    className="min-h-10 shrink-0 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1 transition-all cursor-pointer"
                  >
                    Продолжить ИИ
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-12">
              <BookOpen className="w-12 h-12 text-slate-700 mb-3" />
              <p className="text-slate-400 text-sm">Главы не обнаружены. Создайте первую главу в боковом оглавлении!</p>
              <button
                onClick={handleAddChapter}
                className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg"
              >
                Добавить главу
              </button>
            </div>
          )}
        </main>

        {/* Правая панель строится вокруг задач автора, а не отдельных ИИ-движков. */}
        {!focusMode && activeStory && (
          <aside className="hidden lg:flex w-96 bg-[#0e1424]/60 border-l border-slate-800/80 flex-col shrink-0" id="assistant-panel">
            <div className="flex border-b border-slate-800/80 bg-slate-950/50 p-1 gap-1 shrink-0 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setActiveTab("text")}
                className={`flex-1 py-2.5 rounded-lg transition-all cursor-pointer text-center ${
                  activeTab === "text"
                    ? "bg-slate-800 text-slate-100 font-bold border border-slate-700/50"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Текст
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("book")}
                className={`flex-1 py-2.5 rounded-lg transition-all cursor-pointer text-center ${
                  activeTab === "book"
                    ? "bg-slate-800 text-slate-100 font-bold border border-slate-700/50"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Книга
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("muse")}
                className={`flex-1 py-2.5 rounded-lg transition-all cursor-pointer text-center ${
                  activeTab === "muse"
                    ? "bg-slate-800 text-slate-100 font-bold border border-slate-700/50"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Муза
              </button>
            </div>

            <div className="flex-1 overflow-hidden p-4">
              <React.Suspense fallback={<div className="text-slate-500 text-sm p-4">Загрузка…</div>}>
                {activeTab === "text" && (
                  showAgent ? (
                    <AgentPanel
                      story={activeStory}
                      currentDraft={activeChapter?.content || ""}
                      activeChapter={activeChapter}
                      selectedModel={selectedModel}
                      llmProvider={llmProvider}
                      llmApiFields={llmApiFields}
                      onInsertText={handleInsertText}
                      onClose={() => setShowAgent(false)}
                    />
                  ) : (
                    <AIPanel
                      story={activeStory}
                      currentDraft={activeChapter?.content || ""}
                      selectedText={selectedText}
                      textSelection={textSelection}
                      onInsertText={handleInsertText}
                      onApplyAuthorEdit={handleApplyAuthorEdit}
                      activeChapter={activeChapter}
                      onUpdateStoryChapters={handleUpdateStoryChapters}
                      selectedModel={selectedModel}
                      llmProvider={llmProvider}
                      llmApiFields={llmApiFields}
                      openAuthorRequest={openAuthorRequest}
                      quickContinueRequest={quickContinueRequest}
                      onOpenAuthorProfile={() => setShowAuthorProfile(true)}
                      onOpenAgent={() => setShowAgent(true)}
                    />
                  )
                )}
                {activeTab === "book" && (
                  <BookPanel
                    story={activeStory}
                    onUpdateCharacters={handleUpdateCharacters}
                    onUpdateWorldRules={handleUpdateWorldRules}
                    selectedModel={selectedModel}
                    llmProvider={llmProvider}
                    llmApiFields={llmApiFields}
                    onOpenBookMaterials={() => setShowStoryDetailsModal(true)}
                  />
                )}
                {activeTab === "muse" && (
                  <MuseChat
                    story={activeStory}
                    currentDraft={activeChapter?.content || ""}
                    selectedModel={selectedModel}
                    llmProvider={llmProvider}
                    llmApiFields={llmApiFields}
                  />
                )}
              </React.Suspense>
            </div>
          </aside>
        )}
      </div>

      {/* Mobile navigation: один главный экран и две выезжающие панели вместо трёх постоянных колонок. */}
      {!focusMode && activeStory && (
        <>
          {mobilePanel && (
            <div className="lg:hidden fixed inset-0 z-40">
              <button type="button" aria-label="Закрыть панель" onClick={() => setMobilePanel(null)} className="absolute inset-0 bg-slate-950/75 backdrop-blur-sm" />
              <section className="absolute inset-x-0 bottom-0 flex h-[82dvh] min-h-0 max-h-[82dvh] flex-col rounded-t-3xl border-t border-slate-700 bg-[#0e1424] shadow-2xl shadow-black/60" role="dialog" aria-modal="true">
                {mobilePanel === "chapters" ? (
                  <>
                    <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
                      <div><p className="text-sm font-semibold text-slate-100">Главы</p><p className="text-[11px] text-slate-500">{activeStory.title}</p></div>
                      <button type="button" onClick={() => setMobilePanel(null)} className="min-h-10 min-w-10 grid place-items-center rounded-xl border border-slate-700 text-slate-300" aria-label="Закрыть"><X className="w-4 h-4" /></button>
                    </div>
                    <div className="grid grid-cols-2 gap-2 border-b border-slate-800 bg-slate-950/35 p-3">
                      <button type="button" onClick={() => { setMobilePanel(null); setShowNewStoryModal(true); }} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-3 text-sm font-semibold text-white shadow-lg shadow-blue-950/30"><Plus className="h-4 w-4" />Новая книга</button>
                      <button type="button" onClick={handleAddChapter} className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 text-sm font-semibold text-slate-200"><Plus className="h-4 w-4" />Новая глава</button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-3 pb-6 space-y-1.5">
                      {activeStory.chapters.map((ch) => (
                        <button key={ch.id} type="button" onClick={() => { setSelectedChapterId(ch.id); setSelectedText(""); setTextSelection(null); setMobilePanel(null); }} className={`flex min-h-12 w-full items-center gap-3 rounded-xl border px-3 text-left transition ${selectedChapterId === ch.id ? "border-blue-500/50 bg-blue-600/15 text-blue-200" : "border-transparent bg-slate-900/50 text-slate-300"}`}>
                          <FileText className="h-4 w-4 shrink-0" /><span className="min-w-0 flex-1 truncate text-sm font-medium">{ch.title}</span><span className="text-[10px] text-slate-500">{getWordCount(ch.content)} слов</span>
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3"><div><p className="text-sm font-semibold text-slate-100">{activeTab === "text" ? "Инструменты текста" : activeTab === "book" ? "Книга" : "Муза"}</p><p className="text-[11px] text-slate-500">Проведите вниз или нажмите ×, чтобы вернуться к рукописи</p></div><button type="button" onClick={() => setMobilePanel(null)} className="min-h-10 min-w-10 grid place-items-center rounded-xl border border-slate-700 text-slate-300" aria-label="Закрыть"><X className="w-4 h-4" /></button></div>
                    <div className="flex border-b border-slate-800 bg-slate-950/50 p-1 gap-1 shrink-0 text-xs font-semibold">
                      {([ ["text", "Текст"], ["book", "Книга"], ["muse", "Муза"] ] as const).map(([tab, label]) => <button key={tab} type="button" onClick={() => { setActiveTab(tab); setShowAgent(false); }} className={`min-h-10 flex-1 rounded-lg ${activeTab === tab ? "bg-slate-800 text-slate-100" : "text-slate-400"}`}>{label}</button>)}
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto touch-pan-y overscroll-contain p-3">
                      <React.Suspense fallback={<div className="p-4 text-sm text-slate-500">Загрузка…</div>}>
                        {activeTab === "text" && (showAgent ? <AgentPanel story={activeStory} currentDraft={activeChapter?.content || ""} activeChapter={activeChapter} selectedModel={selectedModel} llmProvider={llmProvider} llmApiFields={llmApiFields} onInsertText={handleInsertText} onClose={() => setShowAgent(false)} /> : <AIPanel story={activeStory} currentDraft={activeChapter?.content || ""} selectedText={selectedText} textSelection={textSelection} onInsertText={handleInsertText} onApplyAuthorEdit={handleApplyAuthorEdit} activeChapter={activeChapter} onUpdateStoryChapters={handleUpdateStoryChapters} selectedModel={selectedModel} llmProvider={llmProvider} llmApiFields={llmApiFields} openAuthorRequest={openAuthorRequest} quickContinueRequest={quickContinueRequest} onOpenAuthorProfile={() => setShowAuthorProfile(true)} onOpenAgent={() => setShowAgent(true)} />)}
                        {activeTab === "book" && <BookPanel story={activeStory} onUpdateCharacters={handleUpdateCharacters} onUpdateWorldRules={handleUpdateWorldRules} selectedModel={selectedModel} llmProvider={llmProvider} llmApiFields={llmApiFields} onOpenBookMaterials={() => setShowStoryDetailsModal(true)} />}
                        {activeTab === "muse" && <MuseChat story={activeStory} currentDraft={activeChapter?.content || ""} selectedModel={selectedModel} llmProvider={llmProvider} llmApiFields={llmApiFields} />}
                      </React.Suspense>
                    </div>
                  </>
                )}
              </section>
            </div>
          )}

          <nav className="lg:hidden fixed inset-x-0 bottom-0 z-30 flex h-[4.5rem] items-stretch border-t border-slate-700/80 bg-[#0e1424]/98 px-1 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_rgba(0,0,0,.25)]" aria-label="Основная навигация">
            <button type="button" onClick={() => setMobilePanel("chapters")} className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-1 text-[10px] ${mobilePanel === "chapters" ? "text-blue-300" : "text-slate-400"}`}><Layers className="h-5 w-5" /><span>Главы</span></button>
            <button type="button" onClick={() => setMobilePanel(null)} className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-1 text-[10px] ${mobilePanel === null ? "text-blue-300" : "text-slate-400"}`}><FileText className="h-5 w-5" /><span>Писать</span></button>
            <button type="button" onClick={() => { setActiveTab("text"); setMobilePanel("assistant"); }} className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-1 text-[10px] ${mobilePanel === "assistant" && activeTab === "text" ? "text-violet-300" : "text-slate-400"}`}><Wand2 className="h-5 w-5" /><span>Текст</span></button>
            <button type="button" onClick={() => { setActiveTab("book"); setShowAgent(false); setMobilePanel("assistant"); }} className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-1 text-[10px] ${mobilePanel === "assistant" && activeTab === "book" ? "text-emerald-300" : "text-slate-400"}`}><BookMarked className="h-5 w-5" /><span>Книга</span></button>
            <button type="button" onClick={() => { setActiveTab("muse"); setShowAgent(false); setMobilePanel("assistant"); }} className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-1 text-[10px] ${mobilePanel === "assistant" && activeTab === "muse" ? "text-pink-300" : "text-slate-400"}`}><Sparkles className="h-5 w-5" /><span>Муза</span></button>
          </nav>
        </>
      )}

      <React.Suspense fallback={null}>
        <AuthorProfileModal
          open={showAuthorProfile}
          onClose={() => setShowAuthorProfile(false)}
          fallbackStoryId={activeStory?.id}
          selectedModel={selectedModel}
          llmProvider={llmProvider}
          llmApiFields={llmApiFields}
        />
      </React.Suspense>

      {/* LLM API keys settings */}
      {showLlmSettings && (
        <div className="fixed inset-0 z-[80] bg-black/75 backdrop-blur-md flex items-center justify-center p-4" id="llm-settings-modal">
          <div className="bg-gradient-to-b from-[#151c2c] to-[#0f1420] border border-slate-700/80 rounded-2xl w-full max-w-xl shadow-2xl shadow-black/50 max-h-[90vh] overflow-hidden flex flex-col">
            <div className="px-6 py-5 border-b border-slate-800/90 bg-slate-950/40 flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="p-2.5 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-300 shrink-0">
                  <Cpu className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-50 tracking-tight">
                    Ключи API
                  </h2>
                  <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed max-w-md">
                    Вставьте один или несколько ключей ниже. Несколько ключей отделяйте символом <strong className="text-slate-300">;</strong>. В Android APK они хранятся <strong className="text-slate-300">только на этом устройстве в защищённом хранилище</strong> и уходят напрямую выбранному ИИ-провайдеру. Ключи не добавляются в сборку и GitHub.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowLlmSettings(false)}
                className="text-slate-500 hover:text-white hover:bg-slate-800 w-8 h-8 rounded-lg text-lg leading-none cursor-pointer transition-colors"
                aria-label="Закрыть"
              >
                ×
              </button>
            </div>

            <div className="p-5 space-y-3 text-xs overflow-y-auto flex-1">
              {(
                [
                  {
                    key: "gemini" as const,
                    label: "Google Gemini",
                    hint: "Ключ из Google AI Studio",
                    accent: "border-blue-500/25 bg-blue-950/20",
                    badge: "text-blue-300 bg-blue-950/50 border-blue-800/40",
                  },
                  {
                    key: "openrouter" as const,
                    label: "OpenRouter",
                    hint: "Ключ с лимитом расходов",
                    accent: "border-violet-500/25 bg-violet-950/20",
                    badge: "text-violet-300 bg-violet-950/50 border-violet-800/40",
                  },
                  {
                    key: "groq" as const,
                    label: "Groq",
                    hint: "Ключ из Groq Console",
                    accent: "border-emerald-500/25 bg-emerald-950/20",
                    badge: "text-emerald-300 bg-emerald-950/50 border-emerald-800/40",
                  },
                  {
                    key: "nvidia" as const,
                    label: "NVIDIA",
                    hint: "Ключ NVIDIA API",
                    accent: "border-orange-500/25 bg-orange-950/20",
                    badge: "text-orange-300 bg-orange-950/50 border-orange-800/40",
                  },
                ]
              ).map((row) => {
                const keyCount = llmKeysDraft[row.key].split(/[\n,;]/).map((key) => key.trim()).filter(Boolean).length;
                const hasBrowserKey = keyCount > 0;
                return (
                  <div
                    key={row.key}
                    className={`rounded-xl border p-3.5 space-y-2.5 ${row.accent}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <label className="font-semibold text-slate-100 text-[12px]">{row.label}</label>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {hasBrowserKey ? (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-md border border-emerald-700/50 bg-emerald-950/40 text-emerald-300">
                            {keyCount === 1 ? "ключ добавлен" : `ключей: ${keyCount}`}
                          </span>
                        ) : (
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-md border ${row.badge}`}>
                            не добавлен
                          </span>
                        )}
                      </div>
                    </div>
                    <input
                      type="password"
                      autoComplete="off"
                      placeholder={`Ключ или несколько через ; · ${row.hint}`}
                      value={llmKeysDraft[row.key]}
                      onChange={(e) => setLlmKeysDraft((prev) => ({ ...prev, [row.key]: e.target.value }))}
                      className="w-full bg-slate-950/80 border border-slate-700/70 rounded-lg px-3 py-2.5 text-slate-100 outline-none focus:border-amber-500/70 focus:ring-1 focus:ring-amber-500/20 font-mono text-[11px] placeholder:text-slate-600"
                    />
                    <p className="text-[10px] text-slate-500">
                      При одном ключе он используется всегда. При нескольких APK переключится на следующий только при HTTP 402/429 (квота или лимит), но не при 401/404.
                    </p>
                  </div>
                );
              })}

              <div className="rounded-xl border border-blue-500/25 bg-blue-950/20 p-3.5 space-y-2.5">
                <div className="flex items-center justify-between gap-2"><label className="font-semibold text-slate-100 text-[12px]">Gemini для русской прозы</label><span className="text-[9px] px-1.5 py-0.5 rounded-md border border-blue-800/40 bg-blue-950/50 text-blue-200">профиль модели</span></div>
                <select value={geminiModelDraft} onChange={(event) => setGeminiModelDraft(event.target.value)} className="w-full bg-slate-950/80 border border-slate-700/70 rounded-lg px-3 py-2.5 text-slate-100 outline-none focus:border-blue-500/70 focus:ring-1 focus:ring-blue-500/20 text-[11px]" id="gemini-literary-model-select">
                  {GEMINI_LITERARY_MODELS.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
                </select>
                <p className="text-[10px] leading-relaxed text-slate-400">{GEMINI_LITERARY_MODELS.find((model) => model.id === geminiModelDraft)?.description}</p>
              </div>

              <div className="rounded-xl border border-emerald-500/25 bg-emerald-950/20 p-3.5 space-y-2.5">
                <div className="flex items-center justify-between gap-2"><label className="font-semibold text-slate-100 text-[12px]">Groq для русской прозы</label><span className="text-[9px] px-1.5 py-0.5 rounded-md border border-emerald-800/40 bg-emerald-950/50 text-emerald-200">профиль модели</span></div>
                <select value={groqModelDraft} onChange={(event) => setGroqModelDraft(event.target.value)} className="w-full bg-slate-950/80 border border-slate-700/70 rounded-lg px-3 py-2.5 text-slate-100 outline-none focus:border-emerald-500/70 focus:ring-1 focus:ring-emerald-500/20 text-[11px]" id="groq-literary-model-select">
                  {GROQ_LITERARY_MODELS.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
                </select>
                <p className="text-[10px] leading-relaxed text-slate-400">{GROQ_LITERARY_MODELS.find((model) => model.id === groqModelDraft)?.description}</p>
              </div>

              <div className="rounded-xl border border-orange-500/25 bg-orange-950/20 p-3.5 space-y-2.5">
                <div className="flex items-center justify-between gap-2"><label className="font-semibold text-slate-100 text-[12px]">NVIDIA для русской прозы</label><span className="text-[9px] px-1.5 py-0.5 rounded-md border border-orange-800/40 bg-orange-950/50 text-orange-200">профиль модели</span></div>
                <select value={nvidiaModelDraft} onChange={(event) => setNvidiaModelDraft(event.target.value)} className="w-full bg-slate-950/80 border border-slate-700/70 rounded-lg px-3 py-2.5 text-slate-100 outline-none focus:border-orange-500/70 focus:ring-1 focus:ring-orange-500/20 text-[11px]" id="nvidia-literary-model-select">
                  {NVIDIA_LITERARY_MODELS.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
                </select>
                <p className="text-[10px] leading-relaxed text-slate-400">{NVIDIA_LITERARY_MODELS.find((model) => model.id === nvidiaModelDraft)?.description} При ошибке 502/503/504 APK по-прежнему переберёт резервные NVIDIA-модели.</p>
              </div>

              <div className="rounded-xl border border-violet-500/25 bg-violet-950/20 p-3.5 space-y-2.5">
                <div className="flex items-center justify-between gap-2"><label className="font-semibold text-slate-100 text-[12px]">OpenRouter для русской прозы</label><span className="text-[9px] px-1.5 py-0.5 rounded-md border border-violet-800/40 bg-violet-950/50 text-violet-200">профиль модели</span></div>
                <select value={openrouterModelDraft} onChange={(event) => setOpenrouterModelDraft(event.target.value)} className="w-full bg-slate-950/80 border border-slate-700/70 rounded-lg px-3 py-2.5 text-slate-100 outline-none focus:border-violet-500/70 focus:ring-1 focus:ring-violet-500/20 text-[11px]" id="openrouter-literary-model-select">
                  {!OPENROUTER_LITERARY_MODELS.some((model) => model.id === openrouterModelDraft) && <option value={openrouterModelDraft}>Выбрано из каталога: {openrouterModelDraft}</option>}
                  {OPENROUTER_LITERARY_MODELS.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
                </select>
                <p className="text-[10px] leading-relaxed text-slate-400">{OPENROUTER_LITERARY_MODELS.find((model) => model.id === openrouterModelDraft)?.description || "Выбрана модель из актуального каталога OpenRouter."}</p>
                <div className="pt-1 space-y-2">
                  <div className="flex items-center justify-between gap-2"><label htmlFor="openrouter-catalog-search-input" className="text-[10px] font-medium text-violet-100">Актуальный каталог OpenRouter</label><button type="button" onClick={() => void loadOpenrouterCatalog()} disabled={openrouterCatalogState === "loading"} className="text-[10px] text-violet-300 hover:text-violet-100 disabled:opacity-40 underline underline-offset-2">{openrouterCatalogState === "loading" ? "Загрузка…" : "Обновить"}</button></div>
                  <input id="openrouter-catalog-search-input" value={openrouterCatalogQuery} onChange={(event) => setOpenrouterCatalogQuery(event.target.value)} placeholder="Найти модель по названию или ID" className="w-full bg-slate-950/80 border border-slate-700/70 rounded-lg px-3 py-2.5 text-slate-100 placeholder:text-slate-600 outline-none focus:border-violet-500/70 focus:ring-1 focus:ring-violet-500/20 text-[11px]" />
                  {openrouterCatalogState === "error" && <p className="text-[10px] leading-relaxed text-rose-300">{openrouterCatalogError}</p>}
                  {openrouterCatalogState === "ready" && <div className="max-h-44 overflow-y-auto overscroll-contain rounded-lg border border-violet-900/40 bg-slate-950/45 p-1.5 space-y-1">
                    {openrouterCatalog.filter((model) => `${model.name} ${model.id}`.toLowerCase().includes(openrouterCatalogQuery.trim().toLowerCase())).slice(0, 12).map((model) => <button type="button" key={model.id} onClick={() => setOpenrouterModelDraft(model.id)} className={`w-full rounded-md px-2.5 py-2 text-left transition-colors ${openrouterModelDraft === model.id ? "bg-violet-500/20 text-violet-100" : "text-slate-300 hover:bg-violet-500/10"}`}><span className="block text-[10px] font-medium truncate">{model.name || model.id}</span><span className="block mt-0.5 text-[9px] text-slate-500 font-mono truncate">{model.id}{model.contextLength ? ` · ${Math.round(model.contextLength / 1000)}k контекст` : ""}</span></button>)}
                    {!openrouterCatalog.filter((model) => `${model.name} ${model.id}`.toLowerCase().includes(openrouterCatalogQuery.trim().toLowerCase())).length && <p className="px-2 py-2 text-[10px] text-slate-500">Подходящие модели не найдены.</p>}
                  </div>}
                  {openrouterCatalogState === "idle" && <p className="text-[9px] leading-relaxed text-slate-500">Каталог загружается при открытии настроек. DeepSeek V3.2 остаётся первым профилем и значением по умолчанию.</p>}
                </div>
              </div>

              <div className="rounded-xl border border-sky-500/25 bg-sky-950/20 p-3.5 space-y-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div><p className="text-[12px] font-semibold text-slate-100">Проверка доступа OpenRouter</p><p className="mt-0.5 text-[10px] text-slate-400">Ключ не показывается и не сохраняется из этой проверки.</p></div>
                  <button type="button" onClick={checkOpenRouterKey} disabled={openrouterKeyCheck.state === "loading"} className="min-h-10 shrink-0 rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 text-xs font-semibold text-sky-200 disabled:opacity-50">{openrouterKeyCheck.state === "loading" ? "Проверка…" : "Проверить"}</button>
                </div>
                {openrouterKeyCheck.state === "success" && (
                  <div className="rounded-lg border border-emerald-500/25 bg-emerald-950/20 p-2.5 text-[10px] leading-relaxed text-emerald-100">
                    Ключ действителен: <b>{openrouterKeyCheck.label}</b>. Лимит ключа: <b>{openrouterKeyCheck.limit === null ? "не задан" : `$${openrouterKeyCheck.limit}`}</b>; остаток: <b>{openrouterKeyCheck.remaining === null ? "не ограничен" : `$${openrouterKeyCheck.remaining}`}</b>. Тариф без покупок: <b>{openrouterKeyCheck.isFreeTier ? "да" : "нет"}</b>.
                  </div>
                )}
                {openrouterKeyCheck.state === "error" && <div className="rounded-lg border border-red-500/25 bg-red-950/20 p-2.5 text-[10px] leading-relaxed text-red-200">{openrouterKeyCheck.message}</div>}
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950/50 px-3.5 py-3 text-[10px] text-slate-500 leading-relaxed">
                В Android APK ключи хранятся в зашифрованном Android Keystore; они не попадают в Git, GitHub Actions или APK-артефакт.
              </div>
            </div>

            <div className="px-5 py-4 border-t border-slate-800 bg-slate-950/50 flex justify-between gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setLlmKeysDraft({ gemini: "", nvidia: "", groq: "", openrouter: "" });
                }}
                className="px-3 py-2 text-slate-400 hover:text-red-300 text-xs cursor-pointer rounded-lg hover:bg-red-950/20 transition-colors"
              >
                Очистить поля
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowLlmSettings(false)}
                  className="px-3.5 py-2 text-slate-300 hover:text-white text-xs cursor-pointer rounded-lg border border-slate-700 hover:bg-slate-800 transition-colors"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={saveLlmSettings}
                  className="px-5 py-2 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-white text-xs font-semibold rounded-lg cursor-pointer shadow-lg shadow-amber-900/30 transition-all"
                  id="llm-settings-save"
                >
                  Сохранить ключи
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 1: Edit Story Details */}
      {showStoryDetailsModal && activeStory && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-t-2xl sm:rounded-xl max-w-xl w-full p-4 sm:p-5 space-y-4 max-h-[92dvh] flex flex-col overflow-hidden shadow-2xl">
            <h3 className="font-bold text-base text-slate-100 pb-2 border-b border-slate-800 shrink-0 flex items-center gap-2">
              <Settings className="w-4 h-4 text-blue-400" />
              <span>Параметры и материалы книги</span>
            </h3>
            <p className="shrink-0 rounded-lg border border-blue-500/20 bg-blue-950/20 px-3 py-2 text-[11px] leading-relaxed text-slate-300">Вы редактируете материалы книги <strong className="text-blue-200">«{activeStory.title}»</strong>. Сохранение обновляет только её Библию мира и план; главы не меняются, пока вы отдельно не выберете пересоздание.</p>
            
            <form onSubmit={(e) => {
              e.preventDefault();
              handleUpdateStoryMetadata(
                editTitle,
                editGenre,
                editDesc,
                editBookPlan,
                editWorldBible
              );
            }} className="space-y-4 text-xs flex-1 overflow-y-auto pr-1">
              <div>
                <label className="block text-slate-400 mb-1">Название книги</label>
                <input
                  type="text"
                  name="title"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-100 outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Жанр</label>
                <input
                  type="text"
                  name="genre"
                  value={editGenre}
                  onChange={(e) => setEditGenre(e.target.value)}
                  placeholder="Фантастика, Фэнтези, Роман..."
                  className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-100 outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Краткое описание / Синопсис</label>
                <textarea
                  name="desc"
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  rows={2}
                  className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-100 outline-none focus:border-blue-500 font-sans"
                />
              </div>

              {/* Custom Wishes block */}
              <div className="p-3 bg-slate-950 border border-slate-850 rounded-lg space-y-1.5">
                <label className="block text-slate-300 font-bold flex items-center gap-1.5 text-xs">
                  <Wand2 className="w-3.5 h-3.5 text-purple-400 animate-pulse" />
                  <span>Пожелания для ИИ при генерации материалов</span>
                </label>
                <input
                  type="text"
                  value={editCustomPrompt}
                  onChange={(e) => setEditCustomPrompt(e.target.value)}
                  placeholder="Пример: Сделай уклон в киберпанк, добавь 10 глав с неожиданной развязкой..."
                  className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-slate-100 outline-none focus:border-purple-500"
                />
                <span className="text-[10px] text-slate-500 block leading-normal">
                  Эти пожелания будут переданы модели Gemini при генерации сюжета или законов мира ниже.
                </span>
              </div>

              <div className="space-y-2">
                <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <label className="block text-slate-400 font-medium text-purple-400">План сюжета (для генерации глав)</label>
                  <button
                    type="button"
                    disabled={isGeneratingPlan || !editTitle}
                    onClick={handleAIGeneratePlan}
                    className="px-2.5 py-1 bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 hover:text-purple-200 border border-purple-500/30 rounded text-[10px] font-semibold flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
                  >
                    {isGeneratingPlan ? (
                      <>
                        <div className="w-2.5 h-2.5 border-2 border-purple-300 border-t-transparent rounded-full animate-spin" />
                        <span>Генерация...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3 h-3 text-purple-400" />
                        <span>{editBookPlan.trim() ? "Дополнить план с ИИ" : "Сгенерировать план с нуля"}</span>
                      </>
                    )}
                  </button>
                </div>
                <textarea
                  name="bookPlan"
                  value={editBookPlan}
                  onChange={(e) => setEditBookPlan(e.target.value)}
                  placeholder="Загрузите, вставьте или сгенерируйте план развития сюжета по главам..."
                  rows={4}
                  className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-100 outline-none focus:border-purple-500 font-sans text-[11px]"
                />
                <div className="mt-1 rounded-lg border border-red-500/20 bg-red-950/15 p-2">
                  <p className="mb-1.5 text-[10px] leading-relaxed text-slate-400">Пересоздание — отдельное действие: оно удалит текущие главы только после подтверждения.</p>
                  <button
                    type="button"
                    onClick={handleApplyPlanToChapters}
                    className="min-h-10 w-full px-2.5 py-1 bg-red-600/20 hover:bg-red-600/30 text-red-300 border border-red-500/30 rounded text-[10px] font-semibold transition-all cursor-pointer"
                  >
                    Пересоздать главы по этому плану
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <label className="block text-slate-400 font-medium text-blue-400">Библия мира / Сеттинг / Лор</label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={handleLoadLabirint}
                      className="px-2.5 py-1 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 hover:text-emerald-200 border border-emerald-500/30 rounded text-[10px] font-semibold transition-all cursor-pointer"
                    >
                      ↓ Загрузить Лабиринт
                    </button>
                    <button
                      type="button"
                      disabled={isGeneratingBible || !editTitle}
                      onClick={handleAIGenerateBible}
                    className="px-2.5 py-1 bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 hover:text-blue-200 border border-blue-500/30 rounded text-[10px] font-semibold flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
                  >
                    {isGeneratingBible ? (
                      <>
                        <div className="w-2.5 h-2.5 border-2 border-blue-300 border-t-transparent rounded-full animate-spin" />
                        <span>Создание лора...</span>
                      </>
                    ) : (
                      <>
                        <Layers className="w-3 h-3 text-blue-400" />
                        <span>{editWorldBible.trim() ? "Дополнить лор с ИИ" : "Разработать лор с ИИ"}</span>
                      </>
                    )}
                    </button>
                  </div>
                </div>
                <textarea
                  name="worldBible"
                  value={editWorldBible}
                  onChange={(e) => setEditWorldBible(e.target.value)}
                  placeholder="Загрузите, вставьте или сгенерируйте правила и лор вашего мира..."
                  rows={4}
                  className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-100 outline-none focus:border-blue-500 font-sans text-[11px]"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 text-xs sticky bottom-0 bg-slate-900 pb-1">
                <button
                  type="button"
                  onClick={() => setShowStoryDetailsModal(false)}
                  className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded cursor-pointer"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  className="min-h-10 px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded cursor-pointer"
                >
                  Сохранить
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: Create New Book */}
      {showNewStoryModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-150">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-800 bg-slate-950/50 flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-gradient-to-br from-blue-500 to-purple-500 text-white rounded-xl shadow-lg">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-lg text-slate-100">Создать новую книгу</h3>
                  <p className="text-xs text-slate-400">Начните новую историю и загрузите материалы для оценки Музой</p>
                </div>
              </div>
              <button
                onClick={() => {
                  if (!isCreatingStory) {
                    setShowNewStoryModal(false);
                    setNewTitle("");
                    setNewWorldBible("");
                    setNewBookPlan("");
                    setNewBibleFileName("");
                    setNewPlanFileName("");
                  }
                }}
                disabled={isCreatingStory}
                className="text-slate-400 hover:text-slate-200 text-lg p-1 hover:bg-slate-800/50 rounded-lg cursor-pointer transition-colors disabled:opacity-30"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6">
              {isCreatingStory ? (
                <div className="py-16 flex flex-col items-center justify-center space-y-4">
                  <div className="relative">
                    <div className="w-12 h-12 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
                    <Sparkles className="w-6 h-6 text-purple-400 absolute inset-0 m-auto animate-bounce" />
                  </div>
                  <div className="text-center space-y-2">
                    <h4 className="text-base font-bold text-purple-400">Муза погружается в вашу книгу...</h4>
                    <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
                      Мы анализируем вашу новую Библию мира и План сюжета. ИИ сопоставляет правила сеттинга с поглавным развитием истории, ищет логические противоречия и готовит вдохновляющие советы для успешного старта.
                    </p>
                    <span className="text-[10px] text-slate-500 font-mono">Это может занять 10-15 секунд</span>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
                  {/* Left Column: Basic Info */}
                  <div className="space-y-4 flex flex-col">
                    <div className="p-4 bg-slate-950/40 border border-slate-800 rounded-xl space-y-4 flex-1">
                      <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Основная информация</h4>
                      
                      <div>
                        <label className="block text-slate-400 mb-1 font-medium">Название книги</label>
                        <input
                          type="text"
                          value={newTitle}
                          onChange={(e) => setNewTitle(e.target.value)}
                          placeholder="Введите название..."
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-100 outline-none focus:border-blue-500 text-xs"
                        />
                      </div>

                      <div>
                        <label className="block text-slate-400 mb-1 font-medium">Жанр</label>
                        <input
                          type="text"
                          value={newGenre}
                          onChange={(e) => setNewGenre(e.target.value)}
                          placeholder="Например: Фэнтези, Детектив, Роман"
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-100 outline-none focus:border-blue-500 text-xs"
                        />
                      </div>

                      <div>
                        <label className="block text-slate-400 mb-1 font-medium">Краткий синопсис / Идея</label>
                        <textarea
                          value={newDesc}
                          onChange={(e) => setNewDesc(e.target.value)}
                          placeholder="О чем будет книга? Краткое описание поможет Музе лучше ориентироваться."
                          rows={6}
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-100 outline-none focus:border-blue-500 font-sans text-xs resize-none"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Files & Materials */}
                  <div className="space-y-4">
                    <div className="p-4 bg-slate-950/40 border border-slate-800 rounded-xl space-y-4">
                      <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                        <Sparkle className="w-3.5 h-3.5 text-purple-400" />
                        Материалы для ИИ-оценки Музы
                      </h4>

                      {/* World Bible file and text */}
                      <div className="space-y-2">
                        <div className="flex justify-between items-center">
                          <label className="block text-slate-400 font-medium">Библия мира (Сеттинг / Правила лора)</label>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="file"
                            id="new-bible-file"
                            accept=".txt,.docx,.doc"
                            onChange={handleNewBibleFileChange}
                            className="hidden"
                          />
                          <label
                            htmlFor="new-bible-file"
                            className="flex-1 py-1.5 px-3 border border-dashed border-slate-800 hover:border-blue-500/50 bg-slate-950/60 rounded-lg text-slate-400 hover:text-slate-200 cursor-pointer text-center flex items-center justify-center gap-1.5 transition-all"
                          >
                            <Upload className="w-3.5 h-3.5" />
                            <span className="truncate">{newBibleFileName ? `✓ ${newBibleFileName}` : "Загрузить .TXT/.DOCX"}</span>
                          </label>
                          {newBibleFileName && (
                            <button
                              onClick={() => {
                                setNewWorldBible("");
                                setNewBibleFileName("");
                              }}
                              className="text-red-400 hover:text-red-300 px-2 py-1 bg-red-950/20 border border-red-900/30 rounded-lg"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                        <textarea
                          value={newWorldBible}
                          onChange={(e) => setNewWorldBible(e.target.value)}
                          placeholder="Или вставьте правила сеттинга, законы магии, информацию о фракциях сюда..."
                          rows={3}
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-100 outline-none focus:border-blue-500 font-sans text-[11px] resize-none"
                        />
                      </div>

                      {/* Book Plan file and text */}
                      <div className="space-y-2">
                        <div className="flex justify-between items-center">
                          <label className="block text-slate-400 font-medium">План книги (Оглавление / Сюжетные арки)</label>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="file"
                            id="new-plan-file"
                            accept=".txt,.docx,.doc"
                            onChange={handleNewPlanFileChange}
                            className="hidden"
                          />
                          <label
                            htmlFor="new-plan-file"
                            className="flex-1 py-1.5 px-3 border border-dashed border-slate-800 hover:border-purple-500/50 bg-slate-950/60 rounded-lg text-slate-400 hover:text-slate-200 cursor-pointer text-center flex items-center justify-center gap-1.5 transition-all"
                          >
                            <Upload className="w-3.5 h-3.5" />
                            <span className="truncate">{newPlanFileName ? `✓ ${newPlanFileName}` : "Загрузить .TXT/.DOCX"}</span>
                          </label>
                          {newPlanFileName && (
                            <button
                              onClick={() => {
                                setNewBookPlan("");
                                setNewPlanFileName("");
                              }}
                              className="text-red-400 hover:text-red-300 px-2 py-1 bg-red-950/20 border border-red-900/30 rounded-lg"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                        <textarea
                          value={newBookPlan}
                          onChange={(e) => setNewBookPlan(e.target.value)}
                          placeholder="Или вставьте поглавный синопсис, сюжетный набросок, арки героев сюда..."
                          rows={3}
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-100 outline-none focus:border-purple-500 font-sans text-[11px] resize-none"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {creationError && (
                <div className="p-3 bg-red-950/30 border border-red-900/50 text-red-400 rounded-lg mt-4 text-xs">
                  {creationError}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            {!isCreatingStory && (
              <div className="p-4 border-t border-slate-800 bg-slate-950/30 flex justify-end gap-3 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setShowNewStoryModal(false);
                    setNewTitle("");
                    setNewWorldBible("");
                    setNewBookPlan("");
                    setNewBibleFileName("");
                    setNewPlanFileName("");
                  }}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold cursor-pointer transition-colors"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={handleCreateNewStory}
                  disabled={!newTitle.trim()}
                  className="px-5 py-2 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 disabled:opacity-40 text-white text-xs font-bold rounded-xl transition-all shadow-lg flex items-center gap-1.5 cursor-pointer"
                >
                  {(newWorldBible.trim() || newBookPlan.trim()) ? (
                    <>
                      <Sparkles className="w-4 h-4 animate-pulse" />
                      <span>Создать и оценить Музой</span>
                    </>
                  ) : (
                    <span>Создать книгу</span>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL 3: Import TXT/Word/Plan File */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-lg w-full p-5 space-y-4">
            <div className="flex justify-between items-center pb-2 border-b border-slate-800">
              <h3 className="font-bold text-base text-slate-100 flex items-center gap-2">
                <Upload className="w-5 h-5 text-emerald-400" />
                Импорт файлов .TXT / Word (.docx, .doc)
              </h3>
              <button
                onClick={() => {
                  setShowImportModal(false);
                  setImportFileContent("");
                  setImportFileName("");
                  setImportFileTitle("");
                  setParsedResult(null);
                }}
                className="text-slate-400 hover:text-slate-200 text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              Загрузите текстовый файл (.txt) или документ Word (.docx, .doc) с планом вашей книги, деталями персонажей, описанием мира (библией) или готовой главой. Вы сможете выбрать, в какой раздел его сохранить.
            </p>

            {/* Drag & Drop Zone */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-xl p-6 text-center transition-all ${
                isDragging
                  ? "border-emerald-500 bg-[#10b981]/10 text-emerald-300"
                  : importFileContent
                  ? "border-slate-700 bg-slate-950/40 text-slate-300"
                  : "border-slate-800 hover:border-slate-700 bg-slate-950/20 text-slate-400"
              }`}
            >
              <input
                type="file"
                id="file-import-input"
                accept=".txt,.docx,.doc"
                onChange={handleFileChange}
                className="hidden"
              />
              <label htmlFor="file-import-input" className="cursor-pointer block space-y-2">
                <Upload className="w-8 h-8 mx-auto opacity-70" />
                <div className="text-xs font-medium">
                  {importFileName ? (
                    <span className="text-emerald-400 font-semibold">✓ Файл выбран: {importFileName}</span>
                  ) : (
                    <span>Перетащите файл .TXT или .DOCX сюда или <span className="text-blue-400 underline cursor-pointer">выберите на диске</span></span>
                  )}
                </div>
                <div className="text-[10px] text-slate-500">Поддерживаются файлы TXT, DOCX и DOC любого размера</div>
              </label>
            </div>

            {importFileContent && (
              <div className="space-y-3.5 text-xs">
                {/* Destination Selector */}
                <div>
                  <label className="block text-slate-400 mb-1.5 font-medium">Куда импортировать данные?</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setImportTarget("chapter")}
                      className={`p-2 rounded-lg border text-left transition-all cursor-pointer ${
                        importTarget === "chapter"
                          ? "border-emerald-500 bg-emerald-500/10 text-emerald-300"
                          : "border-slate-800 bg-slate-950/40 text-slate-400 hover:text-slate-300"
                      }`}
                    >
                      <div className="font-bold">Новая глава</div>
                      <div className="text-[10px] opacity-70">Создать новую главу</div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setImportTarget("currentChapter")}
                      className={`p-2 rounded-lg border text-left transition-all cursor-pointer ${
                        importTarget === "currentChapter"
                          ? "border-emerald-500 bg-emerald-500/10 text-emerald-300"
                          : "border-slate-800 bg-slate-950/40 text-slate-400 hover:text-slate-300"
                      }`}
                    >
                      <div className="font-bold">В текущую главу</div>
                      <div className="text-[10px] opacity-70">Дописать в конец активной</div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setImportTarget("worldRule")}
                      className={`p-2 rounded-lg border text-left transition-all cursor-pointer ${
                        importTarget === "worldRule"
                          ? "border-emerald-500 bg-emerald-500/10 text-emerald-300"
                          : "border-slate-800 bg-slate-950/40 text-slate-400 hover:text-slate-300"
                      }`}
                    >
                      <div className="font-bold">Лор / Правило мира</div>
                      <div className="text-[10px] opacity-70">Добавить в Библию мира</div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setImportTarget("character")}
                      className={`p-2 rounded-lg border text-left transition-all cursor-pointer ${
                        importTarget === "character"
                          ? "border-emerald-500 bg-emerald-500/10 text-emerald-300"
                          : "border-slate-800 bg-slate-950/40 text-slate-400 hover:text-slate-300"
                      }`}
                    >
                      <div className="font-bold">Персонаж</div>
                      <div className="text-[10px] opacity-70">Новый герой с описанием</div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setImportTarget("bookPlan")}
                      className={`p-2 rounded-lg border text-left transition-all cursor-pointer ${
                        importTarget === "bookPlan"
                          ? "border-emerald-500 bg-emerald-500/10 text-emerald-300"
                          : "border-slate-800 bg-slate-950/40 text-slate-400 hover:text-slate-300"
                      }`}
                    >
                      <div className="font-bold">План сюжета (Книги)</div>
                      <div className="text-[10px] opacity-70">Импортировать в план книги</div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setImportTarget("worldBible")}
                      className={`p-2 rounded-lg border text-left transition-all cursor-pointer ${
                        importTarget === "worldBible"
                          ? "border-emerald-500 bg-emerald-500/10 text-emerald-300"
                          : "border-slate-800 bg-slate-950/40 text-slate-400 hover:text-slate-300"
                      }`}
                    >
                      <div className="font-bold">Библия мира / Лор</div>
                      <div className="text-[10px] opacity-70">Импортировать в Библию мира</div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setImportTarget("auto")}
                      className={`p-2 rounded-lg border text-left transition-all cursor-pointer col-span-2 ${
                        importTarget === "auto"
                          ? "border-purple-500 bg-purple-500/10 text-purple-300"
                          : "border-slate-800 bg-slate-950/40 text-slate-400 hover:text-slate-300"
                      }`}
                    >
                      <div className="font-bold flex items-center gap-1">
                        <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                        Умное ИИ-распределение
                      </div>
                      <div className="text-[10px] opacity-70">Автоматически разобрать файл на главы, персонажей и лор</div>
                    </button>
                  </div>
                </div>

                {/* Name / Title */}
                {importTarget !== "currentChapter" && importTarget !== "auto" && importTarget !== "bookPlan" && importTarget !== "worldBible" && (
                  <div>
                    <label className="block text-slate-400 mb-1 font-medium">
                      {importTarget === "character" ? "Имя персонажа" : "Название элемента"}
                    </label>
                    <input
                      type="text"
                      value={importFileTitle}
                      onChange={(e) => setImportFileTitle(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-100 outline-none focus:border-blue-500"
                    />
                  </div>
                )}

                {/* AI Automatic parsing container */}
                {importTarget === "auto" && (
                  <div className="bg-slate-950/60 p-3 rounded-lg border border-purple-900/40 space-y-3">
                    <div className="flex items-center gap-2 text-purple-400 font-medium text-xs">
                      <Sparkles className="w-4 h-4" />
                      <span>Умный анализ и авто-разделение ИИ</span>
                    </div>

                    {!parsedResult && !isParsingFile && (
                      <div className="space-y-2">
                        <p className="text-[11px] text-slate-400 leading-normal">
                          ИИ автоматически просканирует весь текст, найдет в нем новые главы, детальные описания героев и лор вселенной, и мгновенно распределит их по соответствующим разделам приложения.
                        </p>
                        <button
                          type="button"
                          onClick={handleAIParseFile}
                          className="w-full py-2 bg-purple-600 hover:bg-purple-500 text-white font-medium rounded-lg transition-all cursor-pointer flex items-center justify-center gap-2"
                        >
                          <Wand2 className="w-4 h-4" />
                          Начать ИИ-анализ файла
                        </button>
                      </div>
                    )}

                    {isParsingFile && (
                      <div className="py-4 text-center space-y-2 animate-pulse">
                        <div className="inline-block w-6 h-6 border-2 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
                        <p className="text-[11px] text-purple-400 font-medium">
                          Анализируем рукопись... Выделяем главы, персонажей и лор...
                        </p>
                      </div>
                    )}

                    {parsedResult && (
                      <div className="space-y-3">
                        <div className="text-[11px] text-emerald-400 font-semibold flex items-center gap-1">
                          ✓ Анализ завершен! Найдено элементов:
                        </div>
                        
                        <div className="grid grid-cols-3 gap-2 text-[10px]">
                          <div className="bg-slate-900 p-2 rounded border border-slate-800">
                            <div className="font-bold text-slate-300">Главы ({parsedResult.chapters.length})</div>
                            <div className="text-[9px] text-slate-500 mt-1 max-h-16 overflow-y-auto space-y-0.5">
                              {parsedResult.chapters.map((ch, i) => (
                                <div key={i} className="truncate">• {ch.title}</div>
                              ))}
                              {parsedResult.chapters.length === 0 && <div className="italic">Не найдено</div>}
                            </div>
                          </div>

                          <div className="bg-slate-900 p-2 rounded border border-slate-800">
                            <div className="font-bold text-slate-300">Персонажи ({parsedResult.characters.length})</div>
                            <div className="text-[9px] text-slate-500 mt-1 max-h-16 overflow-y-auto space-y-0.5">
                              {parsedResult.characters.map((ch, i) => (
                                <div key={i} className="truncate">• {ch.name}</div>
                              ))}
                              {parsedResult.characters.length === 0 && <div className="italic">Не найдено</div>}
                            </div>
                          </div>

                          <div className="bg-slate-900 p-2 rounded border border-slate-800">
                            <div className="font-bold text-slate-300">Лор мира ({parsedResult.worldRules.length})</div>
                            <div className="text-[9px] text-slate-500 mt-1 max-h-16 overflow-y-auto space-y-0.5">
                              {parsedResult.worldRules.map((r, i) => (
                                <div key={i} className="truncate">• {r.title}</div>
                              ))}
                              {parsedResult.worldRules.length === 0 && <div className="italic">Не найдено</div>}
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={handleAIParseFile}
                          className="w-full py-1 text-[10px] text-slate-400 hover:text-slate-300 underline text-center cursor-pointer"
                        >
                          Запустить анализ заново
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Text preview */}
                <div>
                  <label className="block text-slate-400 mb-1 font-medium">Предпросмотр контента</label>
                  <div className="bg-slate-950 border border-slate-800 rounded p-2 text-slate-300 max-h-24 overflow-y-auto font-mono text-[11px] leading-relaxed select-none">
                    {importFileContent.length > 500
                      ? importFileContent.substring(0, 500) + "..."
                      : importFileContent}
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 text-xs">
              <button
                type="button"
                onClick={() => {
                  setShowImportModal(false);
                  setImportFileContent("");
                  setImportFileName("");
                  setImportFileTitle("");
                  setParsedResult(null);
                }}
                className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded cursor-pointer"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={handleExecuteImport}
                disabled={!importFileContent.trim() || (importTarget === "auto" && !parsedResult) || isParsingFile}
                className={`px-4 py-1.5 disabled:opacity-50 text-white font-medium rounded cursor-pointer flex items-center gap-1.5 transition-all ${
                  importTarget === "auto"
                    ? "bg-purple-600 hover:bg-purple-500"
                    : "bg-emerald-600 hover:bg-emerald-500"
                }`}
              >
                <span>
                  {importTarget === "auto" ? "Интегрировать ИИ данные" : "Импортировать"}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Celebration Publish Success Modal */}
      {showPublishSuccessModal && publishedChapterDetails && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center z-50 p-4 transition-all animate-fade-in" id="publish-success-modal">
          <div className="bg-[#0e1424] border border-emerald-500/30 rounded-2xl p-6 max-w-md w-full shadow-2xl relative overflow-hidden space-y-4">
            
            {/* Elegant light ray backdrops */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

            <div className="text-center space-y-3 relative z-10">
              <div className="w-16 h-16 bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 rounded-full flex items-center justify-center mx-auto shadow-lg shadow-emerald-500/5 animate-bounce">
                <Globe className="w-8 h-8" />
              </div>
              
              <h3 className="text-xl font-extrabold text-white tracking-tight">
                Глава успешно опубликована! 🎉
              </h3>
              
              <p className="text-xs text-slate-300 leading-relaxed px-2">
                Поздравляем автора! Ваша глава <strong className="text-emerald-400">«{publishedChapterDetails.title}»</strong> ({publishedChapterDetails.wordCount} слов) успешно подготовлена к выпуску и опубликована на нашей самиздат-платформе.
              </p>
            </div>

            {/* Word count target check */}
            <div className="bg-slate-950/60 rounded-xl p-3 border border-slate-800 space-y-2 relative z-10">
              <div className="flex justify-between items-center text-xs text-slate-400">
                <span>Объём главы</span>
                <span className="font-semibold font-mono text-slate-200">
                  {publishedChapterDetails.wordCount} / 1500 слов
                </span>
              </div>
              <div className="w-full bg-slate-900 h-2 rounded-full overflow-hidden">
                <div 
                  className={`h-full rounded-full transition-all duration-500 ${
                    publishedChapterDetails.wordCount >= 1500 ? "bg-emerald-500" : "bg-amber-500"
                  }`} 
                  style={{ width: `${Math.min(100, (publishedChapterDetails.wordCount / 1500) * 100)}%` }}
                />
              </div>
              {publishedChapterDetails.wordCount >= 1500 ? (
                <p className="text-[10px] text-emerald-400 flex items-center gap-1">
                  <Check className="w-3.5 h-3.5" /> Отличная работа! Целевой объём в 1500 слов выполнен.
                </p>
              ) : (
                <p className="text-[10px] text-amber-400 leading-normal">
                  ⚠ Рекомендуемый объем главы 1500 слов. Вы можете продолжить расширять главу с Музой для идеального баланса сюжета.
                </p>
              )}
            </div>

            <div className="flex justify-center pt-2 relative z-10">
              <button
                onClick={() => setShowPublishSuccessModal(false)}
                className="w-full py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold rounded-xl transition-all cursor-pointer shadow-lg shadow-emerald-500/10 active:scale-98 text-xs"
              >
                Вернуться к творчеству
              </button>
            </div>
          </div>
        </div>
      )}
      {/* LLM Activity Log — всплывающая панель событий фейловера/ротации */}
      {showLlmLog && (
        <div
          style={{
            position: "fixed",
            bottom: "16px",
            right: "16px",
            zIndex: 9999,
            width: "360px",
            maxWidth: "calc(100vw - 32px)",
            background: "rgba(10, 14, 28, 0.96)",
            border: "1px solid rgba(99, 102, 241, 0.3)",
            borderRadius: "12px",
            boxShadow: "0 8px 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(99,102,241,0.1)",
            backdropFilter: "blur(12px)",
            overflow: "hidden",
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "8px 12px",
              borderBottom: "1px solid rgba(99,102,241,0.15)",
              cursor: "pointer",
              background: "rgba(99,102,241,0.08)",
            }}
            onClick={() => setLlmLogCollapsed((v) => !v)}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ display: "inline-block", width: "7px", height: "7px", borderRadius: "50%", background: "#818cf8", boxShadow: "0 0 6px #818cf8", animation: "pulse 1.5s ease-in-out infinite" }} />
              <span style={{ fontSize: "11px", fontWeight: 600, color: "#a5b4fc", letterSpacing: "0.05em", textTransform: "uppercase" }}>LLM Activity</span>
            </div>
            <div style={{ display: "flex", gap: "4px" }}>
              <button
                onClick={(e) => { e.stopPropagation(); void copyLlmLog(); }}
                disabled={!llmLogs.length}
                style={{ background: "none", border: "none", cursor: llmLogs.length ? "pointer" : "default", color: llmLogCopied ? "#34d399" : "#64748b", padding: "2px 4px", borderRadius: "4px", fontSize: "12px", opacity: llmLogs.length ? 1 : 0.4 }}
                title="Копировать журнал"
              >{llmLogCopied ? "✓" : "⧉"}</button>
              <button
                onClick={(e) => { e.stopPropagation(); setLlmLogCollapsed((v) => !v); }}
                style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b", padding: "2px 4px", borderRadius: "4px", fontSize: "12px" }}
                title={llmLogCollapsed ? "Развернуть" : "Свернуть"}
              >{llmLogCollapsed ? "▲" : "▼"}</button>
              <button
                onClick={(e) => { e.stopPropagation(); setShowLlmLog(false); }}
                style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b", padding: "2px 4px", borderRadius: "4px", fontSize: "12px" }}
                title="Закрыть"
              >✕</button>
            </div>
          </div>
          {/* Log entries */}
          {!llmLogCollapsed && (
            <div style={{ maxHeight: "220px", overflowY: "auto", padding: "8px 4px" }}>
              {llmLogs.map((entry, i) => {
                const color = entry.level === "error" ? "#f87171" : entry.level === "warn" ? "#fbbf24" : entry.level === "success" ? "#34d399" : "#94a3b8";
                const providerColors: Record<string, string> = { gemini: "#60a5fa", nvidia: "#4ade80", groq: "#fb923c", openrouter: "#e879f9" };
                const provColor = entry.provider ? (providerColors[entry.provider] || "#94a3b8") : "transparent";
                const time = new Date(entry.ts).toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
                return (
                  <div key={i} style={{ display: "flex", gap: "6px", alignItems: "baseline", padding: "3px 8px", borderRadius: "6px", background: i % 2 === 0 ? "rgba(255,255,255,0.02)" : "transparent" }}>
                    <span style={{ fontSize: "9px", color: "#475569", flexShrink: 0, fontFamily: "monospace", lineHeight: "1.8" }}>{time}</span>
                    {entry.provider && (
                      <span style={{ fontSize: "9px", fontWeight: 700, color: provColor, flexShrink: 0, textTransform: "uppercase", lineHeight: "1.8", letterSpacing: "0.04em" }}>{entry.provider}</span>
                    )}
                    <span style={{ fontSize: "11px", color, lineHeight: "1.5", wordBreak: "break-word" }}>{entry.message}</span>
                  </div>
                );
              })}
              <div ref={llmLogEndRef} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
