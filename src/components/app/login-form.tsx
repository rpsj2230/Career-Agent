"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Brand } from "./brand";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="mr-2 size-4" aria-hidden="true">
      <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.9-5.5 3.9-3.3 0-6-2.7-6-6s2.7-6 6-6c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.3 14.6 2.3 12 2.3 6.7 2.3 2.4 6.6 2.4 12s4.3 9.7 9.6 9.7c5.5 0 9.2-3.9 9.2-9.4 0-.6-.1-1.1-.2-1.6H12z" />
    </svg>
  );
}

export function LoginForm({ next, notAllowed, googleError }: { next: string; notAllowed: boolean; googleError?: boolean }) {
  const [busy, setBusy] = useState(false);

  async function signIn(email: string, password: string): Promise<boolean> {
    const res = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(data.error ?? "Could not sign in"); return false; }
    window.location.href = next; // full navigation so the proxy sees the new session cookie
    return true;
  }

  async function onSignIn(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    const ok = await signIn(String(f.get("email")).trim(), String(f.get("password")));
    if (!ok) setBusy(false);
  }

  async function onCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const email = String(f.get("email")).trim(), password = String(f.get("password"));
    if (password !== String(f.get("confirm"))) return toast.error("Passwords do not match");
    setBusy(true);
    const res = await fetch("/api/auth/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, code: String(f.get("code")) }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(data.error ?? "Could not create the account"); return setBusy(false); }
    toast.success("Account created. Signing you in...");
    if (!(await signIn(email, password))) setBusy(false);
  }

  const field = (id: string, label: string, type = "text", extra: Record<string, string> = {}) => (
    <div className="grid gap-1"><Label htmlFor={id}>{label}</Label><Input id={id} name={id} type={type} required {...extra} /></div>
  );

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <Brand size={96} />
        <CardTitle className="sr-only">Sign in</CardTitle>
        <CardDescription>Sign in with Google, or with your email and password.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Button asChild variant="outline" className="w-full"><a href={`/api/auth/google?next=${encodeURIComponent(next)}`}><GoogleMark /> Continue with Google</a></Button>
        {googleError && <Alert variant="destructive"><AlertTitle>Google sign-in did not complete</AlertTitle><AlertDescription>Try again, or use your email and password. If it keeps failing, Google sign-in may not be switched on yet (see docs/GOOGLE_LOGIN.md).</AlertDescription></Alert>}
        {notAllowed && <Alert variant="destructive"><AlertTitle>This account is not allowed</AlertTitle><AlertDescription>Its email is not on the allowed list. Sign in with a different account.</AlertDescription></Alert>}
        <Tabs defaultValue="signin">
          <TabsList className="grid w-full grid-cols-2"><TabsTrigger value="signin">Sign in</TabsTrigger><TabsTrigger value="create">Create account</TabsTrigger></TabsList>
          <TabsContent value="signin">
            <form onSubmit={onSignIn} className="grid gap-3 pt-3">
              {field("email", "Email", "email", { autoComplete: "username" })}
              {field("password", "Password", "password", { autoComplete: "current-password" })}
              <Button type="submit" disabled={busy}>{busy ? "Signing in..." : "Sign in"}</Button>
            </form>
          </TabsContent>
          <TabsContent value="create">
            <form onSubmit={onCreate} className="grid gap-3 pt-3">
              {field("email", "Your email", "email", { autoComplete: "username" })}
              {field("password", "Choose a password (10+ characters)", "password", { autoComplete: "new-password", minLength: "10" })}
              {field("confirm", "Repeat the password", "password", { autoComplete: "new-password" })}
              {field("code", "Invite code", "password", { autoComplete: "off" })}
              <p className="text-xs text-muted-foreground">Invite code: your CRON_SECRET value from Vercel (Settings, Environment Variables). The first account created becomes the owner; nobody else can register afterwards.</p>
              <Button type="submit" disabled={busy}>{busy ? "Creating..." : "Create account"}</Button>
            </form>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
