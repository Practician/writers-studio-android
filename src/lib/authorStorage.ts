import { AuthorProfileRecord, AuthorRevisionRecord, AgentHistoryEntry, CodexEntry } from "../types";

const DB_NAME = "writers-studio-author-editor";
const DB_VERSION = 3;
const PROFILES = "profiles";
const REVISIONS = "revisions";
const AGENT_EPISODES = "agent_episodes";
const DEEP_PROFILES = "deep_profiles";
const PROJECT_CODEX = "project_codex";
export const GLOBAL_AUTHOR_PROFILE_ID = "__global_author_profile__";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const database = request.result;
      const oldVersion = event.oldVersion;
      if (oldVersion < 1) {
        if (!database.objectStoreNames.contains(PROFILES)) {
          database.createObjectStore(PROFILES, { keyPath: "storyId" });
        }
        if (!database.objectStoreNames.contains(REVISIONS)) {
          const store = database.createObjectStore(REVISIONS, { keyPath: "id" });
          store.createIndex("byChapter", "storyChapterKey", { unique: false });
        }
      }
      if (oldVersion < 2) {
        if (!database.objectStoreNames.contains(AGENT_EPISODES)) {
          const episodeStore = database.createObjectStore(AGENT_EPISODES, { keyPath: "id" });
          episodeStore.createIndex("byStory", "storyId", { unique: false });
          episodeStore.createIndex("byTimestamp", "timestamp", { unique: false });
        }
        if (!database.objectStoreNames.contains(DEEP_PROFILES)) {
          database.createObjectStore(DEEP_PROFILES, { keyPath: "storyId" });
        }
      }
      if (oldVersion < 3) {
        if (!database.objectStoreNames.contains(PROJECT_CODEX)) {
          const codexStore = database.createObjectStore(PROJECT_CODEX, { keyPath: "id" });
          codexStore.createIndex("byStory", "storyId", { unique: false });
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Не удалось открыть локальное хранилище"));
  });
}


function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Ошибка локального хранилища"));
  });
}

const PROFILE_UPDATED_EVENT = "writers-studio-author-profile-updated";

/** Уведомить все редакторские поверхности, что единый голос автора изменился. */
export function notifyAuthorProfileUpdated(profileId = GLOBAL_AUTHOR_PROFILE_ID): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(PROFILE_UPDATED_EVENT, { detail: { profileId } }));
}

export function onAuthorProfileUpdated(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = () => handler();
  window.addEventListener(PROFILE_UPDATED_EVENT, listener);
  return () => window.removeEventListener(PROFILE_UPDATED_EVENT, listener);
}

async function readProfile(profileId: string): Promise<AuthorProfileRecord | undefined> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(PROFILES, "readonly");
    return await requestResult(transaction.objectStore(PROFILES).get(profileId));
  } finally {
    database.close();
  }
}

/**
 * Единый паспорт принадлежит автору, а не отдельной книге. Если глобального
 * профиля ещё нет, первый открытый профиль старой книги переносится сюда.
 */
export async function loadGlobalAuthorProfile(fallbackStoryId?: string): Promise<AuthorProfileRecord | undefined> {
  const global = await readProfile(GLOBAL_AUTHOR_PROFILE_ID);
  if (global || !fallbackStoryId || fallbackStoryId === GLOBAL_AUTHOR_PROFILE_ID) return global;

  const legacy = await readProfile(fallbackStoryId);
  if (!legacy) return undefined;

  const migrated = { ...legacy, storyId: GLOBAL_AUTHOR_PROFILE_ID, updatedAt: Date.now() };
  await saveGlobalAuthorProfile(migrated);
  return migrated;
}

export async function saveGlobalAuthorProfile(profile: Omit<AuthorProfileRecord, "storyId"> | AuthorProfileRecord): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(PROFILES, "readwrite");
    await requestResult(transaction.objectStore(PROFILES).put({ ...profile, storyId: GLOBAL_AUTHOR_PROFILE_ID }));
  } finally {
    database.close();
  }
  notifyAuthorProfileUpdated();
}

export async function deleteGlobalAuthorProfile(): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(PROFILES, "readwrite").objectStore(PROFILES).delete(GLOBAL_AUTHOR_PROFILE_ID);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
  notifyAuthorProfileUpdated();
}

/** Совместимость со старыми потребителями: все они теперь читают единый профиль. */
export async function loadAuthorProfile(storyId: string): Promise<AuthorProfileRecord | undefined> {
  return loadGlobalAuthorProfile(storyId);
}

/** Совместимость со старыми потребителями: запись всегда становится глобальной. */
export async function saveAuthorProfile(profile: AuthorProfileRecord): Promise<void> {
  return saveGlobalAuthorProfile(profile);
}

/** Совместимость со старыми потребителями: удаляется единый профиль автора. */
export async function deleteAuthorProfile(_storyId: string): Promise<void> {
  return deleteGlobalAuthorProfile();
}

export async function saveAuthorRevision(revision: AuthorRevisionRecord): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(REVISIONS, "readwrite");
    await requestResult(transaction.objectStore(REVISIONS).put(revision));
  } finally {
    database.close();
  }
}

export async function listAuthorRevisions(storyId: string, chapterId: string): Promise<AuthorRevisionRecord[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(REVISIONS, "readonly");
    const index = transaction.objectStore(REVISIONS).index("byChapter");
    const records = await requestResult(index.getAll(`${storyId}:${chapterId}`));
    return records.sort((left, right) => right.createdAt - left.createdAt);
  } finally {
    database.close();
  }
}

// ─── ИИ-Агент: эпизоды и глубокие профили ────────────────────────────

export async function saveAgentEpisode(episode: AgentHistoryEntry): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(AGENT_EPISODES, "readwrite");
    await requestResult(transaction.objectStore(AGENT_EPISODES).put(episode));
  } finally {
    database.close();
  }
}

export async function listAgentEpisodes(storyId: string): Promise<AgentHistoryEntry[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(AGENT_EPISODES, "readonly");
    const index = transaction.objectStore(AGENT_EPISODES).index("byStory");
    const records = await requestResult(index.getAll(storyId));
    return records.sort((left: AgentHistoryEntry, right: AgentHistoryEntry) => right.timestamp - left.timestamp);
  } finally {
    database.close();
  }
}

export async function saveDeepProfile(storyId: string, profile: unknown): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(DEEP_PROFILES, "readwrite");
    await requestResult(transaction.objectStore(DEEP_PROFILES).put({ storyId, profile, updatedAt: Date.now() }));
  } finally {
    database.close();
  }
}

export async function loadDeepProfile(storyId: string): Promise<unknown | undefined> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(DEEP_PROFILES, "readonly");
    const record = await requestResult(transaction.objectStore(DEEP_PROFILES).get(storyId));
    return record?.profile;
  } finally {
    database.close();
  }
}

// ─── Codex ─────────────────────────────────────────────────────────────

export async function saveCodexEntry(entry: CodexEntry): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(PROJECT_CODEX, "readwrite");
    await requestResult(transaction.objectStore(PROJECT_CODEX).put(entry));
  } finally {
    database.close();
  }
}

export async function listCodexEntries(storyId: string): Promise<CodexEntry[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(PROJECT_CODEX, "readonly");
    const index = transaction.objectStore(PROJECT_CODEX).index("byStory");
    const records = await requestResult(index.getAll(storyId));
    return records.sort((left: CodexEntry, right: CodexEntry) => right.updatedAt - left.updatedAt);
  } finally {
    database.close();
  }
}

export async function deleteCodexEntry(id: string): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(PROJECT_CODEX, "readwrite").objectStore(PROJECT_CODEX).delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
