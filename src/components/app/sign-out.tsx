"use client";

import { createBrowserClient } from "@supabase/ssr";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SignOut({ url, anonKey }: { url: string; anonKey: string }) {
  const router = useRouter();
  async function signOut() {
    await createBrowserClient(url, anonKey).auth.signOut();
    router.replace("/login");
    router.refresh(); // drop cached signed-in pages
  }
  return (
    <Button variant="ghost" size="sm" className="w-full justify-start gap-2 text-muted-foreground" onClick={signOut}>
      <LogOut className="size-4" /> Sign out
    </Button>
  );
}
