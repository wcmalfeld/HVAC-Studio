"use client";
import * as React from "react";
import { Search, X } from "lucide-react";
import type { ProjectStatus, WorkflowStage } from "@hvac/shared-types";
import { Input, Select } from "@/components/ui/input";
import { STAGE_LABEL, STAGE_ORDER, STATUS_LABEL, STATUS_ORDER } from "@/lib/labels";
import { Button } from "@/components/ui/button";

export interface FilterState {
  q: string;
  status: ProjectStatus | "";
  stage: WorkflowStage | "";
}

export function ProjectFilters({ value, onChange }: { value: FilterState; onChange: (v: FilterState) => void }) {
  const active = value.q || value.status || value.stage;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-[220px] flex-1 sm:max-w-[320px]">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-4" />
        <Input
          type="search"
          value={value.q}
          onChange={(e) => onChange({ ...value, q: e.target.value })}
          placeholder="Search projects, customers, addresses"
          className="pl-8"
          aria-label="Search projects"
        />
      </div>
      <Select
        value={value.status}
        onChange={(e) => onChange({ ...value, status: e.target.value as FilterState["status"] })}
        className="w-auto min-w-[150px]"
        aria-label="Filter by status"
      >
        <option value="">All statuses</option>
        {STATUS_ORDER.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABEL[s]}
          </option>
        ))}
      </Select>
      <Select
        value={value.stage}
        onChange={(e) => onChange({ ...value, stage: e.target.value as FilterState["stage"] })}
        className="w-auto min-w-[140px]"
        aria-label="Filter by workflow stage"
      >
        <option value="">All stages</option>
        {STAGE_ORDER.map((s) => (
          <option key={s} value={s}>
            {STAGE_LABEL[s]}
          </option>
        ))}
      </Select>
      {active ? (
        <Button variant="ghost" size="sm" onClick={() => onChange({ q: "", status: "", stage: "" })}>
          <X />
          Clear
        </Button>
      ) : null}
    </div>
  );
}

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
