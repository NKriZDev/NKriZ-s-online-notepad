import { useState } from "react";
import { KeyRound, LockKeyhole, NotebookPen, ShieldCheck } from "lucide-react";
import { api } from "../lib/api";
import { cryptoClient, type VaultSetup } from "../lib/crypto-client";
import type { Bootstrap } from "../types";

type Props = {
  bootstrap: Bootstrap;
  onUnlocked: (bootstrap: Bootstrap) => void;
};

export function AuthScreen({ bootstrap, onUnlocked }: Props) {
  const [mode, setMode] = useState<"login" | "setup" | "verify" | "recover">(bootstrap.initialized ? "login" : "setup");
  const [username, setUsername] = useState(bootstrap.username ?? "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [recoveryKey, setRecoveryKey] = useState("");
  const [verification, setVerification] = useState("");
  const [setup, setSetup] = useState<VaultSetup | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (mode === "setup") {
        if (password.length < 12) throw new Error("Use at least 12 characters for the vault password.");
        if (password !== confirm) throw new Error("The passwords do not match.");
        const created = await cryptoClient.createVault(password);
        setSetup(created);
        setMode("verify");
      } else if (mode === "verify" && setup) {
        const expected = setup.recoveryKey.replace(/-/g, "").slice(-8).toLowerCase();
        if (verification.replace(/-/g, "").trim().toLowerCase() !== expected) throw new Error("The recovery-key confirmation does not match.");
        await api.setup({
          username,
          authCredential: setup.authCredential,
          recoveryCredential: setup.recoveryCredential,
          authSalt: setup.authSalt,
          passwordEnvelope: setup.passwordEnvelope,
          recoveryEnvelope: setup.recoveryEnvelope,
          kdfParams: setup.kdfParams
        });
        onUnlocked({ ...bootstrap, initialized: true, username, authSalt: setup.authSalt, passwordEnvelope: setup.passwordEnvelope, recoveryEnvelope: setup.recoveryEnvelope, kdfParams: setup.kdfParams });
      } else if (mode === "login") {
        const unlocked = await cryptoClient.unlockPassword(password, bootstrap);
        if (navigator.onLine) await api.login(username, unlocked.authCredential);
        onUnlocked(bootstrap);
      } else if (mode === "recover") {
        if (password.length < 12 || password !== confirm) throw new Error("Enter matching new passwords with at least 12 characters.");
        const recovered = await cryptoClient.unlockRecovery(recoveryKey, bootstrap);
        const wrapped = await cryptoClient.rewrapPassword(password);
        await api.recover({ ...wrapped, recoveryCredential: recovered.recoveryCredential });
        onUnlocked({ ...bootstrap, authSalt: wrapped.authSalt, passwordEnvelope: wrapped.passwordEnvelope, kdfParams: wrapped.kdfParams });
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to unlock the vault");
    } finally {
      setBusy(false);
    }
  };

  return <main className="auth-page">
    <section className="auth-card">
      <div className="brand-mark"><NotebookPen size={30} /></div>
      <h1>NKriZ&apos;s Online Notepad</h1>
      <p className="auth-subtitle">{mode === "setup" || mode === "verify" ? "Create your private encrypted workspace" : mode === "recover" ? "Recover your vault" : "Unlock your workspace"}</p>
      <form onSubmit={submit}>
        {mode === "verify" && setup ? <div className="recovery-box">
          <ShieldCheck size={28} />
          <strong>Save this recovery key now</strong>
          <p>It is the only way to recover your encrypted vault. The server cannot replace it.</p>
          <code>{setup.recoveryKey}</code>
          <button type="button" className="secondary" onClick={() => navigator.clipboard.writeText(setup.recoveryKey)}>Copy key</button>
          <label>Enter the final 8 characters to confirm
            <input autoFocus value={verification} onChange={(event) => setVerification(event.target.value)} required />
          </label>
        </div> : <>
          {mode !== "recover" && <label>Username
            <input autoFocus value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required />
          </label>}
          {mode === "recover" && <label>Recovery key
            <textarea autoFocus value={recoveryKey} onChange={(event) => setRecoveryKey(event.target.value)} rows={3} required />
          </label>}
          <label>{mode === "recover" ? "New password" : "Password"}
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} required />
          </label>
          {(mode === "setup" || mode === "recover") && <label>Confirm password
            <input type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="new-password" required />
          </label>}
        </>}
        {error && <div className="error-banner">{error}</div>}
        <button className="primary auth-submit" disabled={busy}>
          {busy ? <span className="spinner" /> : mode === "setup" ? <KeyRound size={17} /> : mode === "verify" ? <ShieldCheck size={17} /> : <LockKeyhole size={17} />}
          {busy ? "Working…" : mode === "setup" ? "Generate vault" : mode === "verify" ? "Create vault" : mode === "recover" ? "Reset password" : "Unlock"}
        </button>
      </form>
      {bootstrap.initialized && <button className="link-button" onClick={() => { setError(""); setMode(mode === "recover" ? "login" : "recover"); }}>
        {mode === "recover" ? "Back to login" : "Use recovery key"}
      </button>}
      <div className="zero-knowledge"><ShieldCheck size={14} /> Encrypted before it leaves this device</div>
    </section>
  </main>;
}
