"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { Loader2, BarChart3, Briefcase, CalendarClock, Cpu, FileStack, FileText, Globe, History, Inbox, ListChecks, Plug, Server, Settings, User, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { navHrefsFor, type Role } from "@/lib/roles";

/** Grouped the way the work flows: set things up once, let it find and score jobs, then apply, and keep an eye on it. */
const GROUPS = [
  { title: null, items: [{ href: "/", label: "Dashboard", icon: BarChart3 }, { href: "/todo", label: "Your to-do", icon: ListChecks }] },
  {
    title: "1 · Set up (one time)",
    items: [
      { href: "/profile", label: "Profile", icon: User },
      { href: "/profiles", label: "People (profiles)", icon: Users },
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

/** Inside a Link: shows a small spinner the moment that link is clicked, until its page arrives. */
function Pending({ children }: { children: React.ReactNode }) {
  const { pending } = useLinkStatus();
  return <>{children}{pending && <Loader2 className="ml-auto size-3.5 animate-spin" aria-label="Loading" />}</>;
}

export function Nav({ role = "admin" }: { role?: Role }) {
  const path = usePathname();
  const only = navHrefsFor(role);
  const groups = GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => !only || only.includes(i.href)) })).filter((g) => g.items.length > 0);
  return (
    <nav className="flex gap-3 overflow-x-auto md:flex-col md:gap-4" aria-label="Main">
      {groups.map((g, i) => (
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
                <Pending>
                  <Icon className="size-4" />
                  {label}
                </Pending>
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
