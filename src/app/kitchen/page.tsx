import Link from "next/link";

import { OrderQueue } from "@/components/kitchen/order-queue";
import { PageShell } from "@/components/ui/page-shell";
import { Id } from "@/shared/contracts";
import { DEMO_RESTAURANT_ID } from "@/shared/demo-menu";

export default async function KitchenPage({
  searchParams,
}: {
  searchParams: Promise<{ restaurantId?: string | string[] }>;
}) {
  const { restaurantId: suppliedId } = await searchParams;
  const restaurant = Id.safeParse(suppliedId === undefined ? DEMO_RESTAURANT_ID : suppliedId);

  if (!restaurant.success) {
    return (
      <PageShell active="kitchen">
        <div className="notice" role="alert">
          <h1>This stall link doesn’t look right</h1>
          <p>Open Cook mode from your dashboard to see the right orders.</p>
          <Link href="/" className="btn btn-teal">Back to dashboard</Link>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell active="kitchen" restaurantId={restaurant.data}>
      <OrderQueue key={restaurant.data} restaurantId={restaurant.data} />
    </PageShell>
  );
}
