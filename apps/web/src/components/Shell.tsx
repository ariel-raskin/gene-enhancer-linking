import Link from "next/link";

const links = [["Home", "/"], ["Workspace", "/workspace"], ["Results", "/results"], ["Downloads", "/downloads"], ["Docs", "/docs"]];

export function Shell({ children }: { children: React.ReactNode }) {
  return <><header className="topbar"><Link className="brand" href="/"><span className="brand-mark">G</span><span>GEL<small>GENE–ENHANCER LINKING</small></span></Link><nav>{links.map(([name, href]) => <Link key={href} href={href}>{name}</Link>)}</nav><a className="github-link" href="https://github.com/ariel-raskin/gene-enhancer-linking" target="_blank" rel="noreferrer">GitHub ↗</a></header>{children}<footer className="footer"><span>GEL · Gene–Enhancer Linking</span><span>Candidate discovery from nascent transcription · v0.6.1 · bounded chromosome screening</span></footer></>;
}
