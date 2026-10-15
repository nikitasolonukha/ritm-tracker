/* eslint-disable @next/next/no-img-element -- локальные фото тренажёров без оптимизатора: работают офлайн */
"use client";

import { useState } from "react";
import { Sheet } from "./ds";
import { machinePhoto } from "@/lib/machines";

/** Миниатюра тренажёра; по нажатию открывается крупное фото. Если для упражнения фото нет, ничего не рисуется. */
export function ExercisePhoto({ name, size = 56, className, interactive = true }: { name: string; size?: number; className?: string; interactive?: boolean }) {
  const photo = machinePhoto(name);
  const [open, setOpen] = useState(false);
  if (!photo) return null;
  // Внутри ссылки кнопка недопустима: там показываем просто картинку.
  if (!interactive) return <span className={`machineThumb${className ? ` ${className}` : ""}`} style={{ width: size, height: size }}><img src={photo.src} alt="" loading="lazy" decoding="async" /></span>;
  return <>
    <button type="button" className={`machineThumb${className ? ` ${className}` : ""}`} style={{ width: size, height: size }} aria-label={`Показать тренажёр: ${photo.title}`} onClick={() => setOpen(true)}>
      <img src={photo.src} alt="" loading="lazy" decoding="async" />
    </button>
    <Sheet open={open} onClose={() => setOpen(false)} title={photo.title}>
      <img className="machineFull" src={photo.src} alt={`Тренажёр: ${photo.title}`} />
    </Sheet>
  </>;
}

/** Широкое фото в шапке экрана упражнения. */
export function ExerciseHero({ name }: { name: string }) {
  const photo = machinePhoto(name);
  const [open, setOpen] = useState(false);
  if (!photo) return null;
  return <>
    <button type="button" className="machineHero" aria-label={`Показать тренажёр: ${photo.title}`} onClick={() => setOpen(true)}>
      <img src={photo.src} alt={`Тренажёр: ${photo.title}`} loading="lazy" decoding="async" />
      <span>{photo.title}</span>
    </button>
    <Sheet open={open} onClose={() => setOpen(false)} title={photo.title}>
      <img className="machineFull" src={photo.src} alt={`Тренажёр: ${photo.title}`} />
    </Sheet>
  </>;
}
