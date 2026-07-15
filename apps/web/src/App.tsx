import { useCallback, useEffect, useState } from "react";
import { LoaderCircle, ShieldCheck } from "lucide-react";
import { AuthScreen } from "./components/AuthScreen";
import { VaultShell } from "./components/VaultShell";
import { api } from "./lib/api";
import { cryptoClient } from "./lib/crypto-client";
import { cacheBootstrap, getCachedBootstrap } from "./lib/local-db";
import type { Bootstrap } from "./types";

export default function App() {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [phase, setPhase] = useState<"loading" | "locked" | "ready">("loading");
  const [loadingMessage, setLoadingMessage] = useState("Opening encrypted workspace…");

  useEffect(() => {
    void (async () => {
      try {
        const remote = await api.bootstrap();
        await cacheBootstrap(remote);
        setBootstrap(remote);
        setPhase("locked");
      } catch {
        const cached = await getCachedBootstrap();
        if (cached?.initialized) { setBootstrap(cached); setPhase("locked"); }
        else setLoadingMessage("The notepad server is unavailable and no offline vault is cached.");
      }
    })();
  }, []);

  const unlocked = useCallback(async (value: Bootstrap) => {
    await cacheBootstrap(value);
    setBootstrap(value);
    setLoadingMessage("Decrypting local index…");
    setPhase("ready");
  }, []);

  const lock = useCallback(() => {
    void cryptoClient.lock();
    setPhase("locked");
  }, []);

  if (phase === "loading" || !bootstrap) return <main className="loading-page"><div className="loading-logo"><ShieldCheck size={32} /></div><LoaderCircle className="spin" /><strong>{loadingMessage}</strong><span>Your content stays encrypted on this device.</span></main>;
  if (phase === "locked") return <AuthScreen bootstrap={bootstrap} onUnlocked={unlocked} />;
  return <VaultShell onLock={lock} />;
}
