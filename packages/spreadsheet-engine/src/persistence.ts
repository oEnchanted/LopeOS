import type { Workbook } from "./model.ts";
import { deserializeWorkbook, serializeWorkbook } from "./io.ts";

const DATABASE = "lopeos-spreadsheet-recovery";
const STORE = "workbooks";
export interface RecoveryEntry {
  key: string;
  name: string;
  revision: number;
  savedAt: string;
  serialized: string;
  previous?: string;
}
export class WorkbookStorageError extends Error {
  readonly reason: "quota" | "unavailable" | "conflict" | "corrupt";
  constructor(
    message: string,
    reason: "quota" | "unavailable" | "conflict" | "corrupt",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "WorkbookStorageError";
    this.reason = reason;
  }
}

function storageError(error: unknown): WorkbookStorageError {
  if (error instanceof WorkbookStorageError) return error;
  const quota =
    error instanceof DOMException && error.name === "QuotaExceededError";
  return new WorkbookStorageError(
    quota
      ? "Recovery storage is full. Your open workbook is still in memory; save a local workbook file now."
      : "Local recovery storage is unavailable. Save a workbook file to keep your changes.",
    quota ? "quota" : "unavailable",
    { cause: error },
  );
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(storageError(new Error("IndexedDB unavailable")));
      return;
    }
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore(STORE, { keyPath: "key" });
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(storageError(request.error));
    request.onblocked = () =>
      reject(
        new WorkbookStorageError(
          "Recovery storage is blocked by another open window. Save a workbook file.",
          "unavailable",
        ),
      );
  });
}

/** Atomic current/previous snapshot write. Resolves only after the IndexedDB commit. */
export async function saveRecovery(
  workbook: Workbook,
  options: {
    key?: string;
    expectedRevision?: number;
    signal?: AbortSignal;
    serialized?: string;
  } = {},
): Promise<RecoveryEntry> {
  options.signal?.throwIfAborted();
  // The optional string must come from serializeWorkbook(Offthread) for this exact revision.
  // Avoid reparsing a multi-megabyte trusted worker result on the UI thread. Recovery reads still validate the schema.
  const serialized = options.serialized ?? serializeWorkbook(workbook);
  if (
    !serialized.startsWith(
      '{"format":"lopeos-workbook","schemaVersion":1,"workbook":',
    )
  )
    throw new WorkbookStorageError(
      "The prepared recovery is not a native workbook snapshot.",
      "corrupt",
    );
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);
      let failure: unknown;
      const key = options.key ?? workbook.id;
      const result: RecoveryEntry = {
        key,
        name: workbook.name,
        revision: workbook.revision,
        savedAt: new Date().toISOString(),
        serialized,
      };
      const abort = () => {
        failure = new DOMException("Recovery cancelled", "AbortError");
        transaction.abort();
      };
      options.signal?.addEventListener("abort", abort, { once: true });
      const read = store.get(key);
      read.onsuccess = () => {
        const previous = read.result as RecoveryEntry | undefined;
        if (
          options.expectedRevision !== undefined &&
          previous &&
          previous.revision !== options.expectedRevision
        ) {
          failure = new WorkbookStorageError(
            "This recovery was changed in another window. Save a separate workbook file before replacing it.",
            "conflict",
          );
          transaction.abort();
          return;
        }
        if (previous?.serialized !== serialized)
          result.previous = previous?.serialized;
        else result.previous = previous.previous;
        try {
          store.put(result);
        } catch (error) {
          failure = error;
          transaction.abort();
        }
      };
      transaction.oncomplete = () => {
        options.signal?.removeEventListener("abort", abort);
        resolve(result);
      };
      transaction.onabort = transaction.onerror = () => {
        options.signal?.removeEventListener("abort", abort);
        reject(
          failure instanceof DOMException && failure.name === "AbortError"
            ? failure
            : storageError(failure ?? transaction.error),
        );
      };
      if (options.signal?.aborted) abort();
    });
  } finally {
    database.close();
  }
}

export async function loadRecovery(
  key: string,
  previous = false,
): Promise<Workbook | undefined> {
  const database = await openDatabase();
  try {
    const entry = await new Promise<RecoveryEntry | undefined>(
      (resolve, reject) => {
        const request = database.transaction(STORE).objectStore(STORE).get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(storageError(request.error));
      },
    );
    const text = previous ? entry?.previous : entry?.serialized;
    if (!text) return undefined;
    try {
      return deserializeWorkbook(text);
    } catch (error) {
      throw new WorkbookStorageError(
        "This recovery snapshot is damaged. Try the previous recovery or your saved workbook file.",
        "corrupt",
        { cause: error },
      );
    }
  } finally {
    database.close();
  }
}

export async function listRecoveries(): Promise<
  Omit<RecoveryEntry, "serialized" | "previous">[]
> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction(STORE).objectStore(STORE).getAll();
      request.onsuccess = () =>
        resolve(
          (request.result as RecoveryEntry[])
            .map(({ key, name, revision, savedAt }) => ({
              key,
              name,
              revision,
              savedAt,
            }))
            .sort((a, b) => b.savedAt.localeCompare(a.savedAt)),
        );
      request.onerror = () => reject(storageError(request.error));
    });
  } finally {
    database.close();
  }
}

export async function removeRecovery(key: string): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).delete(key);
      transaction.oncomplete = () => resolve();
      transaction.onabort = transaction.onerror = () =>
        reject(storageError(transaction.error));
    });
  } finally {
    database.close();
  }
}
