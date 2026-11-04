/**
 * Autosave controller for the building document.
 *
 * Optimistic concurrency (ADR-002): every PUT carries the revision the edit was based on.
 * State machine:
 *
 *   saved ──edit──▶ unsaved ──debounce──▶ saving ──ok──▶ saved | unsaved (edited meanwhile → reschedule)
 *                                           │
 *                                           ├─409 revision_conflict──▶ conflict  (stops autosaving until resolved)
 *                                           ├─network error──────────▶ offline   (retries with backoff / on reconnect)
 *                                           └─other error────────────▶ error     (retries with backoff)
 *
 * The controller is framework-free so the transitions can be unit tested with fake timers.
 */
import type { BuildingDocument, BuildingModel } from "@hvac/shared-types";
import { ApiError, NetworkError } from "@/lib/api/client";

export type SaveStatus = "saved" | "unsaved" | "saving" | "offline" | "conflict" | "invalid" | "error";

/** One server-side validation failure (422 invalid_building_model), loc like ["model","walls",0,"thickness"]. */
export interface ServerIssue {
  loc: (string | number)[];
  message: string;
}

export interface SaveState {
  status: SaveStatus;
  /** Server revision our local model is based on. */
  revision: number;
  /** Local edit counter and the counter value last persisted. */
  localVersion: number;
  savedVersion: number;
  lastSavedAt: number | null;
  conflict: { currentRevision: number | null } | null;
  error: string | null;
  /** Populated when the server rejected the model as invalid; cleared by the next successful save. */
  serverIssues: ServerIssue[];
}

export const initialSaveState = (revision: number): SaveState => ({
  status: "saved",
  revision,
  localVersion: 0,
  savedVersion: 0,
  lastSavedAt: null,
  conflict: null,
  error: null,
  serverIssues: [],
});

export type SaveEvent =
  | { type: "edit" }
  | { type: "start" }
  | { type: "success"; revision: number; version: number; at: number }
  | { type: "conflict"; currentRevision: number | null }
  | { type: "network" }
  | { type: "failure"; message: string }
  | { type: "invalid"; message: string; issues: ServerIssue[] }
  | { type: "online" }
  | { type: "reset"; revision: number; dirty?: boolean };

export function saveReducer(s: SaveState, e: SaveEvent): SaveState {
  switch (e.type) {
    case "edit": {
      const localVersion = s.localVersion + 1;
      // While conflicted/saving we keep that status; edits are still tracked.
      // While conflicted/saving/offline we keep that status; edits are still tracked. An edit after a
      // 422 makes the model eligible for another attempt (the user may have fixed the problem).
      const status: SaveStatus = s.status === "conflict" || s.status === "saving" || s.status === "offline" ? s.status : "unsaved";
      return { ...s, localVersion, status };
    }
    case "start":
      if (s.status === "conflict") return s;
      return { ...s, status: "saving", error: null };
    case "success": {
      const savedVersion = Math.max(s.savedVersion, e.version);
      return {
        ...s,
        revision: e.revision,
        savedVersion,
        lastSavedAt: e.at,
        status: savedVersion >= s.localVersion ? "saved" : "unsaved",
        error: null,
        conflict: null,
        serverIssues: [],
      };
    }
    case "conflict":
      return { ...s, status: "conflict", conflict: { currentRevision: e.currentRevision } };
    case "network":
      return { ...s, status: "offline" };
    case "online":
      return s.status === "offline" ? { ...s, status: s.localVersion > s.savedVersion ? "unsaved" : "saved" } : s;
    case "failure":
      return { ...s, status: "error", error: e.message };
    case "invalid":
      return { ...s, status: "invalid", error: e.message, serverIssues: e.issues };
    case "reset":
      return { ...initialSaveState(e.revision), localVersion: e.dirty ? 1 : 0, status: e.dirty ? "unsaved" : "saved" };
  }
}

export const isDirty = (s: SaveState) => s.localVersion > s.savedVersion;

/** Normalize 422 details (Pydantic-style list of {loc,msg|message}) into ServerIssues. */
export function parseServerIssues(details: unknown): ServerIssue[] {
  if (!Array.isArray(details)) return [];
  return details
    .filter((d): d is Record<string, unknown> => !!d && typeof d === "object")
    .map((d) => ({
      loc: Array.isArray(d.loc) ? (d.loc as (string | number)[]) : [],
      message: String(d.msg ?? d.message ?? "Invalid value"),
    }));
}

/**
 * Map a server loc (["model","walls",0,"thickness"]) to the entity id it refers to, so the issues
 * panel can select it. Returns null for model-level paths.
 */
export function entityIdForLoc(model: BuildingModel, loc: (string | number)[]): string | null {
  const i = loc[0] === "model" ? 1 : 0;
  const coll = loc[i];
  const idx = loc[i + 1];
  if (typeof idx !== "number") return null;
  if (coll === "walls") return model.walls[idx]?.id ?? null;
  if (coll === "openings") return model.openings[idx]?.id ?? null;
  if (coll === "rooms") return model.rooms[idx]?.id ?? null;
  if (coll === "floors") return model.floors[idx]?.id ?? null;
  return null;
}

export interface AutosaveDeps {
  put: (revision: number, model: BuildingModel) => Promise<BuildingDocument>;
  getModel: () => BuildingModel;
  onChange: (s: SaveState) => void;
  debounceMs?: number;
  now?: () => number;
}

export class AutosaveController {
  state: SaveState;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private retryMs = 2000;
  private inflight: Promise<void> | null = null;
  private disposed = false;
  private readonly debounceMs: number;
  private readonly now: () => number;

  constructor(
    private deps: AutosaveDeps,
    revision: number,
  ) {
    this.state = initialSaveState(revision);
    this.debounceMs = deps.debounceMs ?? 1500;
    this.now = deps.now ?? Date.now;
  }

  private dispatch(e: SaveEvent) {
    this.state = saveReducer(this.state, e);
    this.deps.onChange(this.state);
  }

  /** Call after every committed model change. */
  edit() {
    this.dispatch({ type: "edit" });
    if (this.state.status === "unsaved") this.schedule(this.debounceMs);
  }

  reset(revision: number, dirty = false) {
    this.clearTimer();
    this.dispatch({ type: "reset", revision, dirty });
    if (dirty) this.schedule(this.debounceMs);
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(ms: number) {
    if (this.disposed) return;
    this.clearTimer();
    this.timer = setTimeout(() => void this.flush(), ms);
  }

  /** Save now if there are unsaved changes. Resolves when the attempt settles. */
  async flush(): Promise<void> {
    this.clearTimer();
    if (this.disposed) return;
    if (this.inflight) {
      await this.inflight;
      if (isDirty(this.state) && this.state.status === "unsaved") return this.flush();
      return;
    }
    if (!isDirty(this.state) || this.state.status === "conflict") return;
    const version = this.state.localVersion;
    const model = this.deps.getModel();
    this.dispatch({ type: "start" });
    this.inflight = (async () => {
      try {
        const doc = await this.deps.put(this.state.revision, model);
        this.retryMs = 2000;
        this.dispatch({ type: "success", revision: doc.revision, version, at: this.now() });
        if (this.state.status === "unsaved") this.schedule(this.debounceMs);
      } catch (e) {
        if (e instanceof ApiError && e.status === 422) {
          // The model itself is invalid: retrying the same payload can't succeed. Wait for the next edit.
          this.dispatch({ type: "invalid", message: e.message, issues: parseServerIssues(e.details) });
        } else if (e instanceof ApiError && e.status === 409) {
          const d = e.details as { currentRevision?: number } | undefined;
          this.dispatch({ type: "conflict", currentRevision: typeof d?.currentRevision === "number" ? d.currentRevision : null });
        } else if (e instanceof NetworkError || (typeof navigator !== "undefined" && navigator.onLine === false)) {
          this.dispatch({ type: "network" });
          this.schedule(this.backoff());
        } else {
          this.dispatch({ type: "failure", message: e instanceof Error ? e.message : "Save failed" });
          this.schedule(this.backoff());
        }
      } finally {
        this.inflight = null;
      }
    })();
    await this.inflight;
  }

  private backoff() {
    const ms = this.retryMs;
    this.retryMs = Math.min(30_000, this.retryMs * 2);
    return ms;
  }

  online() {
    this.dispatch({ type: "online" });
    if (isDirty(this.state)) this.schedule(250);
  }

  offline() {
    if (this.state.status !== "conflict") this.dispatch({ type: "network" });
  }

  /**
   * Resolve a conflict by overwriting: adopt the server's current revision and immediately save
   * the local model on top of it.
   */
  async overwrite(currentRevision: number) {
    this.state = { ...this.state, status: "unsaved", revision: currentRevision, conflict: null, localVersion: Math.max(this.state.localVersion, this.state.savedVersion + 1) };
    this.deps.onChange(this.state);
    await this.flush();
  }

  /**
   * (Re)activate after mount. React StrictMode (dev) runs effect cleanups and then re-runs effects on
   * the same component instance, so a controller held in state must be revivable after dispose(),
   * otherwise autosave silently stops forever. Reschedules pending work.
   */
  activate() {
    if (!this.disposed) return;
    this.disposed = false;
    if (isDirty(this.state) && this.state.status === "unsaved") this.schedule(this.debounceMs);
  }

  dispose() {
    this.disposed = true;
    this.clearTimer();
  }
}
