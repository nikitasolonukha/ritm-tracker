"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, RefreshCw, Send, Unplug } from "lucide-react";

type Status = "loading" | "connected" | "pending" | "expired" | "disconnected" | "error" | "unavailable";
const labels: Record<Status, string> = { loading: "Проверяем подключение", connected: "Подключён", pending: "Ожидаем запуск бота", expired: "Срок ссылки истёк", disconnected: "Не подключён", error: "Ошибка доставки", unavailable: "Нет связи с сервером" };

export function TelegramSettings() {
  const [status, setStatus] = useState<Status>("loading");
  const [link, setLink] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/telegram/link", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok || !(body.status in labels)) throw new Error();
      setStatus(body.status);
      if (body.status === "connected") { setLink(""); setMessage("Telegram подключён к этому аккаунту."); }
    } catch { setStatus("unavailable"); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!link) return;
    const interval = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 5000);
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    return () => { window.clearInterval(interval); window.removeEventListener("focus", onFocus); };
  }, [link, refresh]);
  async function request(action: "connect" | "disconnect" | "test") {
    if (busy) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(action === "test" ? "/api/telegram/test-job" : "/api/telegram/link", { method: action === "disconnect" ? "DELETE" : "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error === "telegram_not_linked" ? "Сначала подключите Telegram." : body.error === "telegram_unavailable" ? "Telegram временно недоступен. Попробуйте позже." : "Не удалось выполнить запрос. Повторите попытку.");
      if (action === "connect") {
        if (!body.link) throw new Error("Сервер не вернул ссылку. Повторите попытку.");
        setLink(body.link); setStatus("pending");
      } else if (action === "disconnect") { setLink(""); setStatus("disconnected"); }
      else setMessage("Тестовое напоминание запланировано через минуту. Ожидаем доставку в Telegram.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Нет связи с сервером."); }
    finally { setBusy(false); }
  }
  return <section className="settingsSection" aria-labelledby="telegram-heading">
    <header className="sectionHeading"><h2 id="telegram-heading">Telegram</h2><span className="connectionStatus" role="status">{labels[status]}</span></header>
    {link ? <div className="telegramConnect"><a className="primary" href={link} target="_blank" rel="noreferrer"><ExternalLink size={19} /> Открыть бота</a><p className="muted">Нажмите «Старт» в Telegram. Подтверждение появится здесь автоматически.</p></div>
      : <button className={status === "connected" ? "secondary" : "primary"} disabled={busy} onClick={() => request("connect")}><Send size={18} />{busy ? "Подождите…" : status === "connected" ? "Переподключить Telegram" : "Подключить Telegram"}</button>}
    <div className="settingsActions"><button className="secondary" disabled={busy} onClick={refresh}><RefreshCw size={17} /> Проверить подключение</button>
      {link && <button className="secondary" disabled={busy} onClick={() => request("connect")}>Создать новую ссылку</button>}
      {status === "connected" && <><button className="secondary" disabled={busy} onClick={() => request("test")}><Send size={17} /> Тестовое сообщение</button><button className="secondary" disabled={busy} onClick={() => request("disconnect")}><Unplug size={17} /> Отключить</button></>}
    </div>
    {message && <p className="storageMessage" role="status">{message}</p>}
  </section>;
}
