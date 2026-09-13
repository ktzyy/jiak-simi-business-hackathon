import { notFound } from "next/navigation";
import { Id } from "@/shared/contracts";
import { CustomerCart } from "@/components/ordering/customer-cart";

export default async function OrderPage({ params }: { params: Promise<{ restaurantId: string }> }) {
  const { restaurantId } = await params;
  if (!Id.safeParse(restaurantId).success) notFound();
  return <main><CustomerCart restaurantId={restaurantId} /></main>;
}
