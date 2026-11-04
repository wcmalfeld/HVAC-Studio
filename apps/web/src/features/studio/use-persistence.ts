"use client";
import * as React from "react";
import { useStore } from "zustand";
import type { BuildingDocument, BuildingModel } from "@hvac/shared-types";
import { building } from "@/lib/api/endpoints";
import { safeLocalStorage } from "@/lib/utils";
import { AutosaveController, initialSaveState, isDirty, type SaveState } from "./autosave";
import type { StudioStores } from "./context";

/**
 * Crash-recovery mirror of the local model. Written on every committed change; cleared when the
 * server has everything. Key per project.
 */
export interface LocalDraft {
  projectId: string;
  /** Server revision the draft was based on. */
  baseRevision: number;
  savedAt: number;
  model: BuildingModel;
}
const draftKey = (projectId: string) => `hvac.draft.${projectId}`;

export function readDraft(projectId: string): LocalDraft | null {
  try {
    const raw = safeLocalStorage()?.getItem(draftKey(projectId));
    if (!raw) return null;
    const d = JSON.parse(raw) as LocalDraft;
    return d && d.model && typeof d.baseRevision === "number" ? d : null;
  } catch {
    return null;
  }
}
export function writeDraft(d: LocalDraft) {
  try {
    safeLocalStorage()?.setItem(draftKey(d.projectId), JSON.stringify(d));
  } catch {
    /* quota exceeded: crash recovery is best effort */
  }
}
export function clearDraft(projectId: string) {
  safeLocalStorage()?.removeItem(draftKey(projectId));
}

/** Should we offer to restore a local draft over the server document? */
export function draftIsRecoverable(draft: LocalDraft | null, doc: BuildingDocument): boolean {
  if (!draft) return false;
  if (draft.baseRevision > doc.revision) return true;
  if (draft.baseRevision < doc.revision) {
    // Someone saved after our draft; still recoverable but it will conflict — offer it, it's the user's work.
    return JSON.stringify(draft.model) !== JSON.stringify(doc.model);
  }
  return JSON.stringify(draft.model) !== JSON.stringify(doc.model);
}

export function usePersistence(stores: StudioStores, doc: BuildingDocument) {
  const { editor, projectId } = stores;
  const [save, setSave] = React.useState<SaveState>(() => initialSaveState(doc.revision));
  // One controller per mounted studio (lazy state init, so it's created exactly once).
  const [ctrl] = React.useState(
    () =>
      new AutosaveController(
        {
          put: (rev, model) => building.put(projectId, rev, model),
          getModel: () => editor.getState().model,
          onChange: (s) => {
            setSave(s);
            if (s.status === "saved" && !isDirty(s)) clearDraft(projectId);
            else if (isDirty(s)) {
              writeDraft({ projectId, baseRevision: s.revision, savedAt: Date.now(), model: editor.getState().model });
            }
          },
        },
        doc.revision,
      ),
  );

  // Every committed model change → autosave + local mirror. Gestures in progress are not committed.
  React.useEffect(() => {
    const unsub = editor.subscribe((s, p) => {
      if (s.version !== p.version) {
        ctrl.edit();
        writeDraft({ projectId, baseRevision: ctrl.state.revision, savedAt: Date.now(), model: s.model });
      }
    });
    return unsub;
  }, [editor, ctrl, projectId]);

  // Online / offline
  React.useEffect(() => {
    const on = () => ctrl.online();
    const off = () => ctrl.offline();
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    if (navigator.onLine === false) ctrl.offline();
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, [ctrl]);

  // beforeunload warning while unsaved; flush on hide
  React.useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (isDirty(ctrl.state)) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    const vis = () => {
      if (document.visibilityState === "hidden" && isDirty(ctrl.state)) void ctrl.flush();
    };
    window.addEventListener("beforeunload", before);
    document.addEventListener("visibilitychange", vis);
    return () => {
      window.removeEventListener("beforeunload", before);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [ctrl]);

  React.useEffect(() => {
    ctrl.activate();
    return () => ctrl.dispose();
  }, [ctrl]);

  const actions = React.useMemo(
    () => ({
      flush: () => ctrl.flush(),
      /** Conflict: discard local, load the server version. */
      reloadTheirs: async () => {
        const fresh = await building.get(projectId);
        editor.getState().load(fresh.model, { keepSelection: true });
        ctrl.reset(fresh.revision);
        clearDraft(projectId);
      },
      /** Conflict: fetch the current revision and save ours on top of it. */
      overwriteMine: async () => {
        const fresh = await building.get(projectId);
        await ctrl.overwrite(fresh.revision);
      },
      /** Restore a crash-recovery draft (marks dirty so it saves). */
      restoreDraft: (d: LocalDraft, serverRevision: number) => {
        editor.getState().load(d.model);
        ctrl.reset(Math.max(serverRevision, 0), true);
      },
      discardDraft: () => clearDraft(projectId),
      /** Replace with a server document (revision restore). */
      adopt: (d: BuildingDocument) => {
        editor.getState().load(d.model);
        ctrl.reset(d.revision);
        clearDraft(projectId);
      },
    }),
    [ctrl, editor, projectId],
  );

  return { save, ...actions };
}

export function useEditorVersion(stores: StudioStores) {
  return useStore(stores.editor, (s) => s.version);
}
