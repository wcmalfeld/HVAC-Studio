"use client";
import { PageHeader } from "@/components/app/shell";
import { useSession } from "@/components/app/session";
import { ROLE_LABEL } from "@/lib/labels";
import { Avatar } from "@/components/ui/misc";

export function SettingsView() {
  const { me, org } = useSession();
  return (
    <div>
      <PageHeader title="Company settings" description="Organization details and team." />
      <div className="mx-auto grid max-w-[880px] gap-8 px-5 py-8 sm:px-8">
        <section>
          <h2 className="text-[14px] font-semibold">Organization</h2>
          <dl className="mt-3 grid grid-cols-[160px_1fr] gap-y-2 rounded-lg border border-line px-4 py-3 text-[13px]">
            <dt className="text-ink-3">Name</dt>
            <dd>{org.name}</dd>
            <dt className="text-ink-3">Your role</dt>
            <dd>{ROLE_LABEL[org.role]}</dd>
            <dt className="text-ink-3">Organization ID</dt>
            <dd className="text-ink-3 tnum">{org.id}</dd>
          </dl>
        </section>
        <section>
          <h2 className="text-[14px] font-semibold">Your account</h2>
          <div className="mt-3 flex items-center gap-3 rounded-lg border border-line px-4 py-3">
            <Avatar name={me.user.name} size={32} />
            <div className="text-[13px]">
              <p className="font-medium">{me.user.name}</p>
              <p className="text-ink-3">{me.user.email}</p>
            </div>
          </div>
        </section>
        <section className="rounded-lg border border-dashed border-line px-4 py-4 text-[13px] text-ink-3">
          Team invitations, default design conditions, labor rates and proposal branding will be managed here as those modules ship.
        </section>
      </div>
    </div>
  );
}
