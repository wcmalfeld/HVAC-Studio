"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Copy, ExternalLink, MoreHorizontal, Trash2, Box } from "lucide-react";
import { toast } from "sonner";
import type { Project } from "@hvac/shared-types";
import { Dropdown, DropdownContent, DropdownItem, DropdownSeparator, DropdownTrigger } from "@/components/ui/dropdown";
import { AlertDialog, AlertDialogContent } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useProjectActions } from "@/lib/api/queries";
import { errorMessage } from "@/lib/api/client";
import { cn } from "@/lib/utils";

export function DeleteProjectDialog({
  project,
  open,
  onOpenChange,
  onDeleted,
}: {
  project: Project;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDeleted?: () => void;
}) {
  const { remove } = useProjectActions();
  const [typed, setTyped] = React.useState("");
  React.useEffect(() => {
    if (open) setTyped("");
  }, [open]);
  const matches = typed.trim() === project.name.trim();
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        title="Delete project"
        description={
          <>
            This permanently deletes <strong className="font-semibold text-ink">{project.name}</strong>, its building model, revision history and uploaded drawings. This can&apos;t be undone.
          </>
        }
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!matches) return;
            try {
              await remove.mutateAsync(project.id);
              toast.success(`Deleted ${project.name}`);
              onOpenChange(false);
              onDeleted?.();
            } catch (err) {
              toast.error(errorMessage(err));
            }
          }}
        >
          <div className="px-5 py-4">
            <label htmlFor="del-confirm" className="text-[12px] font-medium text-ink-2">
              Type the project name to confirm
            </label>
            <Input id="del-confirm" className="mt-1.5" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus autoComplete="off" placeholder={project.name} />
          </div>
          <div className="flex justify-end gap-2 rounded-b-xl border-t border-line bg-surface-2/60 px-5 py-3">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" disabled={!matches} loading={remove.isPending}>
              Delete project
            </Button>
          </div>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function ProjectMenu({ project, className, align = "end" }: { project: Project; className?: string; align?: "start" | "end" }) {
  const router = useRouter();
  const { duplicate, archive, unarchive } = useProjectActions();
  const [del, setDel] = React.useState(false);
  const isArchived = project.status === "archived";
  return (
    <>
      <Dropdown modal={false}>
        <DropdownTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className={cn("data-[state=open]:bg-surface-2", className)}
            aria-label={`Actions for ${project.name}`}
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal />
          </Button>
        </DropdownTrigger>
        <DropdownContent align={align} onClick={(e) => e.stopPropagation()}>
          <DropdownItem onSelect={() => router.push(`/projects/${project.id}`)}>
            <ExternalLink />
            Open
          </DropdownItem>
          <DropdownItem onSelect={() => router.push(`/projects/${project.id}/studio`)}>
            <Box />
            Open in Building Studio
          </DropdownItem>
          <DropdownSeparator />
          <DropdownItem
            onSelect={() =>
              duplicate.mutate(project.id, {
                onSuccess: (p) => toast.success(`Duplicated as ${p.name}`),
                onError: (e) => toast.error(errorMessage(e)),
              })
            }
          >
            <Copy />
            Duplicate
          </DropdownItem>
          {isArchived ? (
            <DropdownItem
              onSelect={() =>
                unarchive.mutate(project.id, {
                  onSuccess: () => toast.success(`Restored ${project.name}`),
                  onError: (e) => toast.error(errorMessage(e)),
                })
              }
            >
              <ArchiveRestore />
              Unarchive
            </DropdownItem>
          ) : (
            <DropdownItem
              onSelect={() =>
                archive.mutate(project.id, {
                  onSuccess: () =>
                    toast.success(`Archived ${project.name}`, {
                      action: { label: "Undo", onClick: () => unarchive.mutate(project.id) },
                    }),
                  onError: (e) => toast.error(errorMessage(e)),
                })
              }
            >
              <Archive />
              Archive
            </DropdownItem>
          )}
          <DropdownSeparator />
          <DropdownItem danger onSelect={() => setDel(true)}>
            <Trash2 />
            Delete…
          </DropdownItem>
        </DropdownContent>
      </Dropdown>
      <DeleteProjectDialog project={project} open={del} onOpenChange={setDel} />
    </>
  );
}
