"use client";

import Link from "next/link";
import { ArrowLeft, Settings2 } from "lucide-react";

export default function SettingsPage() {
  return <main className="shell appPage"><Link className="backLink" href="/today"><ArrowLeft size={18} /> Сегодня</Link><header className="pageHeader"><div><p className="eyebrow">Аккаунт</p><h1>Настройки</h1></div><Settings2 size={26} /></header><section className="panel"><h2>Настройка программы</h2><p className="muted">Редактирование названий упражнений, рабочих весов, режима учёта и отдыха доступно в текущем рабочем экране.</p><Link className="primary" href="/">Открыть рабочие настройки</Link></section></main>;
}
