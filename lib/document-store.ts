import type { DocumentRecord } from "@/lib/document-types";

const DATABASE_NAME = "atelie-documentos";
const STORE_NAME = "documents";
const DATABASE_VERSION = 1;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      reject(new Error("O armazenamento local de documentos não está disponível neste navegador."));
      return;
    }
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Não foi possível abrir a biblioteca local."));
  });
}

export async function listDocuments(): Promise<DocumentRecord[]> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve((request.result as DocumentRecord[]).sort((a, b) => b.importedAt.localeCompare(a.importedAt)));
    request.onerror = () => reject(request.error ?? new Error("Não foi possível listar os documentos."));
  });
}

export async function saveDocument(document: DocumentRecord) {
  return saveDocuments([document]);
}

export async function saveDocuments(documents: DocumentRecord[]) {
  const database = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    documents.forEach((document) => store.put(document));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Não foi possível salvar os documentos localmente."));
    transaction.onabort = () => reject(transaction.error ?? new Error("A gravação dos documentos foi cancelada."));
  });
}

export async function removeDocument(id: string) {
  const database = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const request = database.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("Não foi possível remover o documento."));
  });
}
