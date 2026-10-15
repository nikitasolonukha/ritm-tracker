"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const storageKey = "ritm-rest-sound";

/**
 * Сигнал в конце отдыха: два коротких гудка и вибрация, если экран открыт. Звук включается жестом пользователя
 * (на iPhone иначе нельзя), поэтому `unlock` вызывается при записи подхода. Для таймера, который закончился,
 * пока приложение было закрыто, сигнала нет: напоминание в таком случае приходит в Telegram.
 */
export function useRestAlert(timerKey: string | undefined, expired: boolean) {
  const [soundOn, setSoundState] = useState(true);
  const context = useRef<AudioContext | null>(null);
  const seenRunning = useRef<string | undefined>(undefined);
  const alerted = useRef<string | undefined>(undefined);

  useEffect(() => { try { setSoundState(window.localStorage.getItem(storageKey) !== "off"); } catch { /* по умолчанию включено */ } }, []);

  const unlock = useCallback(() => {
    try {
      const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Context) return;
      context.current ??= new Context();
      void context.current.resume();
    } catch { /* звук необязателен */ }
  }, []);

  const setSoundOn = useCallback((value: boolean) => {
    setSoundState(value);
    try { window.localStorage.setItem(storageKey, value ? "on" : "off"); } catch { /* останется на эту сессию */ }
    if (value) unlock();
  }, [unlock]);

  useEffect(() => { if (timerKey && !expired) seenRunning.current = timerKey; }, [timerKey, expired]);

  useEffect(() => {
    if (!timerKey || !expired || seenRunning.current !== timerKey || alerted.current === timerKey) return;
    alerted.current = timerKey;
    if (!soundOn) return;
    try { navigator.vibrate?.([220, 110, 220]); } catch { /* нет вибрации */ }
    const audio = context.current;
    if (!audio) return;
    try {
      for (const [offset, frequency] of [[0, 880], [0.28, 1175]] as const) {
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, audio.currentTime + offset);
        gain.gain.exponentialRampToValueAtTime(0.25, audio.currentTime + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + offset + 0.22);
        oscillator.connect(gain).connect(audio.destination);
        oscillator.start(audio.currentTime + offset);
        oscillator.stop(audio.currentTime + offset + 0.25);
      }
    } catch { /* звук необязателен */ }
  }, [timerKey, expired, soundOn]);

  return { soundOn, setSoundOn, unlock };
}
