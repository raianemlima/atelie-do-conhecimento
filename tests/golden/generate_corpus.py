"""Gera o golden corpus de PDFs sintéticos (Fase 0).

Uso: python3 tests/golden/generate_corpus.py
Requer: reportlab e Pillow. Os PDFs gerados são versionados em tests/golden/pdfs/.
Todo o conteúdo é sintético ou de domínio público (texto de lei). Nomes de curso, professor,
autor e julgados marcados como "Exemplo"/"fictício" NÃO existem e servem só para testar a limpeza.
"""
import io
from pathlib import Path

from PIL import Image, ImageDraw
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.lib.pdfencrypt import StandardEncryption
from reportlab.pdfgen import canvas

OUT = Path(__file__).parent / "pdfs"
OUT.mkdir(parents=True, exist_ok=True)
W, H = A4

CF_134 = ("Art. 134. A Defensoria Pública é instituição permanente, essencial à função jurisdicional do Estado, "
          "incumbindo-lhe, como expressão e instrumento do regime democrático, fundamentalmente, a orientação jurídica, "
          "a promoção dos direitos humanos e a defesa, em todos os graus, judicial e extrajudicial, dos direitos individuais "
          "e coletivos, de forma integral e gratuita, aos necessitados, na forma do inciso LXXIV do art. 5º desta Constituição Federal.")
CF_5_LXXIV = ("Art. 5º, LXXIV - o Estado prestará assistência jurídica integral e gratuita aos que comprovarem insuficiência de recursos;")


def wrap(text: str, width: int = 88) -> list[str]:
    words, lines, cur = text.split(), [], ""
    for word in words:
        if len(cur) + len(word) + 1 > width:
            lines.append(cur)
            cur = word
        else:
            cur = f"{cur} {word}".strip()
    if cur:
        lines.append(cur)
    return lines


def write_pdf(name: str, pages: list[list[str]], header=None, footer=None, encrypt=None, font="Helvetica"):
    enc = StandardEncryption(encrypt, canPrint=0) if encrypt else None
    c = canvas.Canvas(str(OUT / name), pagesize=A4, encrypt=enc)
    for number, lines in enumerate(pages, start=1):
        if header:
            c.setFont(font, 6)
            c.drawString(50, H - 30, header(number))
        c.setFont(font, 11)
        y = H - 80
        for line in lines:
            c.drawString(50, y, line)
            y -= 16
        if footer:
            c.setFont(font, 8)
            c.drawString(50, 25, footer(number))
        c.showPage()
    c.save()


def paragraphs(*blocks: str) -> list[str]:
    out: list[str] = []
    for block in blocks:
        out.extend(wrap(block))
        out.append("")
    return out


# 01 - texto simples
write_pdf("01-texto-simples.pdf", [
    ["DEFENSORIA PÚBLICA: NOÇÕES INICIAIS", ""] + paragraphs(
        "A Defensoria Pública presta orientação jurídica e defesa dos necessitados em todos os graus.",
        CF_134),
    ["FUNÇÃO ESSENCIAL À JUSTIÇA", ""] + paragraphs(
        "A instituição atua de forma integral e gratuita, em favor de quem comprove insuficiência de recursos.",
        CF_5_LXXIV),
])

# 02a / 02b - materiais complementares do mesmo tema
write_pdf("02a-complementar-conceito.pdf", [
    ["ASSISTÊNCIA JURÍDICA INTEGRAL E GRATUITA", "", "1. Conceito", ""] + paragraphs(
        "A assistência jurídica integral compreende a orientação, a consultoria e a defesa judicial e extrajudicial.",
        CF_5_LXXIV),
])
write_pdf("02b-complementar-legitimidade.pdf", [
    ["ASSISTÊNCIA JURÍDICA INTEGRAL E GRATUITA", "", "2. Hipossuficiência", ""] + paragraphs(
        "A hipossuficiência abrange a insuficiência econômica e também a vulnerabilidade organizacional do assistido.",
        "A comprovação da insuficiência de recursos orienta o atendimento pela instituição."),
])

# 03a / 03b - quase idênticos
base_a = paragraphs(
    "O princípio da unidade impõe que a instituição atue como um corpo único sob a mesma chefia.",
    "O princípio da indivisibilidade permite a substituição de um membro por outro sem solução de continuidade.",
    "A independência funcional assegura ao membro liberdade de convicção no exercício da função.")
write_pdf("03a-quase-identico.pdf", [["PRINCÍPIOS INSTITUCIONAIS", ""] + base_a])
write_pdf("03b-quase-identico.pdf", [["PRINCÍPIOS INSTITUCIONAIS", ""] + base_a + wrap("Esses princípios são previstos de forma expressa na legislação orgânica.")])

# 04 - ruidoso (cursinho, marca d'água, links, propaganda, hifenização, numeração)
noise_body = [
    paragraphs(
        "O Estado prestará assistência jurídica integral e gratuita aos que comprovarem insuficiên-",
        "cia de recursos, conforme o material do Curso Exemplo, módulo 3.",
        "A Defensoria Pública é essencial à função jurisdicional do Estado."),
    paragraphs(
        "A atuação extrajudicial inclui a promoção da conciliação e da mediação entre as partes.",
        "Acesse www.cursoexemplo.com.br/bonus e baixe o material extra. Siga @cursoexemplo no Instagram."),
    paragraphs(
        "A autonomia funcional e administrativa decorre do texto constitucional e é garantia institucional.",
        "MATRICULE-SE AGORA NO PACOTE COMPLETO COM 30% DE DESCONTO - cursoexemplo.com.br/promo"),
]
write_pdf("04-ruidoso.pdf", [["Direito Constitucional - Aula 1", ""] + body for body in noise_body],
          header=lambda n: "CURSO EXEMPLO PREPARATÓRIO - Prof. Fulano de Tal - Licensed to Aluno Teste - aluno@example.com - 000.000.000-00 Última atualização: 01/01/2026",
          footer=lambda n: f"Dúvidas e sugestões: contato@cursoexemplo.example   {n}")

# 05 - citações (lei, súmula, julgado, autor)
write_pdf("05-citacoes.pdf", [["CITAÇÕES JURÍDICAS PARA CONFERÊNCIA", ""] + paragraphs(
    CF_134,
    CF_5_LXXIV,
    "Súmula 421 do STJ: Os honorários advocatícios não são devidos à Defensoria Pública quando ela atua contra a pessoa jurídica de direito público à qual pertence.",
    "REsp 0000000/XX (julgado fictício), Rel. Min. Exemplo, Segunda Turma, julgado em 01/01/2020 - Tese fictícia para teste de preservação.",
    "Segundo Autor Exemplo, Manual Fictício de Processo, p. 123, a instituição é expressão do regime democrático.")])

# 06 - digitalizado (somente imagem, sem camada de texto)
img = Image.new("RGB", (1240, 400), "white")
draw = ImageDraw.Draw(img)
draw.text((40, 60), "DOCUMENTO DIGITALIZADO - SEM CAMADA DE TEXTO", fill="black")
draw.text((40, 120), "A Defensoria Publica presta assistencia juridica integral e gratuita.", fill="black")
buf = io.BytesIO()
img.save(buf, format="PNG")
buf.seek(0)
c = canvas.Canvas(str(OUT / "06-digitalizado.pdf"), pagesize=A4)
c.drawImage(ImageReader(buf), 40, H - 300, width=520, height=168)
c.showPage()
c.save()

# 07 - corrompido (PDF truncado)
data = (OUT / "01-texto-simples.pdf").read_bytes()
(OUT / "07-corrompido.pdf").write_bytes(data[: len(data) // 2])

# 08 - protegido por senha
write_pdf("08-protegido.pdf", [["DOCUMENTO PROTEGIDO POR SENHA", "", "Conteúdo indisponível sem a senha."]], encrypt="senha-de-teste")


# --- Fase 3: layout (colunas, tabela, notas de rodapé) e PDF misto (texto + página digitalizada) ---
def draw(c, x, y, lines, size=10.5, leading=14, font="Helvetica"):
    c.setFont(font, size)
    for line in lines:
        c.drawString(x, y, line)
        y -= leading
    return y


# 09 - duas colunas, com título em largura total
c = canvas.Canvas(str(OUT / "09-duas-colunas.pdf"), pagesize=A4)
c.setFont("Helvetica-Bold", 14)
c.drawString(50, H - 110, "PRINCIPIOS DA DEFENSORIA PUBLICA")
left = wrap("COLUNA ESQUERDA PRIMEIRO. A unidade impoe que a instituicao atue como um corpo unico sob a mesma chefia, de modo que a atuacao de um membro vincula a instituicao como um todo.", 42)
left += [""] + wrap("A indivisibilidade permite a substituicao de um membro por outro sem solucao de continuidade, preservando o atendimento ao assistido.", 42)
right = wrap("COLUNA DIREITA DEPOIS. A independencia funcional assegura ao membro liberdade de conviccao no exercicio da funcao, sem subordinacao hierarquica quanto ao merito.", 42)
right += [""] + wrap("A autonomia funcional e administrativa decorre do texto constitucional e constitui garantia institucional.", 42)
draw(c, 50, H - 150, left)
draw(c, 310, H - 150, right)
c.showPage()
c.save()

# 10 - tabela entre dois paragrafos
c = canvas.Canvas(str(OUT / "10-tabela.pdf"), pagesize=A4)
y = draw(c, 50, H - 110, wrap("A tabela a seguir compara as correntes sobre a legitimidade da Defensoria Publica para a acao civil publica, conforme o quadro.", 90))
rows = [("Corrente", "Posicao", "Fundamento"), ("Ampla", "Admite", "Art. 134 CF"), ("Restrita", "Nega", "Hipossuficiencia"), ("Intermediaria", "Admite parcial", "Tutela coletiva")]
y -= 12
for row in rows:
    for x, cell in zip((50, 200, 350), row):
        c.setFont("Helvetica-Bold" if row is rows[0] else "Helvetica", 10.5)
        c.drawString(x, y, cell)
    y -= 16
y -= 14
draw(c, 50, y, wrap("Apos o quadro, o texto retoma a exposicao corrida sobre os efeitos praticos de cada corrente adotada pelos tribunais.", 90))
c.showPage()
c.save()

# 11 - notas de rodape, cabecalho/rodape repetidos e numeracao (3 paginas)
c = canvas.Canvas(str(OUT / "11-notas-de-rodape.pdf"), pagesize=A4)
bodies = [
    ("A assistencia juridica integral abrange a orientacao e a defesa.1 Ela independe de contrato de honorarios.", "1 Nota de rodape: conceito adotado pela doutrina majoritaria."),
    ("A hipossuficiencia organizacional amplia o publico atendido.2 O tema e debatido nos tribunais superiores.", "2 Nota de rodape: ver debate sobre vulnerabilidade organizacional."),
    ("A atuacao extrajudicial privilegia a solucao consensual dos conflitos.3 Isso reduz a litigiosidade.", "3 Nota de rodape: exemplo de mediacao em nucleos especializados."),
]
for number, (body, note) in enumerate(bodies, start=1):
    c.setFont("Helvetica", 8)
    c.drawString(50, H - 35, "Direito Constitucional - Material de Estudos")
    draw(c, 50, H - 120, wrap(body, 90))
    c.setStrokeColorRGB(0, 0, 0)
    c.line(50, 120, 200, 120)
    draw(c, 50, 108, wrap(note, 110), size=8, leading=10)
    c.setFont("Helvetica", 9)
    c.drawString(280, 28, f"{number}")
    c.showPage()
c.save()

# 12 - misto: pagina 1 com texto, pagina 2 somente imagem (sem camada de texto), pagina 3 com texto
img2 = Image.new("RGB", (1240, 300), "white")
ImageDraw.Draw(img2).text((40, 80), "PAGINA DIGITALIZADA SEM CAMADA DE TEXTO", fill="black")
buf2 = io.BytesIO()
img2.save(buf2, format="PNG")
buf2.seek(0)
c = canvas.Canvas(str(OUT / "12-misto.pdf"), pagesize=A4)
draw(c, 50, H - 100, wrap("Primeira pagina com texto: a Defensoria Publica presta orientacao juridica integral e gratuita aos necessitados.", 90), size=11)
c.showPage()
c.drawImage(ImageReader(buf2), 40, H - 260, width=520, height=126)
c.showPage()
draw(c, 50, H - 100, wrap("Terceira pagina com texto: a autonomia funcional e administrativa e garantia institucional prevista na Constituicao.", 90), size=11)
c.showPage()
c.save()

print("Corpus gerado em", OUT)
