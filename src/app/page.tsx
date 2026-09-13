import { signOut } from "@/app/auth/actions";
import { createClient } from "@/lib/supabase/server";
import { Id } from "@/shared/contracts";
import { DEMO_RESTAURANT_ID } from "@/shared/demo-menu";
import { Dashboard } from "@/components/ui/dashboard";
import { Landing } from "@/components/ui/landing";
import { PageShell } from "@/components/ui/page-shell";

export default async function Home({ searchParams }: { searchParams: Promise<{ restaurantId?: string }> }) {
  const { restaurantId = DEMO_RESTAURANT_ID } = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  // Public presentation only. The existing proxy still requires Elsen's root exception.
  if (error || !data?.claims?.sub) return <Landing />;
  if (!Id.safeParse(restaurantId).success) return <PageShell><p className="notice notice-error" role="alert">This stall ID doesn’t look right. Open your assigned stall link and try again.</p></PageShell>;
  return <PageShell restaurantId={restaurantId} active="dashboard">
    <Dashboard key={restaurantId} restaurantId={restaurantId} />
    <form action={signOut}><button className="btn btn-outline btn-small">Log out</button></form>
  </PageShell>;
}
