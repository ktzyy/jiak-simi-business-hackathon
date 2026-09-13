import { QrPanel } from "@/components/storefront/qr-panel";
import { PageShell } from "@/components/ui/page-shell";
import { Id } from "@/shared/contracts";
import { DEMO_RESTAURANT_ID } from "@/shared/demo-menu";

export default async function StorefrontPage({ searchParams }: { searchParams: Promise<{ restaurantId?: string }> }) {
  const { restaurantId = DEMO_RESTAURANT_ID } = await searchParams;
  if (!Id.safeParse(restaurantId).success) return <PageShell><p role="alert" className="notice notice-error">This stall link doesn’t look right. Open your workspace and try again.</p></PageShell>;
  return <PageShell restaurantId={restaurantId} active="storefront"><QrPanel key={restaurantId} restaurantId={restaurantId} /></PageShell>;
}
