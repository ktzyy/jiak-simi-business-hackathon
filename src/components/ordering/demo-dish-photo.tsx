"use client";

import Image from "next/image";
import { useState } from "react";
import { demoPhotoForDish } from "./demo-photo";
import styles from "./ordering.module.css";

export function DemoDishPhoto({ restaurantId, dish }: { restaurantId: string; dish: { id: string; name: string } }) {
  const { name } = dish;
  const photo = demoPhotoForDish(restaurantId, dish);
  const source = photo?.source;
  const sourceCrop = photo?.position;
  const [failed, setFailed] = useState<string>();
  return source && failed !== source
    ? <div className={`${styles.photo} ${styles.hasPhoto}`}><Image src={source} alt={`${name} — polished demo photo`} width={1000} height={1000} unoptimized className={styles.dishImage} onError={() => setFailed(source)} /></div>
    : sourceCrop
      ? <div className={styles.sourceDishPhoto}><div className={styles.cropFrame} role="img" aria-label={`${name}, cropped from the original demo menu`} style={{ backgroundPosition: sourceCrop }} /><small>Original demo photo</small></div>
      : <div className={styles.photo} role="img" aria-label={`Photo of ${name} not yet available`}><span aria-hidden="true">▧</span><small>No photo yet</small></div>;
}
