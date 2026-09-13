import { Id } from "@/shared/contracts";
import { DEMO_RESTAURANT_ID } from "@/shared/demo-menu";
import { Onboarding } from "@/components/onboarding/onboarding";

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ restaurantId?: string | string[]; edit?: string }> }) {
  const params = await searchParams;
  const query = params.restaurantId;
  const parsed = Id.safeParse(query ?? DEMO_RESTAURANT_ID);
  if (!parsed.success) return <main className="container"><h1>Check your stall link</h1><p>This restaurant link isn’t valid. Open your dashboard and try again.</p></main>;
  return <Onboarding key={parsed.data} restaurantId={parsed.data} editPublished={params.edit === "1"} />;
}
