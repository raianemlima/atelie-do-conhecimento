const SMALL_WORD_END = /[a-zà-úç]$/i;
const LOWER_START = /^[a-zà-úç]/;

export function collapseSpaces(value: string): string {
  return value.replace(/[ \t ]+/g, " ").replace(/[​-‍﻿]/g, "").trim();
}

// Junta linhas visuais num parágrafo: remove hifenização partida ("insuficiên-" + "cia") só quando a próxima linha
// continua em minúscula; caso contrário mantém o hífen (ex.: "guarda-" + "Chuva", listas).
export function joinLines(lines: string[]): string {
  let out = "";
  for (const raw of lines) {
    const line = collapseSpaces(raw);
    if (!line) continue;
    if (!out) { out = line; continue; }
    if (out.endsWith("-") && SMALL_WORD_END.test(out.slice(0, -1)) && LOWER_START.test(line)) out = out.slice(0, -1) + line;
    else out += ` ${line}`;
  }
  return out;
}
