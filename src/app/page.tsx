import { redirect } from "next/navigation";

import { signOut } from "@/app/auth/actions";
import { createClient } from "@/lib/supabase/server";

const metrics = [
  { label: "People deciding nearby", value: "—", note: "Connect demo data" },
  { label: "Menu items live", value: "—", note: "Add your first dish" },
  { label: "Saves this week", value: "—", note: "Awaiting diner activity" },
];

const actions = [
  {
    eyebrow: "Right now",
    title: "Update what is available",
    body: "Keep diners from choosing something that has sold out.",
  },
  {
    eyebrow: "Menu",
    title: "Add a signature dish",
    body: "Give Jiak Simi the details it needs to recommend you well.",
  },
  {
    eyebrow: "Quiet hours",
    title: "Create a timely offer",
    body: "Turn nearby indecision into a table at the right moment.",
  },
];

export default async function Home() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims?.sub) redirect("/login");

  return (
    <main className="min-h-screen bg-[var(--cream)] text-[var(--ink)]">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-5 py-6 sm:px-8 lg:px-12">
        <header className="flex items-center justify-between border-b border-[var(--line)] pb-5">
          <div className="flex items-center gap-3">
            <div className="grid size-11 place-items-center rounded-full bg-[var(--red)] text-sm font-black text-white">
              JS
            </div>
            <div>
              <p className="text-lg font-black tracking-tight">Jiak Simi</p>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
                For Business
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs font-semibold text-[var(--muted)] sm:inline">{data.claims.email as string}</span>
            <form action={signOut}>
              <button className="rounded-full border border-[var(--line)] bg-white/70 px-3 py-1.5 text-xs font-bold text-[var(--green)]">Sign out</button>
            </form>
          </div>
        </header>

        <section className="grid flex-1 gap-10 py-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:py-16">
          <div>
            <p className="mb-4 text-sm font-bold uppercase tracking-[0.24em] text-[var(--red)]">
              Your demand desk
            </p>
            <h1 className="max-w-3xl text-5xl font-black leading-[0.96] tracking-[-0.055em] sm:text-6xl lg:text-7xl">
              Be the answer when someone asks,
              <span className="text-[var(--green)]"> “Jiak simi?”</span>
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-[var(--muted)]">
              Manage what diners can discover, react to nearby demand, and turn
              the quiet parts of the day into reasons to visit.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <span className="rounded-full bg-[var(--green)] px-5 py-3 text-sm font-bold text-white">
                Restaurant workspace
              </span>
              <span className="rounded-full border border-[var(--line)] bg-white px-5 py-3 text-sm font-bold text-[var(--muted)]">
                Backend not connected yet
              </span>
            </div>
          </div>

          <div className="rounded-[2rem] border border-[var(--line)] bg-white p-5 shadow-[0_24px_80px_rgba(30,55,45,0.09)] sm:p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-bold text-[var(--muted)]">
                  Today at a glance
                </p>
                <h2 className="mt-1 text-2xl font-black">Good afternoon</h2>
              </div>
              <span className="rounded-full bg-[var(--pale-green)] px-3 py-1.5 text-xs font-bold text-[var(--green)]">
                Demo mode
              </span>
            </div>

            <div className="mt-7 grid gap-3 sm:grid-cols-3">
              {metrics.map((metric) => (
                <article
                  key={metric.label}
                  className="rounded-2xl bg-[var(--cream)] p-4"
                >
                  <p className="min-h-10 text-xs font-bold leading-5 text-[var(--muted)]">
                    {metric.label}
                  </p>
                  <p className="mt-3 text-3xl font-black">{metric.value}</p>
                  <p className="mt-2 text-[11px] font-semibold text-[var(--red)]">
                    {metric.note}
                  </p>
                </article>
              ))}
            </div>

            <div className="mt-6">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-black">Quick actions</h3>
                <span className="text-xs font-semibold text-[var(--muted)]">
                  Prototype preview
                </span>
              </div>
              <div className="space-y-3">
                {actions.map((action, index) => (
                  <article
                    key={action.title}
                    className="flex items-center gap-4 rounded-2xl border border-[var(--line)] p-4"
                  >
                    <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--ink)] text-sm font-black text-white">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[var(--red)]">
                        {action.eyebrow}
                      </p>
                      <h4 className="mt-1 font-black">{action.title}</h4>
                      <p className="mt-1 text-sm leading-5 text-[var(--muted)]">
                        {action.body}
                      </p>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>

        <footer className="flex flex-col gap-2 border-t border-[var(--line)] py-5 text-xs font-semibold text-[var(--muted)] sm:flex-row sm:items-center sm:justify-between">
          <p>Restaurant portal scaffold · No production data connected</p>
          <p>Built separately from the Jiak Simi consumer app</p>
        </footer>
      </div>
    </main>
  );
}
