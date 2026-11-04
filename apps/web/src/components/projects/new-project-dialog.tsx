"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { ProjectType } from "@hvac/shared-types";
import { Dialog, DialogBody, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { TYPE_LABEL } from "@/lib/labels";
import { useCreateProject } from "@/lib/api/queries";
import { errorMessage } from "@/lib/api/client";

const opt = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));
const Schema = z.object({
  name: z.string().trim().min(1, "Give the project a name").max(200),
  address: opt(400),
  projectType: ProjectType,
  customerName: opt(200),
  customerEmail: z.string().trim().email("Enter a valid email").optional().or(z.literal("")),
  customerPhone: opt(40),
  sample: z.boolean(),
});
type Values = z.infer<typeof Schema>;

const nz = (s?: string) => (s && s.trim() ? s.trim() : null);

export function NewProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const create = useCreateProject();
  const { register, handleSubmit, formState, reset, watch, setValue } = useForm<Values>({
    resolver: zodResolver(Schema),
    defaultValues: { name: "", address: "", projectType: "replacement", customerName: "", customerEmail: "", customerPhone: "", sample: false },
  });
  React.useEffect(() => {
    if (open) reset();
  }, [open, reset]);
  const sample = watch("sample");

  const onSubmit = handleSubmit(async (v) => {
    try {
      const cName = nz(v.customerName);
      const p = await create.mutateAsync({
        name: v.name.trim(),
        address: nz(v.address),
        projectType: v.projectType,
        customer: cName
          ? { name: cName, email: nz(v.customerEmail), phone: nz(v.customerPhone), address: nz(v.address) }
          : null,
        ...(v.sample ? { sample: true } : {}),
      });
      toast.success(`Created ${p.name}`);
      onOpenChange(false);
      router.push(`/projects/${p.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  });
  const e = formState.errors;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="New project" description="You can change any of this later." className="max-w-[540px]">
        <form onSubmit={onSubmit} noValidate>
          <DialogBody className="grid grid-cols-2 gap-x-3 gap-y-4">
            <Field label="Project name" htmlFor="np-name" error={e.name?.message} className="col-span-2">
              <Input id="np-name" autoFocus placeholder="Henderson residence – heat pump retrofit" aria-invalid={!!e.name} {...register("name")} />
            </Field>
            <Field label="Building address" htmlFor="np-address" className="col-span-2">
              <Input id="np-address" placeholder="Street, city, state" autoComplete="street-address" {...register("address")} />
            </Field>
            <Field label="Project type" htmlFor="np-type" className="col-span-2 sm:col-span-1">
              <Select id="np-type" {...register("projectType")}>
                {ProjectType.options.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABEL[t]}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="col-span-2 mt-1 border-t border-line pt-4">
              <p className="text-[12.5px] font-semibold text-ink">Customer</p>
              <p className="text-[12px] text-ink-3">Optional — add it now or when you write the proposal.</p>
            </div>
            <Field label="Name" htmlFor="np-cname" className="col-span-2">
              <Input id="np-cname" autoComplete="off" {...register("customerName")} />
            </Field>
            <Field label="Email" htmlFor="np-cemail" error={e.customerEmail?.message} className="col-span-2 sm:col-span-1">
              <Input id="np-cemail" type="email" autoComplete="off" aria-invalid={!!e.customerEmail} {...register("customerEmail")} />
            </Field>
            <Field label="Phone" htmlFor="np-cphone" className="col-span-2 sm:col-span-1">
              <Input id="np-cphone" type="tel" autoComplete="off" {...register("customerPhone")} />
            </Field>
            <label className="col-span-2 mt-1 flex cursor-pointer items-start gap-3 rounded-lg border border-line bg-surface-2/50 p-3 hover:border-line-strong">
              <Switch checked={sample} onCheckedChange={(c) => setValue("sample", c)} className="mt-0.5" aria-label="Start from sample house" />
              <span>
                <span className="block text-[13px] font-medium">Start from sample house</span>
                <span className="block text-[12px] text-ink-3">
                  Opens with a modeled single-story home so you can explore Building Studio right away.
                </span>
              </span>
            </label>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={formState.isSubmitting}>
              Create project
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
