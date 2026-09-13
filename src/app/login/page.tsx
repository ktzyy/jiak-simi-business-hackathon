import Link from "next/link";
import { signIn, signUp } from "@/app/auth/actions";
import { Brand } from "@/components/ui/page-shell";
import styles from "@/components/ui/workspace.module.css";

type LoginPageProps = { searchParams: Promise<{ message?: string; next?: string }> };
export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { message, next = "/" } = await searchParams;
  return <>
    <header className="site-header"><Brand /><Link className="btn btn-outline" href="/">Home</Link></header>
    <main className={styles.login}>
      <section><p className="eyebrow">Made for the neighbourhood hawker</p><h1>You do the cooking.<br /><span>Let us take the orders.</span></h1><p className="muted">Short of hands? Start with a photo of your menu. Customers order on their phones, and you see clearly what to cook next.</p><p>One menu. One QR. One clear kitchen screen.</p></section>
      <section className={`card ${styles.loginForm}`} id="access" aria-labelledby="login-title">
        <p className="eyebrow">Your stall workspace</p><h2 id="login-title">Good to see you.</h2><p className="muted">Log in with the email connected to your stall.</p>
        {message && <p className="notice" role="status">{message}</p>}
        <form><input type="hidden" name="next" value={next} />
          <label className="field">Email<input required name="email" type="email" autoComplete="email" /></label>
          <label className="field">Password<input required minLength={8} name="password" type="password" autoComplete="current-password" /></label>
          <button formAction={signIn} className="btn btn-teal">Log in →</button>
          <button formAction={signUp} className="btn btn-outline">Create account</button>
        </form>
        <p className="muted" style={{fontSize:14,marginTop:20,marginBottom:0}}>New accounts need to be connected to a stall before you can publish menus or view orders.</p>
      </section>
    </main><footer className="site-footer"><strong>Jiak Simi for Business</strong><span>AI that works for hawkers.</span></footer>
  </>;
}
