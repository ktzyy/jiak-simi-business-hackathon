import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./page-shell.module.css";

export function Brand() {
  return <Link href="/" className="brand" aria-label="Jiak Simi for Business home">
    <Image src="/brand/jiak-simi.png" alt="Jiak Simi" width={144} height={35} style={{ width: 126, height: "auto" }} priority />
    <span>FOR BUSINESS</span>
  </Link>;
}
export function PageShell({ children, restaurantId, active }: { children: ReactNode; restaurantId?: string; active?: string }) {
  const query = restaurantId ? `?restaurantId=${encodeURIComponent(restaurantId)}` : "";
  const links = [["dashboard", "/", "Overview"], ["onboarding", restaurantId ? `/order/${restaurantId}` : "/onboarding", "My menu"], ["storefront", "/storefront", "Menu & QR"], ["kitchen", "/kitchen", "Cook mode"]];
  return <>
    <a href="#main" className="skip-link">Skip to content</a>
    <header className={`site-header ${active === "kitchen" ? styles.cookHeader : ""}`}><Brand /><nav className={styles.workspaceNav} aria-label="Stall workspace">
      {links.map(([key, path, label]) => <Link key={key} href={key === "onboarding" && restaurantId ? `${path}?workspace=1` : `${path}${query}`} aria-current={active === key ? "page" : undefined}>{label}</Link>)}
    </nav></header>
    <main id="main" className={`page-main ${active === "kitchen" ? styles.cookMain : ""}`}>{children}</main>
    {active !== "kitchen" && <footer className="site-footer"><strong>Jiak Simi for Business</strong><span>A little less running around. More time for your food.</span></footer>}
  </>;
}
