import Link from "next/link";

const areas = [
  { href: "/projetos", icon: "▦", title: "Projetos de estudo", description: "Organize sua pesquisa por disciplina, tema ou objetivo." },
  { href: "/fontes", icon: "⌕", title: "Biblioteca de fontes", description: "Reúna livros, artigos, legislação, links e materiais." },
  { href: "/documentos", icon: "▤", title: "Biblioteca documental", description: "Preserve arquivos originais e consulte o texto extraído." },
  { href: "/materiais", icon: "✦", title: "Materiais em construção", description: "Escreva capítulos e amadureça suas ideias em Markdown." },
];

export default function Home() {
  return <div className="dashboard">
    <section className="hero">
      <div className="hero-copy"><p className="eyebrow">BEM-VINDA AO SEU ATELIÊ</p><h1>Ideias cuidadas<br /><em>viram conhecimento.</em></h1><p className="hero-text">Um espaço para reunir fontes, confrontar perspectivas e construir materiais que realmente carregam a sua autoria.</p><Link className="button primary" href="/projetos">Começar um projeto <span>→</span></Link></div>
      <div className="hero-art" aria-hidden="true"><div className="orb orb-one" /><div className="orb orb-two" /><div className="orbit orbit-one" /><div className="orbit orbit-two" /><span className="art-glyph">✦</span></div>
    </section>
    <section className="section-block"><div className="section-heading"><div><p className="eyebrow">SEU FLUXO DE TRABALHO</p><h2>Onde você quer continuar?</h2></div><span className="muted-label">PRIMEIRA VERSÃO</span></div><div className="area-grid">{areas.map((area) => <Link href={area.href} className="area-card" key={area.href}><span className="card-icon">{area.icon}</span><span><h3>{area.title}</h3><p>{area.description}</p></span><span className="card-arrow">↗</span></Link>)}</div></section>
    <section className="notice"><span className="notice-icon">i</span><p><strong>Fluxo protegido</strong><br />Documentos, projetos e materiais são vinculados à sua sessão e armazenados no Supabase. A geração integrada usa somente as fontes selecionadas por você.</p><Link href="/projetos">Ver projetos →</Link></section>
  </div>;
}
