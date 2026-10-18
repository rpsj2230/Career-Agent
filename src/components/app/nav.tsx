"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Briefcase, CalendarClock, Cpu, FileStack, FileText, Globe, History, Inbox, Plug, Server, Settings, User } from "lucide-react";
import { cn } from "@/lib/utils";

/** Grouped the way the work flows: set things up once, let it find and score jobs, then apply, and keep an eye on it. */
const GROUPS = [
  { title: null, items: [{ href: "/", label: "Dashboard", icon: BarChart3 }] },
  {
    title: "1 · Set up (one time)",
    items: [
      { href: "/profile", label: "Profile", icon: User },
      { href: "/resumes", label: "Resumes", icon: FileStack },
      { href: "/countries", label: "Countries", icon: Globe },
      { href: "/portals", label: "Job sources", icon: Plug },
      { href: "/models", label: "AI models", icon: Cpu },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
  {
    title: "2 · Find & score jobs",
    items: [
      { href: "/schedules", label: "Schedules (automatic)", icon: CalendarClock },
      { href: "/jobs", label: "Jobs found & scored", icon: Inbox },
    ],
  },
  { title: "3 · Apply", items: [{ href: "/applications", label: "Applications", icon: Briefcase }] },
  {
    title: "Monitor",
    items: [
      { href: "/reports", label: "Reports", icon: FileText },
      { href: "/logs", label: "Logs & history", icon: History },
      { href: "/system", label: "System health", icon: Server },
    ],
  },
] as const;

export function Nav() {
  const path = usePathname();
  return (
    <nav className="flex gap-3 overflow-x-auto md:flex-col md:gap-4" aria-label="Main">
      {GROUPS.map((g, i) => (
        <div key={i} className="flex gap-1 md:flex-col">
          {g.title && <div className="hidden px-3 pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground md:block">{g.title}</div>}
          {g.items.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? path === "/" : path.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  active && "bg-accent text-accent-foreground",
                )}
              >
                <Icon className="size-4" />
                {label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
