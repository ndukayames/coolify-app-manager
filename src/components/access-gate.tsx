"use client";

import { ArrowRight as arrowRight, KeyRound as keyRound, Mail as mail, ShieldCheck as shieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

export function AccessGate({ variant = "client" }: { variant?: "client" | "admin" }) {
  const ArrowRight = arrowRight;
  const Key = keyRound;
  const Mail = mail;
  const Shield = shieldCheck;
  const router = useRouter();
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const authenticate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(response.status === 429 ? "Too many attempts. Try again shortly." : body?.message ?? "Sign-in failed.");
      }
      router.refresh();
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "Sign-in failed.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="auth-page">
      <div className="auth-glow" />
      <section className="auth-card" aria-labelledby="access-title">
        <div className="auth-mark"><Shield size={20} /></div>
        <span className="utility-label">{variant === "admin" ? "Codeva staff" : "Private console"}</span>
        <h1 id="access-title">{variant === "admin" ? "Codeva Console admin" : "Sign in to Codeva Console"}</h1>
        <p>{variant === "admin" ? "Sign in with your Codeva admin account." : "Use the account Codeva created for you."}</p>

        <form method="post" onSubmit={authenticate}>
          <label htmlFor="email">Email</label>
          <div className="auth-input-wrap">
            <Mail size={17} />
            <input
              id="email"
              name="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@company.com"
              autoComplete="username"
              autoFocus
              required
            />
          </div>
          <label htmlFor="password">Password</label>
          <div className="auth-input-wrap">
            <Key size={17} />
            <input
              id="password"
              name="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Your password"
              autoComplete="current-password"
              required
            />
          </div>
          {error ? <div className="auth-error" role="alert">{error}</div> : null}
          <button className="primary-button auth-submit" type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Signing in…" : "Continue"} <ArrowRight size={16} />
          </button>
        </form>

        <small>Sessions expire after seven days.</small>
      </section>
    </main>
  );
}
