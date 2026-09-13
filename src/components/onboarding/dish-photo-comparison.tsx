"use client";

import Image from "next/image";
import { useState } from "react";
import { demoPhotoForDish } from "@/components/ordering/demo-photo";
import s from "./onboarding.module.css";

export function DishPhotoComparison({ restaurantId, dish }: { restaurantId: string; dish: { id: string; name: string } }) {
  const photo = demoPhotoForDish(restaurantId, dish);
  const [failed, setFailed] = useState<string>();
  if (!photo) return <p className={s.photoUnavailable}>No matching demo photo yet</p>;
  return <div className={s.photoComparison} aria-label={`Photo comparison for ${dish.name}`}>
    <figure><div className={s.originalCrop} role="img" aria-label={`${dish.name} from the original demo menu`} style={{ backgroundPosition: photo.position }} /><figcaption>Menu photo</figcaption></figure>
    <figure>{failed === photo.source ? <div className={s.photoUnavailable}>Photo couldn’t load</div> : <Image src={photo.source} alt={`${dish.name}, polished demo photo`} width={200} height={150} unoptimized onError={() => setFailed(photo.source)} />}<figcaption>Polished · demo</figcaption></figure>
  </div>;
}
