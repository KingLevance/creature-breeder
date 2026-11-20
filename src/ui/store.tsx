// Holds the saved game, writes it to device storage after every change, and hands it to the screens.
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Save, migrate, newSave } from '../game/save';

const KEY = 'hatchlore.save.v1';

interface Game {
  save: Save;
  /** Change the save. The function gets a private copy; whatever it returns is passed back. */
  mutate: <T>(fn: (s: Save) => T) => T;
  reset: () => void;
}

const Ctx = createContext<Game>(null as unknown as Game);
export const useGame = () => useContext(Ctx);
export const rng = Math.random;

export function GameProvider({ children, fallback }: { children: React.ReactNode; fallback: React.ReactNode }) {
  const [save, setSave] = useState<Save | null>(null);
  const ref = useRef<Save | null>(null);

  useEffect(() => {
    let live = true;
    AsyncStorage.getItem(KEY)
      .then(raw => (raw ? migrate(JSON.parse(raw)) : newSave()))
      .catch(() => newSave())
      .then(s => { if (live) { ref.current = s; setSave(s); } });
    return () => { live = false; };
  }, []);

  const mutate = useCallback(<T,>(fn: (s: Save) => T): T => {
    const next = JSON.parse(JSON.stringify(ref.current)) as Save;
    const out = fn(next);
    ref.current = next;
    setSave(next);
    AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
    return out;
  }, []);

  const reset = useCallback(() => {
    const s = newSave();
    ref.current = s;
    setSave(s);
    AsyncStorage.setItem(KEY, JSON.stringify(s)).catch(() => {});
  }, []);

  if (!save) return <>{fallback}</>;
  return <Ctx.Provider value={{ save, mutate, reset }}>{children}</Ctx.Provider>;
}

/** The current time, refreshed on an interval, for timers and cooldowns. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

export function fmtTime(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  if (s >= 60) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${s}s`;
}
