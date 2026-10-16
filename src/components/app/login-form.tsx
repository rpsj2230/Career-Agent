"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function LoginForm({ next, notAllowed }: { next: string; notAllowed: boolean }) {
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
        <CardTitle>Career Agent</CardTitle>
        <CardDescription>Sign in with your account. Your browser or password manager can remember it.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
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
