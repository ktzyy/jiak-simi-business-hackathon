import Link from "next/link";
import Image from "next/image";
import { Brand } from "./page-shell";
import styles from "./landing.module.css";
import { DEMO_RESTAURANT_ID } from "@/shared/demo-menu";

export function Landing({ demo = false }: { demo?: boolean }) {
  const startHref = demo ? "/onboarding" : "/login?next=%2Fonboarding";
  const menuHref = `/order/${DEMO_RESTAURANT_ID}`;
  return <>
    <header className={`site-header ${styles.header}`}><Brand /><Link className={styles.login} href="/login">Log in</Link></header>
    <main className={styles.landing}>
      <section className={styles.hero}>
        <div className={styles.heroCopy}><p className="eyebrow">AI-powered help for your stall</p><h1>You do the cooking.<br /><span>Let us take<br />the orders.</span></h1><p className={styles.description}>Upload your menu. Take phone orders. See what to cook next.</p><p className={styles.setupTime}>Your stall online in about 15 minutes</p><div className={styles.heroActions}><Link className="btn btn-primary" href={startHref}>Get started →</Link><Link className="btn btn-teal" href={menuHref}>See Demo</Link></div></div>
        <div className={styles.phoneStage} aria-label="Example customer menu and cook ticket">
          <div className={styles.phone}>
            <div className={styles.speaker} aria-hidden="true" />
            <div className={styles.phoneContent}><p className={styles.phoneIntro}>Good food, just downstairs.</p><h2>Jiak Simi Roast Meat</h2><Image className={styles.foodPhoto} src="/demo-food/char-siew-rice.jpg" alt="Char siew rice with greens and half an egg — polished demo photo" width={800} height={600} unoptimized priority /><div className={styles.dishLine}><strong>Char Siew Rice</strong><strong>S$4.50</strong></div><p className={styles.phoneDescription}>Choose your chilli. Add a little extra.</p><Link className={`btn btn-primary ${styles.menuLink}`} href={menuHref}>View menu →</Link></div>
          </div>
          <div className={styles.floatingTicket}><span>Sample cook-mode ticket · #041</span><strong>2 × Char Siew Rice</strong><p>Chilli on the side</p></div>
        </div>
      </section>
      <section className={styles.benefits} aria-label="How it works">
        {[['01','Upload your menu','Up to three menu photos.'],['02','Review your dishes','Check prices, extras and photos.'],['03','See what to cook next','Clear tickets, in order.']].map(([n,title,copy]) => <article key={n}><span className={styles.stepNumber}>{n}</span><h2>{title}</h2><p>{copy}</p></article>)}
      </section>
      <section className={styles.closing}><div><h2>Made for the neighbourhood stall.</h2><p>A little less admin. A little more time for your food.</p></div><Link className="btn btn-primary" href={startHref}>Get started</Link></section>
    </main><footer className="site-footer"><strong>Jiak Simi for Business</strong><span>AI that works for hawkers.</span></footer>
  </>;
}
