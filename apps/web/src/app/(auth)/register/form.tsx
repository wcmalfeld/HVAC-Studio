"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { auth } from "@/lib/api/endpoints";
import { ApiError, errorMessage, setActiveOrgId } from "@/lib/api/client";
import { qk } from "@/lib/api/queries";

const Schema = z.object({
  name: z.string().trim().min(1, "Enter your name").max(120),
  email: z.string().trim().email("Enter a valid email address"),
  password: z.string().min(10, "Use at least 10 characters"),
  organizationName: z.string().trim().min(1, "Enter your company name").max(120),
});
type Values = z.infer<typeof Schema>;

export function RegisterForm() {
  const router = useRouter();
  const qc = useQueryClient();
  const [formError, setFormError] = React.useState<string | null>(null);
  const { register, handleSubmit, formState, setError } = useForm<Values>({ resolver: zodResolver(Schema) });

  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    try {
      await auth.register(v);
      setActiveOrgId(null);
      qc.removeQueries({ queryKey: qk.me });
      router.replace("/dashboard");
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setError("email", { message: "An account with this email already exists" });
      else setFormError(errorMessage(e));
    }
  });

  const err = formState.errors;
  return (
    <div>
      <h1 className="text-[22px] font-semibold tracking-[-0.02em]">Create your workspace</h1>
      <p className="mt-1 text-[13px] text-ink-3">You&apos;ll be the owner. Invite your team later.</p>
      <form onSubmit={onSubmit} className="mt-7 flex flex-col gap-4" noValidate>
        <Field label="Company name" htmlFor="organizationName" error={err.organizationName?.message}>
          <Input id="organizationName" autoComplete="organization" placeholder="Northside Heating & Air" className="h-9" autoFocus aria-invalid={!!err.organizationName} {...register("organizationName")} />
        </Field>
        <Field label="Your name" htmlFor="name" error={err.name?.message}>
          <Input id="name" autoComplete="name" className="h-9" aria-invalid={!!err.name} {...register("name")} />
        </Field>
        <Field label="Work email" htmlFor="email" error={err.email?.message}>
          <Input id="email" type="email" autoComplete="email" className="h-9" aria-invalid={!!err.email} {...register("email")} />
        </Field>
        <Field label="Password" htmlFor="password" error={err.password?.message} hint="At least 10 characters.">
          <Input id="password" type="password" autoComplete="new-password" className="h-9" aria-invalid={!!err.password} {...register("password")} />
        </Field>
        {formError ? (
          <p role="alert" className="rounded-md border border-danger/25 bg-danger-soft px-3 py-2 text-[13px] text-danger">
            {formError}
          </p>
        ) : null}
        <Button type="submit" variant="primary" size="lg" loading={formState.isSubmitting} className="mt-1 w-full">
          Create account
        </Button>
      </form>
      <p className="mt-6 text-[13px] text-ink-3">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-accent-ink hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
