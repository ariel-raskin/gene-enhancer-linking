import Link from "next/link";

const steps = [
  ["01", "Choose data", "Start with processed differential results or strand-specific PRO-seq tracks."],
  ["02", "Review candidates", "Compare nearby enhancer-like transcription with gene-body responses."],
  ["03", "Export evidence", "Inspect candidate intervals and export browser-ready links for follow-up."],
];

export default function Home() {
  return (
    <main className="page-wrap">
      <section className="hero">
        <div className="eyebrow"><span className="eyebrow-dot" /> OPEN RESEARCH SOFTWARE · EARLY ACCESS</div>
        <h1>Find the transcriptional<br /><em>evidence around a gene.</em></h1>
        <p className="hero-copy">GEL organizes perturbation PRO-seq results into nearby enhancer-like candidates, response comparisons, and browser-ready links for researcher review.</p>
        <div className="hero-actions"><Link className="button button-dark" href="/workspace">Open analysis workspace <span>↗</span></Link><Link className="button button-light" href="/results">Explore synthetic demo</Link></div>
        <div className="hero-note"><span className="status-dot" /> DEMO RUNS ON SYNTHETIC SIGNAL DATA <span className="note-sep">·</span> LIMITED TO A DECLARED REGION</div>
      </section>
      <section className="workflow-section">
        <div className="section-heading"><div><div className="eyebrow">A REVIEW WORKFLOW</div><h2>Evidence first. Researcher decides.</h2></div><p>GEL automates a screening step that researchers often carry out in a genome browser. Every output keeps coordinates, measurements, and limitations visible.</p></div>
        <div className="step-grid">{steps.map(([n, title, text]) => <article className="step-card" key={n}><div className="step-number">{n}</div><h3>{title}</h3><p>{text}</p></article>)}</div>
      </section>
      <section className="demo-callout"><div><div className="eyebrow">SYNTHETIC WALKTHROUGH</div><h2>One gene, two nearby signal peaks.</h2><p>See how a concordant and a discordant response are retained side by side.</p></div><Link className="button button-green" href="/results">View the example <span>→</span></Link></section>
      <section className="science-note"><div className="note-icon">i</div><p><strong>Candidate association is not causal validation.</strong> Concordant transcriptional responses can help prioritize loci for inspection, but they do not prove that an enhancer regulates a particular gene. The independent K562 CRISPRi evaluation in the research prototype did not show improvement over distance-only assignment.</p></section>
    </main>
  );
}
