import { signIn, signUp } from "@/app/auth/actions";

type LoginPageProps = {
  searchParams: Promise<{ message?: string; next?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { message, next = "/" } = await searchParams;

  return (
    <main className="grid min-h-screen place-items-center bg-[var(--cream)] px-5 py-12 text-[var(--ink)]">
      <section className="w-full max-w-md rounded-[2rem] border border-[var(--line)] bg-white p-7 shadow-[0_24px_80px_rgba(30,55,45,0.09)] sm:p-9">
        <div className="mb-8 flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-full bg-[var(--red)] text-sm font-black text-white">JS</div>
          <div>
            <p className="text-lg font-black tracking-tight">Jiak Simi</p>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">For Business</p>
          </div>
        </div>

        <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--red)]">Restaurant access</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight">Sign in to your workspace</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">Use the email address connected to your restaurant account.</p>

        {message ? (
          <p role="status" className="mt-5 rounded-2xl bg-[var(--pale-green)] px-4 py-3 text-sm font-semibold text-[var(--green)]">{message}</p>
        ) : null}

        <form className="mt-6 space-y-4">
          <input type="hidden" name="next" value={next} />
          <label className="block text-sm font-bold">
            Email
            <input required name="email" type="email" autoComplete="email" className="mt-2 w-full rounded-xl border border-[var(--line)] px-4 py-3 font-normal outline-none focus:border-[var(--green)]" />
          </label>
          <label className="block text-sm font-bold">
            Password
            <input required minLength={8} name="password" type="password" autoComplete="current-password" className="mt-2 w-full rounded-xl border border-[var(--line)] px-4 py-3 font-normal outline-none focus:border-[var(--green)]" />
          </label>
          <div className="grid gap-3 pt-2 sm:grid-cols-2">
            <button formAction={signIn} className="rounded-full bg-[var(--green)] px-5 py-3 text-sm font-bold text-white">Sign in</button>
            <button formAction={signUp} className="rounded-full border border-[var(--line)] px-5 py-3 text-sm font-bold text-[var(--ink)]">Create account</button>
          </div>
        </form>
      </section>
    </main>
  );
}
