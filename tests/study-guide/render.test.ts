import { describe, expect, it } from "vitest";
import { buildIntegratedGuideHtml, buildStudyGuideHtml } from "@/lib/study-guide/render";

const TEXT = [
  "Legitimidade ativa",
  "Esse material foi produzido com base nas obras de Fulano.",
  "O art. 5º da Lei 7.347/1985 prevê que a Defensoria Pública possui legitimidade para propor a ação civil pública, nos termos da lei.",
  "Prescrição",
  "A prescrição das ações coletivas segue o entendimento da Súmula 150 do STF, aplicada de forma majoritária pela jurisprudência.",
].join("\n\n");
const meta = { title: "Direitos <Difusos>", fileName: "difusos.pdf", importedAt: "2026-01-01", formatLabel: "PDF", sizeLabel: "1 KB", pageCount: 3, dateLabel: "01 jan 2026" };

describe("guia de estudo (HTML)", () => {
  const html = buildStudyGuideHtml(meta, TEXT);
  it("tem sumário navegável, pontos essenciais numerados e uma seção por tema", () => {
    expect(html).toContain('href="#t1"');
    expect(html).toContain('id="t2"');
    expect(html).toContain('class="points"');
    expect(html.match(/<section class="topic"/g)).toHaveLength(2);
  });
  it("escapa HTML do título e não traz referências bibliográficas", () => {
    expect(html).toContain("Direitos &lt;Difusos&gt;");
    expect(html).not.toContain("Esse material foi produzido");
  });
  it("destaca o enquadramento legal sem alterar o texto", () => {
    expect(html).toContain("<mark>art. 5º</mark>");
    expect(html).toContain("<mark>Súmula 150</mark>");
  });
  it("documento vazio gera página válida com avisos", () => {
    const empty = buildStudyGuideHtml(meta, "");
    expect(empty).toContain("não há texto extraído");
  });
});

describe("apostila integrada (HTML)", () => {
  const docs = [
    { title: "A", fileName: "a.pdf", formatLabel: "PDF", pageCount: 1, extractedText: TEXT },
    { title: "B", fileName: "b.pdf", formatLabel: "PDF", pageCount: 1, extractedText: TEXT.replace("Prescrição", "Legitimidade ativa") + "\n\nA associação deve estar constituída há pelo menos um ano, conforme o entendimento majoritário do STJ sobre o tema." },
  ];
  const html = buildIntegratedGuideHtml({ name: "Coletivo", dateLabel: "hoje" }, docs);
  it("junta temas iguais entre documentos e não repete parágrafos", () => {
    expect(html.match(/id="t\d+"/g)?.length).toBeLessThanOrEqual(2);
    expect(html.split('<h2 class="block">Conteúdo</h2>')[1].split("possui legitimidade para propor").length - 1).toBe(1);
  });
  it("não mostra origem no texto (apenas atributo invisível) nem rótulos 'Fonte:'", () => {
    expect(html).not.toMatch(/Fonte[s]?:/);
    expect(html).not.toMatch(/<p>[^<]*a\.pdf/);
    expect(html).toContain('data-sources="a.pdf');
  });
});
