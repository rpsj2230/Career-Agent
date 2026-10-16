"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function AddJob() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const payload = Object.fromEntries([...f.entries()].filter(([, v]) => String(v).trim()));
    setBusy(true);
    const res = await fetch("/api/jobs/manual", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return toast.error(data.error ?? "Could not add job");
    toast.success("Job added. Run scoring to queue it.");
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline">Add job manually</Button></DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Add a job</DialogTitle>
          <DialogDescription>For Naukri, Foundit, Shine, LinkedIn or email alerts: paste the link and description.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3">
          <div className="grid gap-1"><Label htmlFor="url">Job link</Label><Input id="url" name="url" type="url" required placeholder="https://www.naukri.com/..." /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1"><Label htmlFor="title">Title</Label><Input id="title" name="title" required /></div>
            <div className="grid gap-1"><Label htmlFor="company">Company</Label><Input id="company" name="company" required /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1"><Label htmlFor="country">Country code</Label><Input id="country" name="country" maxLength={2} placeholder="in" /></div>
            <div className="grid gap-1"><Label htmlFor="location">Location</Label><Input id="location" name="location" placeholder="Bengaluru" /></div>
          </div>
          <div className="grid gap-1"><Label htmlFor="description">Job description</Label><Textarea id="description" name="description" required rows={8} /></div>
          <Button type="submit" disabled={busy}>{busy ? "Adding..." : "Add job"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
