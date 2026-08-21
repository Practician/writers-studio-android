import React, { useState, useRef, useEffect } from "react";
import { Send, Sparkles, Trash2, HelpCircle, Upload, FileText, Sparkle, BookOpen, Check, Copy } from "lucide-react";
import ReactMarkdown from "react-markdown";
import mammoth from "mammoth";
import { ChatMessage, Story } from "../types";

interface MuseChatProps {
  story: Story;
  currentDraft: string;
  selectedModel?: string;
  llmProvider?: "auto" | "gemini" | "nvidia" | "groq" | "openrouter";
  llmApiFields?: Record<string, unknown>;
}

export default function MuseChat({ story, currentDraft, selectedModel, llmProvider = "auto", llmApiFields }: MuseChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Evaluation States
  const [showEvalModal, setShowEvalModal] = useState(false);
  const [worldBibleText, setWorldBibleText] = useState("");
  const [bookPlanText, setBookPlanText] = useState("");
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [evaluationResult, setEvaluationResult] = useState("");
  const [evalError, setEvalError] = useState<string | null>(null);
  
  const [bibleFileName, setBibleFileName] = useState("");
  const [planFileName, setPlanFileName] = useState("");
  const [copied, setCopied] = useState(false);

  // Auto-fill World Bible from current Story lore
  const handleAutoFillWorldBible = () => {
    if (story.worldRules && story.worldRules.length > 0) {
      const compiled = story.worldRules
        .map((r, i) => `=== ${r.title} ===\n${r.content}`)
        .join("\n\n");
      setWorldBibleText(compiled);
      setBibleFileName("Внутренний Лор Студии");
    } else {
      alert("У вас пока нет сохраненных правил лора во вкладке «Лор»! Напишите или загрузите лор из файла.");
    }
  };

  // Auto-fill Book Plan from chapter list
  const handleAutoFillBookPlan = () => {
    let compiled = `Краткое описание: ${story.description || "Не указано"}\n\n`;
    if (story.chapters && story.chapters.length > 0) {
      compiled += "Поглавный план / Синопсисы:\n";
      story.chapters.forEach((ch, idx) => {
        compiled += `\nГлава ${idx + 1}: ${ch.title}\nСинопсис: ${ch.summary || "Без описания"}\n`;
      });
      setBookPlanText(compiled);
      setPlanFileName("Внутренний План Студии");
    } else {
      setBookPlanText(compiled);
      setPlanFileName("Описание Книги");
    }
  };

  // Parse word/txt for World Bible
  const handleBibleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBibleFileName(file.name);
    
    if (file.name.endsWith(".docx") || file.name.endsWith(".doc")) {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const arrayBuffer = event.target?.result as ArrayBuffer;
        try {
          const result = await mammoth.extractRawText({ arrayBuffer });
          setWorldBibleText(result.value);
        } catch (err) {
          alert("Ошибка при чтении Word файла.");
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = (event) => {
        setWorldBibleText(event.target?.result as string);
      };
      reader.readAsText(file);
    }
  };

  // Parse word/txt for Book Plan
  const handlePlanFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPlanFileName(file.name);
    
    if (file.name.endsWith(".docx") || file.name.endsWith(".doc")) {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const arrayBuffer = event.target?.result as ArrayBuffer;
        try {
          const result = await mammoth.extractRawText({ arrayBuffer });
          setBookPlanText(result.value);
        } catch (err) {
          alert("Ошибка при чтении Word файла.");
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = (event) => {
        setBookPlanText(event.target?.result as string);
      };
      reader.readAsText(file);
    }
  };

  // Trigger evaluation request
  const handleEvaluateIdea = async () => {
    if (!worldBibleText.trim() && !bookPlanText.trim()) {
      setEvalError("Пожалуйста, заполните хотя бы одно поле (Библию мира или План книги) для оценки.");
      return;
    }
    
    setIsEvaluating(true);
    setEvalError(null);
    setEvaluationResult("");
    
    try {
      const response = await fetch("/api/writer/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "evaluate_idea",
          title: story.title,
          genre: story.genre,
          description: story.description,
          worldBible: worldBibleText,
          bookPlan: bookPlanText,
          ...(llmApiFields || { model: selectedModel, llmProvider }),
        }),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Ошибка при получении ответа от Музы.");
      }
      
      const data = await response.json();
      setEvaluationResult(data.result);
    } catch (err: any) {
      setEvalError(err.message || "Не удалось получить оценку идеи.");
    } finally {
      setIsEvaluating(false);
    }
  };

  // Copy evaluation text
  const handleCopyEvalResult = () => {
    navigator.clipboard.writeText(evaluationResult);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Add the evaluation result report into chat messages
  const handleAddReportToChat = () => {
    if (!evaluationResult) return;
    
    const userMsg: ChatMessage = {
      id: "eval-user-" + Math.random().toString(36).substr(2, 9),
      role: "user",
      content: `🔮 Муза, оцени мою идею по плану и библии мира, которые я подготовил!`,
      timestamp: Date.now()
    };
    
    const assistantMsg: ChatMessage = {
      id: "eval-asst-" + Math.random().toString(36).substr(2, 9),
      role: "assistant",
      content: `Конечно! Я внимательно изучила Библию мира и План сюжета для твоей книги **«${story.title}»**. Вот мой подробный литературный анализ:\n\n${evaluationResult}`,
      timestamp: Date.now() + 100
    };
    
    const updated = [...messages, userMsg, assistantMsg];
    setMessages(updated);
    saveMessages(updated);
    
    // Reset and close modal
    setShowEvalModal(false);
    setWorldBibleText("");
    setBookPlanText("");
    setBibleFileName("");
    setPlanFileName("");
    setEvaluationResult("");
  };

  // Load chat history from localStorage specific to this story
  useEffect(() => {
    const saved = localStorage.getItem(`muse_chat_${story.id}`);
    if (saved) {
      try {
        setMessages(JSON.parse(saved));
      } catch (e) {
        setMessages([]);
      }
    } else {
      // Welcome message
      const welcomeMessage: ChatMessage = {
        id: "welcome",
        role: "assistant",
        content: `Привет, создатель! Я твоя **Муза** — твой творческий напарник. 🌟\n\nЯ полностью погружена в твою историю **«${story.title}»**. \n\nТы можешь спросить меня о чем угодно:\n* «Как развить интригу в этой главе?»\n* «Помоги придумать неожиданный поворот событий.»\n* «Оцени диалог и сделай его живее.»\n\nО чем мы поговорим сегодня?`,
        timestamp: Date.now(),
      };
      setMessages([welcomeMessage]);
    }
  }, [story.id, story.title]);

  // Save chat history
  const saveMessages = (msgs: ChatMessage[]) => {
    setMessages(msgs);
    localStorage.setItem(`muse_chat_${story.id}`, JSON.stringify(msgs));
  };

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const handleSend = async (customText?: string) => {
    const messageText = customText || input;
    if (!messageText.trim() || loading) return;

    if (!customText) {
      setInput("");
    }
    setError(null);

    const userMessage: ChatMessage = {
      id: Math.random().toString(),
      role: "user",
      content: messageText,
      timestamp: Date.now(),
    };

    const updatedMessages = [...messages, userMessage];
    saveMessages(updatedMessages);
    setLoading(true);

    try {
      const response = await fetch("/api/muse/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: story.title,
          description: story.description,
          currentDraft: currentDraft,
          history: updatedMessages.slice(-8), // Send last 8 messages for context
          customPrompt: messageText,
          ...(llmApiFields || { model: selectedModel, llmProvider }),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Ошибка при получении ответа от ИИ.");
      }

      if (!response.body) throw new Error("No response body");

      const assistantMessageId = Math.random().toString();
      let assistantContent = "";
      
      const assistantMessage: ChatMessage = {
        id: assistantMessageId,
        role: "assistant",
        content: assistantContent,
        timestamp: Date.now(),
      };
      
      const currentMessages = [...updatedMessages, assistantMessage];
      saveMessages(currentMessages);
      setLoading(false); // Can stop loading spinner once stream starts

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      let buffer = "";

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) {
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          // Keep the last incomplete line in the buffer
          buffer = lines.pop() || "";
          
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const dataStr = line.slice(6);
              if (dataStr === "[DONE]") break;
              try {
                const data = JSON.parse(dataStr);
                if (data.error) throw new Error(data.error);
                if (data.text) {
                  assistantContent += data.text;
                  setMessages((prev) => 
                    prev.map(m => m.id === assistantMessageId ? { ...m, content: assistantContent } : m)
                  );
                }
              } catch (e) {
                // Ignore parse errors for incomplete JSON
              }
            }
          }
        }
      }
      
      // Save final message state to localStorage
      saveMessages(currentMessages.map(m => m.id === assistantMessageId ? { ...m, content: assistantContent } : m));
      
    } catch (err: any) {
      setError(err.message || "Не удалось отправить сообщение.");
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    const welcomeMessage: ChatMessage = {
      id: "welcome",
      role: "assistant",
      content: `История очищена. Я готова к новым обсуждениям по сюжету **«${story.title}»**! Задавай любой вопрос. ✨`,
      timestamp: Date.now(),
    };
    saveMessages([welcomeMessage]);
  };

  const suggestionChips = [
    "Что добавить в эту сцену?",
    "Придумай конфликт персонажей",
    "Напиши 3 идеи для клиффхэнгера",
    "Как сделать диалог более напряженным?",
  ];

  return (
    <div className="flex flex-col h-full bg-slate-900/50 border border-slate-800 rounded-xl overflow-hidden relative" id="muse-chat-container">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-slate-800 bg-slate-950/40">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-blue-600/20 text-blue-400 rounded-lg">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-semibold text-sm text-slate-100">Разговор с Музой</h3>
            <p className="text-xs text-slate-400">Твой интерактивный соавтор</p>
          </div>
        </div>
        <button
          onClick={handleClear}
          title="Очистить диалог"
          className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-800/60 rounded-lg transition-colors cursor-pointer"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* Evaluate Book Idea Banner */}
      <div className="bg-gradient-to-r from-blue-900/40 via-purple-900/40 to-slate-900 border-b border-slate-800 p-2.5 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-gradient-to-r from-blue-500 to-purple-500 text-white rounded-lg animate-pulse shrink-0">
            <Sparkles className="w-3.5 h-3.5" />
          </div>
          <div className="min-w-0">
            <h4 className="text-xs font-bold text-slate-200">Оценка идеи от Музы</h4>
            <p className="text-[10px] text-slate-400 truncate">Загрузите лор и план книги</p>
          </div>
        </div>
        <button
          onClick={() => setShowEvalModal(true)}
          className="px-2.5 py-1 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white text-[10px] font-bold rounded-lg transition-all shadow-md cursor-pointer flex items-center gap-1 shrink-0"
        >
          <span>Оценить идею</span>
        </button>
      </div>

      {/* Message List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4" id="chat-messages-scroll">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${
                msg.role === "user"
                  ? "bg-blue-600 text-white rounded-br-none"
                  : "bg-slate-800/80 text-slate-100 border border-slate-700/50 rounded-bl-none"
              }`}
            >
              <div className="markdown-body">
                <ReactMarkdown>{msg.content}</ReactMarkdown>
              </div>
              <span className="text-[10px] text-slate-400/80 block text-right mt-1.5">
                {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-slate-800/80 text-slate-100 border border-slate-700/50 rounded-2xl rounded-bl-none px-4 py-3 text-sm flex items-center gap-2">
              <span className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
              <span className="text-xs text-slate-400 ml-1">Муза подбирает слова...</span>
            </div>
          </div>
        )}

        {error && (
          <div className="p-3 bg-red-950/30 border border-red-900/50 text-red-400 rounded-lg text-xs">
            {error}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Quick Suggestions */}
      <div className="px-3 pb-1 pt-2 border-t border-slate-800 bg-slate-950/20">
        <div className="flex gap-1.5 overflow-x-auto pb-1.5 whitespace-nowrap scrollbar-thin">
          {suggestionChips.map((chip, idx) => (
            <button
              key={idx}
              onClick={() => handleSend(chip)}
              disabled={loading}
              className="px-2.5 py-1 text-xs bg-slate-800/60 hover:bg-slate-700/80 border border-slate-700/30 text-slate-300 rounded-full cursor-pointer transition-colors disabled:opacity-50"
            >
              {chip}
            </button>
          ))}
        </div>
      </div>

      {/* Input Box */}
      <div className="p-3 bg-slate-950/40 border-t border-slate-800 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder="Спроси Музу или обсуди сюжет..."
          disabled={loading}
          className="flex-1 bg-slate-800/80 border border-slate-700 hover:border-slate-600 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none rounded-lg px-3 py-2 text-sm text-slate-100 transition-all disabled:opacity-50"
        />
        <button
          onClick={() => handleSend()}
          disabled={!input.trim() || loading}
          className="p-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 text-white rounded-lg transition-colors cursor-pointer flex items-center justify-center"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>

      {/* Evaluation Modal */}
      {showEvalModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-800 bg-slate-950/50 flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-gradient-to-br from-blue-500 to-purple-500 text-white rounded-xl shadow-lg">
                  <Sparkles className="w-5 h-5 animate-pulse" />
                </div>
                <div>
                  <h3 className="font-bold text-lg text-slate-100">Глубокая ИИ-оценка идеи книги Музой</h3>
                  <p className="text-xs text-slate-400">Предоставьте Музе сеттинг (Библию мира) и план сюжета для анализа</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowEvalModal(false);
                  setEvaluationResult("");
                  setEvalError(null);
                }}
                className="text-slate-400 hover:text-slate-200 text-lg p-1 hover:bg-slate-800/50 rounded-lg cursor-pointer transition-colors"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {evaluationResult ? (
                /* RESULTS VIEW */
                <div className="space-y-4">
                  <div className="p-4 bg-emerald-950/20 border border-emerald-900/40 rounded-xl text-emerald-400 text-xs flex gap-2 items-center">
                    <Check className="w-4 h-4 shrink-0" />
                    <span>Муза завершила свой детальный разбор! Вы можете скопировать отчет или перенести его в историю вашего чата.</span>
                  </div>

                  <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-5 overflow-y-auto max-h-[50vh] text-slate-100 text-sm leading-relaxed scrollbar-thin">
                    <div className="markdown-body">
                      <ReactMarkdown>{evaluationResult}</ReactMarkdown>
                    </div>
                  </div>

                  <div className="flex justify-end gap-3 pt-2">
                    <button
                      onClick={handleCopyEvalResult}
                      className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold cursor-pointer transition-colors flex items-center gap-1.5"
                    >
                      {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                      <span>{copied ? "Скопировано!" : "Скопировать отчет"}</span>
                    </button>
                    <button
                      onClick={handleAddReportToChat}
                      className="px-5 py-2 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white rounded-lg text-xs font-bold cursor-pointer transition-all flex items-center gap-1.5 shadow-lg"
                    >
                      <Sparkles className="w-4 h-4" />
                      <span>Обсудить отчет в чате с Музой</span>
                    </button>
                  </div>
                </div>
              ) : (
                /* UPLOADS & INPUT VIEW */
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Left Column: World Bible */}
                  <div className="space-y-3 flex flex-col h-full">
                    <div className="flex justify-between items-center">
                      <label className="text-sm font-bold text-slate-200 flex items-center gap-1.5">
                        <BookOpen className="w-4 h-4 text-blue-400" />
                        Библия мира (Сеттинг / Лор)
                      </label>
                      <button
                        onClick={handleAutoFillWorldBible}
                        className="text-[10px] text-blue-400 hover:text-blue-300 underline cursor-pointer"
                        title="Собрать все записи из вкладки «Лор»"
                      >
                        Заполнить из Студии (Лор)
                      </button>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-normal">
                      Опишите географию вашего мира, законы магии, социальные касты, историю или технологии.
                    </p>

                    {/* File upload button */}
                    <div className="flex items-center gap-2">
                      <input
                        type="file"
                        id="eval-bible-file"
                        accept=".txt,.docx,.doc"
                        onChange={handleBibleFileChange}
                        className="hidden"
                      />
                      <label
                        htmlFor="eval-bible-file"
                        className="flex-1 py-2 px-3 border border-dashed border-slate-700 hover:border-blue-500/50 bg-slate-950/40 rounded-lg text-xs text-slate-400 hover:text-slate-200 cursor-pointer text-center flex items-center justify-center gap-1.5 transition-all"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        <span>{bibleFileName ? `✓ ${bibleFileName}` : "Загрузить .TXT / .DOCX"}</span>
                      </label>
                      {bibleFileName && (
                        <button
                          onClick={() => {
                            setWorldBibleText("");
                            setBibleFileName("");
                          }}
                          className="text-xs text-red-400 hover:text-red-300 px-2 py-2 bg-red-950/30 hover:bg-red-950/50 border border-red-900/30 rounded-lg"
                        >
                          Сбросить
                        </button>
                      )}
                    </div>

                    <textarea
                      value={worldBibleText}
                      onChange={(e) => setWorldBibleText(e.target.value)}
                      placeholder="Вставьте правила вашего мира или его историю сюда..."
                      rows={8}
                      className="w-full bg-slate-950/60 border border-slate-800 rounded-xl p-3 text-slate-100 text-xs outline-none focus:border-blue-500 font-sans resize-none flex-1"
                    />
                  </div>

                  {/* Right Column: Book Plan */}
                  <div className="space-y-3 flex flex-col h-full">
                    <div className="flex justify-between items-center">
                      <label className="text-sm font-bold text-slate-200 flex items-center gap-1.5">
                        <FileText className="w-4 h-4 text-purple-400" />
                        План книги (Сюжет / Оглавление)
                      </label>
                      <button
                        onClick={handleAutoFillBookPlan}
                        className="text-[10px] text-purple-400 hover:text-purple-300 underline cursor-pointer"
                        title="Собрать синопсисы глав вашей книги"
                      >
                        Заполнить из Студии (План)
                      </button>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-normal">
                      Опишите синопсис, основные конфликты, поглавную структуру, арки героев или кульминацию.
                    </p>

                    {/* File upload button */}
                    <div className="flex items-center gap-2">
                      <input
                        type="file"
                        id="eval-plan-file"
                        accept=".txt,.docx,.doc"
                        onChange={handlePlanFileChange}
                        className="hidden"
                      />
                      <label
                        htmlFor="eval-plan-file"
                        className="flex-1 py-2 px-3 border border-dashed border-slate-700 hover:border-purple-500/50 bg-slate-950/40 rounded-lg text-xs text-slate-400 hover:text-slate-200 cursor-pointer text-center flex items-center justify-center gap-1.5 transition-all"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        <span>{planFileName ? `✓ ${planFileName}` : "Загрузить .TXT / .DOCX"}</span>
                      </label>
                      {planFileName && (
                        <button
                          onClick={() => {
                            setBookPlanText("");
                            setPlanFileName("");
                          }}
                          className="text-xs text-red-400 hover:text-red-300 px-2 py-2 bg-red-950/30 hover:bg-red-950/50 border border-red-900/30 rounded-lg"
                        >
                          Сбросить
                        </button>
                      )}
                    </div>

                    <textarea
                      value={bookPlanText}
                      onChange={(e) => setBookPlanText(e.target.value)}
                      placeholder="Вставьте синопсис, план по главам или сюжетный набросок сюда..."
                      rows={8}
                      className="w-full bg-slate-950/60 border border-slate-800 rounded-xl p-3 text-slate-100 text-xs outline-none focus:border-purple-500 font-sans resize-none flex-1"
                    />
                  </div>
                </div>
              )}

              {isEvaluating && (
                <div className="py-12 flex flex-col items-center justify-center space-y-4 animate-pulse">
                  <div className="relative">
                    <div className="w-12 h-12 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
                    <Sparkles className="w-6 h-6 text-purple-400 absolute inset-0 m-auto animate-bounce" />
                  </div>
                  <div className="text-center space-y-1">
                    <h4 className="text-sm font-semibold text-purple-400">Муза погружается в вашу книгу...</h4>
                    <p className="text-xs text-slate-400 max-w-md mx-auto">Мы сопоставляем правила мира с сюжетными ходами, ищем скрытые дыры и готовим вдохновляющий план доработки идеи.</p>
                  </div>
                </div>
              )}

              {evalError && (
                <div className="p-3 bg-red-950/30 border border-red-900/50 text-red-400 rounded-lg text-xs">
                  {evalError}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            {!evaluationResult && !isEvaluating && (
              <div className="p-4 border-t border-slate-800 bg-slate-950/30 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowEvalModal(false);
                    setWorldBibleText("");
                    setBookPlanText("");
                    setBibleFileName("");
                    setPlanFileName("");
                  }}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-semibold cursor-pointer transition-colors"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={handleEvaluateIdea}
                  disabled={!worldBibleText.trim() && !bookPlanText.trim()}
                  className="px-5 py-2 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white rounded-lg text-xs font-bold disabled:opacity-40 transition-all cursor-pointer flex items-center gap-1.5 shadow-lg"
                >
                  <Sparkle className="w-4 h-4" />
                  <span>Оценить идею книги</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
