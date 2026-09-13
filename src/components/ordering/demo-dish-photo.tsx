"use client";

import Image from "next/image";
import { useState } from "react";
import { DEMO_RESTAURANT_ID } from "@/shared/demo-menu";
import { demoPhotoPosition } from "./demo-photo";
import styles from "./ordering.module.css";

// Static presentation assets for the source-matched demo dishes only.
// The shared menu contract and merchant photo workflow are unchanged.
const DEMO_PHOTOS: Record<string, { name: string; source: string }> = {
  "3d080a59-c16a-4b1e-846e-dd7e8307fec0": { name: "char siew rice", source: "/demo-food/char-siew-rice.jpg" },
  "9fb8d1d4-552b-42d4-a021-33d2c753bbbc": { name: "braised pork knuckle rice", source: "/demo-food/braised-pork-knuckle-rice.jpg" },
  "19dea502-d55d-4064-bb83-974ef123ec2d": { name: "braised pork knuckle noodles", source: "/demo-food/braised-pork-knuckle-noodles.jpg" },
  "93fef6a9-bdca-448e-8da3-000000000001": { name: "roasted sausage rice", source: "/demo-food/roasted-sausage-rice.jpg" },
  "93fef6a9-bdca-448e-8da3-000000000002": { name: "chicken feet noodle / hor fun", source: "/demo-food/chicken-feet-noodles.jpg" },
  "93fef6a9-bdca-448e-8da3-000000000003": { name: "mushroom chicken feet", source: "/demo-food/mushroom-chicken-feet.jpg" },
  "93fef6a9-bdca-448e-8da3-000000000004": { name: "charcoal char siew wanton noodle", source: "/demo-food/charcoal-char-siew-wanton-noodles.jpg" },
  "93fef6a9-bdca-448e-8da3-000000000005": { name: "wanton soup", source: "/demo-food/wanton-soup.jpg" },
  "93fef6a9-bdca-448e-8da3-000000000006": { name: "dumpling soup", source: "/demo-food/dumpling-soup.jpg" },
  "93fef6a9-bdca-448e-8da3-000000000007": { name: "oyster sauce kailan", source: "/demo-food/oyster-sauce-kailan.jpg" },
};
export function DemoDishPhoto({ restaurantId, dish }: { restaurantId: string; dish: { id: string; name: string } }) {
  const { name } = dish;
  const photo = restaurantId === DEMO_RESTAURANT_ID ? DEMO_PHOTOS[dish.id] : undefined;
  const source = photo?.name === name.trim().replace(/\s+/g, " ").toLowerCase() ? photo.source : undefined;
  const sourceCrop = demoPhotoPosition(restaurantId, dish);
  const [failed, setFailed] = useState<string>();
  return source && failed !== source
    ? <div className={`${styles.photo} ${styles.hasPhoto}`}><Image src={source} alt={`${name} — polished demo photo`} width={1000} height={1000} unoptimized className={styles.dishImage} onError={() => setFailed(source)} /></div>
    : sourceCrop
      ? <div className={styles.sourceDishPhoto}><div className={styles.cropFrame} role="img" aria-label={`${name}, cropped from the photographed printed menu`} style={{ backgroundPosition: sourceCrop }} /><small>From the menu photo</small></div>
      : <div className={styles.photo} role="img" aria-label={`Photo of ${name} not yet available`}><span aria-hidden="true">▧</span><small>No photo yet</small></div>;
}
