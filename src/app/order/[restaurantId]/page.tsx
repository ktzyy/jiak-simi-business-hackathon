import { notFound } from "next/navigation";
import { Id } from "@/shared/contracts";
import { CustomerCart } from "@/components/ordering/customer-cart";

export default async function OrderPage({ params, searchParams }: { params: Promise<{ restaurantId: string }>; searchParams: Promise<{ workspace?: string }> }) {
  const { restaurantId } = await params;
  if (!Id.safeParse(restaurantId).success) notFound();
  const staffView = (await searchParams).workspace === "1";
  return <main><CustomerCart restaurantId={restaurantId} showStaffTools={staffView} /></main>;
}
