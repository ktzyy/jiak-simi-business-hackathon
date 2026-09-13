import Link from "next/link";
import { Brand } from "./page-shell";
import styles from "./workspace.module.css";

export function Landing() {
  return <>
    <header className="site-header"><Brand /><Link className="btn btn-outline" href="/login">Log in</Link></header>
    <main className={`page-main ${styles.landing}`}>
      <section className={styles.hero}>
        <div><p className="eyebrow">Made for the neighbourhood hawker</p><h1>You do the cooking.<br /><span>Let us take<br />the orders.</span></h1><p>Short of hands? Start with a photo of your menu. Customers order on their phones, and you see clearly what to cook next.</p><div className="actions"><Link className="btn btn-primary" href="/login?next=%2Fonboarding">Get started →</Link><Link className="btn btn-outline" href="/login">Log in</Link></div></div>
        <div className={styles.heroPreview} aria-label="Example kitchen ticket"><p className="eyebrow">Less calling out. More cooking.</p><div className={styles.demoTicket}><span className={styles.demoLabel}>EXAMPLE ORDER</span><h2>2 × Char Siew Rice</h2><p>Extra char siew on one</p><hr /><strong>1 × Pork Knuckle Noodles</strong><p>No chilli</p><div className={styles.received}>Order received ✓</div></div><p className="muted">One clear screen. Every dish and extra.</p></div>
      </section>
      <section className={styles.benefits} aria-label="How it works">
        {[['01','Snap your menu','Upload a clear photo. We help turn it into a menu customers can tap.'],['02','Have a quick look','Check the names and prices. Add your usual extras, then publish.'],['03','See what to cook','Orders come together on your kitchen screen, with all the details.']].map(([n,title,copy]) => <article className="card" key={n}><span className={styles.stepNumber}>{n}</span><h2>{title}</h2><p>{copy}</p></article>)}
      </section>
    </main><footer className="site-footer"><strong>Jiak Simi for Business</strong><span>AI that works for hawkers.</span></footer>
  </>;
}
