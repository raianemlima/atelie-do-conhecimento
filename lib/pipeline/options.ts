// Opções de limpeza por caderno. Sem dependências de servidor: a tela e a API compartilham o mesmo formato.
export type CleaningSettings = {
  // Marca, curso ou professor a remover do corpo do texto (uma entrada por termo).
  knownTerms: string[];
  // Referências que a usuária quer MANTER exatamente como estão (nome, trecho, link).
  keepReferences: string[];
  // Padrão false: o texto final não referencia professores. true mantém todas as menções.
  keepProfessors: boolean;
};

export const DEFAULT_CLEANING_SETTINGS: CleaningSettings = { knownTerms: [], keepReferences: [], keepProfessors: false };
export const MAX_SETTING_ITEMS = 100;
export const MAX_SETTING_LENGTH = 200;

export class SettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettingsError";
  }
}

function list(value: unknown, label: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) throw new SettingsError(`${label}: informe uma lista de textos.`);
  const items = [...new Set((value as string[]).map((item) => item.replace(/\s+/g, " ").trim()).filter(Boolean))];
  if (items.length > MAX_SETTING_ITEMS) throw new SettingsError(`${label}: no máximo ${MAX_SETTING_ITEMS} itens.`);
  const tooLong = items.find((item) => item.length > MAX_SETTING_LENGTH);
  if (tooLong) throw new SettingsError(`${label}: cada item pode ter até ${MAX_SETTING_LENGTH} caracteres.`);
  return items;
}

export function parseCleaningSettings(raw: unknown): CleaningSettings {
  if (raw === undefined || raw === null) return { ...DEFAULT_CLEANING_SETTINGS };
  if (typeof raw !== "object" || Array.isArray(raw)) throw new SettingsError("As opções de limpeza estão malformadas.");
  const input = raw as Record<string, unknown>;
  if (input.keepProfessors !== undefined && typeof input.keepProfessors !== "boolean") throw new SettingsError("keepProfessors deve ser verdadeiro ou falso.");
  return { knownTerms: list(input.knownTerms, "Termos a remover"), keepReferences: list(input.keepReferences, "Referências a manter"), keepProfessors: input.keepProfessors === true };
}

export const isDefaultSettings = (settings: CleaningSettings) => !settings.knownTerms.length && !settings.keepReferences.length && !settings.keepProfessors;

// Chave estável (independe da ordem) para hash de job e de cache.
export function settingsKey(settings: CleaningSettings): string {
  return JSON.stringify({ k: [...settings.knownTerms].sort(), r: [...settings.keepReferences].sort(), p: settings.keepProfessors });
}
