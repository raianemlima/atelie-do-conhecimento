export type Project = {
  id: string;
  name: string;
  subject: string;
  description: string;
  createdAt: string;
  updatedAt: string;
};

export type SourceType = "Livro" | "Artigo" | "Legislação" | "Jurisprudência" | "Curso" | "Notícia" | "Outro";

export type Source = {
  id: string;
  title: string;
  type: SourceType;
  url: string;
  notes: string;
  createdAt: string;
  projectId: string | null;
};

export type Chapter = {
  id: string;
  title: string;
  content: string;
  status: "draft" | "approved";
  updatedAt: string;
  projectId: string | null;
};

const keys = {
  projects: "atelie:projects",
  sources: "atelie:sources",
  chapters: "atelie:chapters",
} as const;

function isBrowser() {
  return typeof window !== "undefined";
}

export function readCollection<T>(key: keyof typeof keys): T[] {
  if (!isBrowser()) return [];
  try {
    const value = window.localStorage.getItem(keys[key]);
    return value ? (JSON.parse(value) as T[]) : [];
  } catch {
    return [];
  }
}

export function writeCollection<T>(key: keyof typeof keys, value: T[]) {
  if (!isBrowser()) return;
  window.localStorage.setItem(keys[key], JSON.stringify(value));
}

export function createId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function now() {
  return new Date().toISOString();
}
