"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Briefcase, Cpu, FileText, Globe, History, Inbox, Plug, Server, Settings, User } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/", label: "Dashboard", icon: BarChart3 },
  { href: "/jobs", label: "Review queue", icon: Inbox },
  { href: "/applications", label: "Applications", icon: Briefcase },
  { href: "/portals", label: "Portals", icon: Plug },
  { href: "/countries", label: "Countries", icon: Globe },
  { href: "/reports", label: "Reports", icon: FileText },
  { href: "/logs", label: "Logs", icon: History },
  { href: "/profile", label: "Profile", icon: User },
  { href: "/models", label: "Models", icon: Cpu },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/system", label: "System", icon: Server },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto md:flex-col">
      {ITEMS.map(({ href, label, icon: Icon }) => {
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
    </nav>
  );
}
