"use client";
/* eslint-disable @next/next/no-img-element -- Authenticated Blob previews and immutable same-origin published image routes. */
import { useState } from "react";
import { DemoDishPhoto } from "./demo-dish-photo";
import type { DishPhotoCandidate } from "@/shared/dish-photo";
import styles from "./ordering.module.css";

export type DisplayDishPhoto = { dishId: string; dishName: string; imageUrl: string; label: DishPhotoCandidate["label"]; menuId?: string; menuVersion?: number };
export function MenuDishPhoto({ restaurantId, dish, photo }: { restaurantId: string; dish: { id: string; name: string }; photo?: DisplayDishPhoto }) {
  const [failed, setFailed] = useState("");
  if (!photo || photo.dishId !== dish.id || photo.dishName !== dish.name) return <DemoDishPhoto restaurantId={restaurantId} dish={dish} />;
  return <figure style={{ margin: 0 }}>
    {failed === photo.imageUrl ? <div className={styles.photo}><small>Photo unavailable</small></div> : <div className={`${styles.photo} ${styles.hasPhoto}`}><img src={photo.imageUrl} alt={`${photo.label} of ${dish.name}`} className={styles.dishImage} onError={() => setFailed(photo.imageUrl)} /></div>}
    <figcaption style={{ padding: "6px 12px", fontSize: "0.72rem", color: "#52645d", background: "#f7f5ef" }}>{photo.label}</figcaption>
  </figure>;
}
