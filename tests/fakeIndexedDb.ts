/**
 * Минимальный IndexedDB для тестов профиля автора.
 *
 * Зачем он здесь. `src/lib/authorStorage.ts` работает только через IndexedDB, а в
 * Node её нет, поэтому проверка «миграция не раздаёт голос всем книгам» иначе
 * осталась бы непроверяемой. Мок покрывает ровно то, чем пользуется модуль:
 * open / createObjectStore / get / put / delete / transaction. Никаких индексов и
 * курсоров — в authorStorage они не используются.
 *
 * Асинхронность повторяет настоящую: результат выдаётся на следующем тике, через
 * присваивание `onsuccess`. Иначе промисы резолвились бы синхронно и тесты про
 * миграцию проходили бы, не проверив ничего.
 */

type Row = Record<string, unknown>;

/** Запрос: сначала вызывается обработчик, потом значение появляется в result. */
class FakeRequest<T> {
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  result!: T;
  error: unknown = null;

  constructor(private readonly compute: () => T) {
    queueMicrotask(() => {
      try {
        this.result = compute();
        this.onsuccess?.();
      } catch (error) {
        this.error = error;
        this.onerror?.();
      }
    });
  }
}

class FakeObjectStore {
  constructor(
    private readonly rows: Map<string, Row>,
    private readonly keyPath: string,
  ) {}

  get(key: string) {
    return new FakeRequest(() => this.rows.get(key) as Row | undefined);
  }

  put(value: Row) {
    return new FakeRequest(() => {
      this.rows.set(String(value[this.keyPath]), value);
      return value[this.keyPath];
    });
  }

  delete(key: string) {
    return new FakeRequest(() => {
      this.rows.delete(key);
      return undefined;
    });
  }
}

class FakeTransaction {
  constructor(private readonly stores: Record<string, FakeObjectStore>) {}
  objectStore(name: string) {
    const store = this.stores[name];
    if (!store) throw new Error(`Нет хранилища ${name}`);
    return store;
  }
}

class FakeOpenRequest {
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onupgradeneeded: ((event: { oldVersion: number; result: FakeDatabase }) => void) | null = null;
  result: FakeDatabase | null = null;
  error: unknown = null;
}

class FakeDatabase {
  private stores: Record<string, FakeObjectStore> = {};
  objectStoreNames = { contains: (name: string) => Boolean(this.stores[name]) };

  createObjectStore(name: string, options?: { keyPath?: string }) {
    const keyPath = options?.keyPath || "id";
    this.stores[name] = new FakeObjectStore(storeOf(name), keyPath);
    return this.stores[name];
  }

  transaction(_names: string, _mode?: string) {
    return new FakeTransaction(this.stores);
  }

  close() {}
}

export interface FakeDbSeed {
  /** Имя хранилища → строки, которые в нём лежат изначально. */
  [storeName: string]: Array<Row>;
}

/** Хранилища переживают открытие базы: модуль открывает её на каждый вызов. */
const persistedStores = new Map<string, Map<string, Row>>();

function storeOf(name: string): Map<string, Row> {
  let rows = persistedStores.get(name);
  if (!rows) {
    rows = new Map<string, Row>();
    persistedStores.set(name, rows);
  }
  return rows;
}

/**
 * Подменить глобальный indexedDB. Хранилища из `seed` создаются сразу, поэтому
 * `onupgradeneeded` не вызывается — модулю он в этих сценариях не нужен.
 *
 * Данные живут между вызовами `open()`: `openDatabase` в authorStorage вызывается
 * на каждую операцию, и если бы мок создавал новую базу каждый раз, запись и
 * последующее чтение попали бы в разные хранилища (первый прогон тестов на
 * миграцию ловил именно это: `changed: true`, а профиль — `undefined`).
 *
 * Возвращает функцию отката прежнего значения.
 */
export function installFakeIndexedDb(seed: FakeDbSeed = {}): () => void {
  const holder = globalThis as { indexedDB?: unknown };
  const previous = holder.indexedDB;
  let seeded = false;
  holder.indexedDB = {
    open(_name: string, _version: number) {
      const request = new FakeOpenRequest();
      queueMicrotask(() => {
        const database = new FakeDatabase();
        for (const storeName of ["profiles", "revisions", "agent_episodes", "deep_profiles", "project_codex"]) {
          database.createObjectStore(storeName, { keyPath: "storyId" });
        }
        // Начальное содержимое кладём ОДИН раз, при первом открытии. Иначе каждое
        // следующее `open()` стирало бы то, что записала предыдущая операция, и
        // запись профиля молча пропадала: `saveAuthorProfile` отрабатывал, а
        // `loadAuthorProfile` возвращал undefined.
        if (!seeded) {
          seeded = true;
          for (const [storeName, rows] of Object.entries(seed)) {
            const target = storeOf(storeName);
            target.clear();
            for (const row of rows) target.set(String(row.storyId), row);
          }
        }
        request.result = database;
        request.onsuccess?.();
      });
      return request as unknown as IDBOpenDBRequest;
    },
  };
  return () => {
    holder.indexedDB = previous;
  };
}

/** Полностью очистить мок-хранилища — между независимыми сценариями. */
export function resetFakeIndexedDb(): void {
  persistedStores.clear();
}
/**
 * Минимальный localStorage. Нужен не сам по себе, а потому, что миграция
 * профиля автора отсекается на `typeof localStorage === "undefined"` — в Node
 * этого глобала нет, и без мока функция выходит сразу, а тест на перенос профиля
 * проходит, ничего не проверив. Именно так выглядели первые прогоны этого файла:
 * четыре теста «проходили», и все четыре падали бы на живом устройстве.
 */
export function installFakeLocalStorage(): () => void {
  const holder = globalThis as { localStorage?: unknown };
  const previous = holder.localStorage;
  const store = new Map<string, string>();
  holder.localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  };
  return () => {
    holder.localStorage = previous;
  };
}
