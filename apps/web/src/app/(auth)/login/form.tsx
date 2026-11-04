"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { auth } from "@/lib/api/endpoints";
import { ApiError, errorMessage } from "@/lib/api/client";
import { qk } from "@/lib/api/queries";
import { safeNext } from "@/lib/safe-next";

const Schema = z.object({
  email: z.string().trim().email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
});
type Values = z.infer<typeof Schema>;


export function LoginForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const qc = useQueryClient();
  const [formError, setFormError] = React.useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<Values>({ resolver: zodResolver(Schema) });

  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    try {
      await auth.login(v);
      qc.removeQueries({ queryKey: qk.me });
      router.replace(safeNext(sp.get("next")));
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 400)) setFormError("That email and password don't match an account.");
      else if (e instanceof ApiError && e.status === 429) setFormError("Too many attempts. Wait a minute and try again.");
      else setFormError(errorMessage(e));
    }
  });

  return (
    <div>
      <h1 className="text-[22px] font-semibold tracking-[-0.02em]">Sign in</h1>
      <p className="mt-1 text-[13px] text-ink-3">Pick up where your team left off.</p>
      <form onSubmit={onSubmit} className="mt-7 flex flex-col gap-4" noValidate>
        <Field label="Work email" htmlFor="email" error={formState.errors.email?.message}>
          <Input id="email" type="email" autoComplete="email" autoFocus className="h-9" aria-invalid={!!formState.errors.email} {...register("email")} />
        </Field>
        <Field label="Password" htmlFor="password" error={formState.errors.password?.message}>
          <Input id="password" type="password" autoComplete="current-password" className="h-9" aria-invalid={!!formState.errors.password} {...register("password")} />
        </Field>
        {formError ? (
          <p role="alert" className="rounded-md border border-danger/25 bg-danger-soft px-3 py-2 text-[13px] text-danger">
            {formError}
          </p>
        ) : null}
        <Button type="submit" variant="primary" size="lg" loading={formState.isSubmitting} className="mt-1 w-full">
          Sign in
        </Button>
      </form>
      <p className="mt-6 text-[13px] text-ink-3">
        New to HVAC Studio?{" "}
        <Link href="/register" className="font-medium text-accent-ink hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}
