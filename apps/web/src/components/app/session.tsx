"use client";
import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import type { Me, Organization } from "@hvac/shared-types";
import { useMe } from "@/lib/api/queries";
import { getActiveOrgId, setActiveOrgId } from "@/lib/api/client";
import { auth } from "@/lib/api/endpoints";
import { LogoMark } from "./logo";
import { ErrorPanel } from "./error-boundary";

interface SessionCtx {
  me: Me;
  org: Organization;
  switchOrg: (id: string) => void;
  signOut: () => Promise<void>;
}
const Ctx = React.createContext<SessionCtx | null>(null);

export function useSession(): SessionCtx {
  const v = React.useContext(Ctx);
  if (!v) throw new Error("useSession must be used inside <SessionGate>");
  return v;
}

/** Loads /users/me, resolves the active organization, and gates the app until both are known. */
export function SessionGate({ children }: { children: React.ReactNode }) {
  const me = useMe();
  const qc = useQueryClient();
  const router = useRouter();
  const [orgId, setOrgId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!me.data) return;
    const orgs = me.data.organizations;
    const stored = getActiveOrgId();
    const valid = orgs.find((o) => o.id === stored) ?? orgs[0];
    if (valid) {
      if (valid.id !== stored) setActiveOrgId(valid.id);
      setOrgId(valid.id);
    }
  }, [me.data]);

  const switchOrg = React.useCallback(
    (id: string) => {
      setActiveOrgId(id);
      setOrgId(id);
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
      router.push("/dashboard");
    },
    [qc, router],
  );

  const signOut = React.useCallback(async () => {
    try {
      await auth.logout();
    } finally {
      setActiveOrgId(null);
      qc.clear();
      // Full navigation on purpose: drops all in-memory tenant/query state.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/login");
    }
  }, [qc]);

  if (me.isError) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <ErrorPanel error={me.error as Error} reset={() => me.refetch()} title="Couldn't load your account" />
      </div>
    );
  }
  const org = me.data?.organizations.find((o) => o.id === orgId);
  if (!me.data || !org) {
    if (me.data && me.data.organizations.length === 0) {
      return (
        <div className="flex min-h-dvh items-center justify-center text-[13px] text-ink-3">
          Your account isn&apos;t a member of any organization yet. Ask an owner to invite you.
        </div>
      );
    }
    return (
      <div className="flex min-h-dvh items-center justify-center" aria-busy>
        <LogoMark size={28} className="animate-pulse" />
      </div>
    );
  }
  return <Ctx.Provider value={{ me: me.data, org, switchOrg, signOut }}>{children}</Ctx.Provider>;
}
