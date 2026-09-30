"use client";
import Image from "next/image";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function PrivatePhoto({ path, dataUrl, name }: { path?: string; dataUrl: string; name: string }) {
  const [url, setUrl] = useState(dataUrl);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!path) { setUrl(dataUrl); return; }
    let active = true;
    let objectUrl: string | undefined;
    setError(false);
    void createClient().storage.from("progress-photos").download(path).then(({ data, error }) => {
      if (!active) return;
      if (error || !data) { setError(true); return; }
      objectUrl = URL.createObjectURL(data); setUrl(objectUrl);
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [path, dataUrl, retry]);
  if (error) return <button className="secondary" onClick={() => setRetry((v) => v + 1)}>Загрузить фото снова</button>;
  return url ? <Image src={url} alt={name} width={600} height={600} unoptimized /> : <div className="photoPlaceholder" role="status">Загружаем фото…</div>;
}
