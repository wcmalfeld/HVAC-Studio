"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname, useParams } from "next/navigation";
import { Check, ChevronsUpDown, LogOut, Moon, Sun, Monitor, Plus, ArrowLeft, Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { ROLE_LABEL } from "@/lib/labels";
import { useProject } from "@/lib/api/queries";
import { Avatar } from "@/components/ui/misc";
import {
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownLabel,
  DropdownSeparator,
  DropdownTrigger,
} from "@/components/ui/dropdown";
import { LogoMark } from "./logo";
import { useSession } from "./session";
import { useTheme } from "./theme";
import { GLOBAL_NAV, PROJECT_MODULES } from "./modules";
import { ErrorBoundary } from "./error-boundary";

function OrgSwitcher() {
  const { me, org, switchOrg } = useSession();
  return (
    <Dropdown>
      <DropdownTrigger
        className="group flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-surface-2 data-[state=open]:bg-surface-2"
        aria-label="Switch organization"
      >
        <LogoMark size={26} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold leading-tight">{org.name}</span>
          <span className="block text-[11.5px] leading-tight text-ink-3">{ROLE_LABEL[org.role]}</span>
        </span>
        <ChevronsUpDown className="size-3.5 text-ink-4 group-hover:text-ink-3" />
      </DropdownTrigger>
      <DropdownContent align="start" className="w-[232px]">
        <DropdownLabel>Organizations</DropdownLabel>
        {me.organizations.map((o) => (
          <DropdownItem key={o.id} onSelect={() => o.id !== org.id && switchOrg(o.id)}>
            <span className="flex size-5 items-center justify-center rounded bg-surface-3 text-[10px] font-semibold text-ink-2">
              {o.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1 truncate">{o.name}</span>
            {o.id === org.id ? <Check className="!text-accent" /> : null}
          </DropdownItem>
        ))}
      </DropdownContent>
    </Dropdown>
  );
}

function UserMenu() {
  const { me, signOut } = useSession();
  const { pref, setPref } = useTheme();
  return (
    <Dropdown>
      <DropdownTrigger className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-surface-2 data-[state=open]:bg-surface-2">
        <Avatar name={me.user.name} size={24} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-medium leading-tight">{me.user.name}</span>
          <span className="block truncate text-[11.5px] leading-tight text-ink-3">{me.user.email}</span>
        </span>
      </DropdownTrigger>
      <DropdownContent side="top" align="start" className="w-[232px]">
        <DropdownLabel>Appearance</DropdownLabel>
        {(
          [
            ["light", "Light", Sun],
            ["dark", "Dark", Moon],
            ["system", "Match system", Monitor],
          ] as const
        ).map(([v, label, Icon]) => (
          <DropdownItem key={v} onSelect={(e) => { e.preventDefault(); setPref(v); }}>
            <Icon />
            {label}
            {pref === v ? <Check className="ml-auto !text-accent" /> : null}
          </DropdownItem>
        ))}
        <DropdownSeparator />
        <DropdownItem onSelect={() => void signOut()}>
          <LogOut />
          Sign out
        </DropdownItem>
      </DropdownContent>
    </Dropdown>
  );
}

function NavLink({ href, icon: Icon, label, active, trailing }: { href: string; icon: React.ComponentType<{ className?: string }>; label: string; active: boolean; trailing?: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink",
        active && "bg-surface text-ink shadow-sm ring-1 ring-line",
      )}
    >
      <Icon className={cn("size-4 text-ink-3 group-hover:text-ink-2", active && "text-accent group-hover:text-accent")} />
      <span className="flex-1 truncate">{label}</span>
      {trailing}
    </Link>
  );
}

function ProjectNav({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const project = useProject(projectId);
  const base = `/projects/${projectId}`;
  return (
    <div className="mt-5">
      <Link href="/projects" className="mb-2 flex items-center gap-1.5 px-2 text-[12px] font-medium text-ink-3 hover:text-ink">
        <ArrowLeft className="size-3.5" />
        All projects
      </Link>
      <p className="truncate px-2 pb-1.5 text-[13px] font-semibold text-ink" title={project.data?.name}>
        {project.data?.name ?? <span className="skeleton inline-block h-3.5 w-32 rounded" />}
      </p>
      <nav className="flex flex-col gap-0.5" aria-label="Project">
        {PROJECT_MODULES.map((m) => {
          const href = m.slug ? `${base}/${m.slug}` : base;
          const active = m.slug ? pathname.startsWith(href) : pathname === base;
          return (
            <NavLink
              key={m.slug || "overview"}
              href={href}
              icon={m.icon}
              label={m.label}
              active={active}
              trailing={m.phase ? <span className="text-[10.5px] font-medium text-ink-4">Soon</span> : null}
            />
          );
        })}
      </nav>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const params = useParams<{ projectId?: string }>();
  const [mobileOpen, setMobileOpen] = React.useState(false);
  React.useEffect(() => setMobileOpen(false), [pathname]);

  const sidebar = (
    <div className="flex h-full flex-col px-3 py-3">
      <OrgSwitcher />
      <nav className="mt-4 flex flex-col gap-0.5" aria-label="Main">
        {GLOBAL_NAV.map((n) => (
          <NavLink
            key={n.href}
            href={n.href}
            icon={n.icon}
            label={n.label}
            active={n.href === "/projects" ? pathname === "/projects" : pathname.startsWith(n.href)}
          />
        ))}
      </nav>
      {params.projectId ? <ProjectNav projectId={params.projectId} /> : null}
      <div className="mt-auto pt-3">
        <UserMenu />
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[244px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-dvh border-r border-line bg-bg lg:block">{sidebar}</aside>
      {/* mobile top bar */}
      <div className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b border-line bg-surface/90 px-3 backdrop-blur lg:hidden">
        <button className="rounded-md p-1.5 hover:bg-surface-2" aria-label="Open navigation" onClick={() => setMobileOpen(true)}>
          <Menu className="size-5" />
        </button>
        <LogoMark size={22} />
        <span className="text-[13px] font-semibold">HVAC Studio</span>
        <Link href="/dashboard?new=1" className="ml-auto rounded-md p-1.5 text-accent hover:bg-surface-2" aria-label="New project">
          <Plus className="size-5" />
        </Link>
      </div>
      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/30 animate-fade-in" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-[264px] border-r border-line bg-bg shadow-lg animate-pop-in">{sidebar}</aside>
        </div>
      ) : null}
      <main className="min-w-0 bg-surface lg:my-2 lg:mr-2 lg:rounded-xl lg:border lg:border-line lg:shadow-sm">
        <ErrorBoundary>{children}</ErrorBoundary>
      </main>
    </div>
  );
}

export function PageHeader({ title, description, actions, children }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <header className="border-b border-line px-5 pb-4 pt-5 sm:px-8 sm:pt-7">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-[20px] font-semibold tracking-[-0.02em]">{title}</h1>
          {description ? <p className="mt-1 text-[13px] text-ink-3">{description}</p> : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </header>
  );
}
