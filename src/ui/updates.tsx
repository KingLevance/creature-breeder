// Over-the-air updates (expo-updates, EAS Update). JavaScript changes reach the installed app without a new IPA.
// At launch the app waits a few seconds for a new update and, if one arrives, restarts straight into it, so a
// single restart is enough. If the check is slow, the game opens as usual and a banner offers the restart once
// the update has downloaded. Coming back to the app checks again (at most every ten minutes).
// Native changes (new modules, app.json) still need a new IPA: updates are tied to the app version.
// Nothing happens on web or in development, where Updates.isEnabled is false.
import * as Updates from 'expo-updates';
import React, { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, Text, View } from 'react-native';
import { C } from './kit';

const LAUNCH_WAIT_MS = 4000;
const RECHECK_MS = 10 * 60 * 1000;

async function downloadNewUpdate(): Promise<boolean> {
  const r = await Updates.checkForUpdateAsync();
  if (!r.isAvailable) return false;
  const f = await Updates.fetchUpdateAsync();
  return f.isNew;
}

export function UpdateGate({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<'checking' | 'restarting' | 'ready'>(Updates.isEnabled ? 'checking' : 'ready');
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const last = useRef(0);

  const check = async (atLaunch: boolean) => {
    if (!Updates.isEnabled || busy.current) return;
    busy.current = true;
    last.current = Date.now();
    try {
      if (await downloadNewUpdate()) {
        if (atLaunch && phaseRef.current === 'checking') { setPhase('restarting'); await Updates.reloadAsync(); return; }
        setPending(true);
      }
    } catch {
      // Offline or the server is unreachable: carry on with what's installed.
    } finally {
      busy.current = false;
    }
  };
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  useEffect(() => {
    if (!Updates.isEnabled) return;
    const t = setTimeout(() => setPhase(p => (p === 'checking' ? 'ready' : p)), LAUNCH_WAIT_MS);
    check(true).finally(() => setPhase(p => (p === 'checking' ? 'ready' : p)));
    const sub = AppState.addEventListener('change', s => {
      if (s === 'active' && Date.now() - last.current > RECHECK_MS) check(false);
    });
    return () => { clearTimeout(t); sub.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (phase !== 'ready') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg }}>
        <Text style={{ color: C.text, fontSize: 22, fontWeight: '900' }}>Hatchlore</Text>
        <Text style={{ color: C.dim, marginTop: 8 }}>{phase === 'restarting' ? 'Installing update...' : 'Checking for updates...'}</Text>
      </View>
    );
  }
  return (
    <View style={{ flex: 1 }}>
      {children}
      {pending ? (
        <Pressable onPress={() => Updates.reloadAsync().catch(() => {})} style={{ position: 'absolute', left: 14, right: 14, bottom: 70, backgroundColor: C.accent, borderRadius: 12, padding: 12 }}>
          <Text style={{ color: C.text, fontWeight: '800', textAlign: 'center' }}>Update ready. Tap to restart.</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** What's running, for the settings screen. */
export function versionLabel(): string {
  if (!Updates.isEnabled) return 'Development build';
  const when = Updates.createdAt ? new Date(Updates.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null;
  return `Version ${Updates.runtimeVersion || '?'}` + (Updates.isEmbeddedLaunch ? ' · as installed' : ` · update of ${when || '?'}`) + (Updates.channel ? ` · ${Updates.channel}` : '');
}
