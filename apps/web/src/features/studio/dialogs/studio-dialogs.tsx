"use client";
import * as React from "react";
import type { Point } from "@hvac/shared-types";
import { dist, formatLength, parseLength } from "@hvac/building-geometry";
import { AlertTriangle, CloudOff, Download, RotateCcw, Upload } from "lucide-react";
import { Dialog, DialogBody, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/misc";
import { cn, isMac, relativeTime } from "@/lib/utils";
import { calibrationQuality } from "../background";
import { useStudio } from "../context";

// ---------------------------------------------------------------------------
// Calibrate
// ---------------------------------------------------------------------------
export function CalibrateDialog({ points, onClose, onCalibrated }: { points: { a: Point; b: Point } | null; onClose: () => void; onCalibrated?: () => void }) {
  const { editor, background } = useStudio();
  const [text, setText] = React.useState("");
  const [err, setErr] = React.useState<string | null>(null);
  const units = editor.getState().model.displayUnits;
  const floorId = editor.getState().floorId;
  const bg = background.getState().byFloor[floorId];
  React.useEffect(() => {
    setText("");
    setErr(null);
  }, [points]);
  if (!points || !bg) return null;
  // Distance between the clicked points in IMAGE PIXELS (plan distance / current inches-per-pixel).
  const pixelDistance = dist(points.a, points.b) / bg.inchesPerPixel;
  const real = parseLength(text, units);
  const nextIpp = real && pixelDistance > 0 ? real / pixelDistance : null;
  const q = nextIpp ? calibrationQuality(nextIpp) : null;

  const apply = () => {
    if (!real || !nextIpp) {
      setErr(`Enter the real distance, like 12' 6" or 3.81m.`);
      return;
    }
    if (pixelDistance < 20) {
      setErr("Those points are too close together on the drawing. Pick two points farther apart for an accurate scale.");
      return;
    }
    // Keep point A fixed on the plan while rescaling around it.
    const k = nextIpp / bg.inchesPerPixel;
    const a = points.a;
    const origin = { x: a.x + (bg.origin.x - a.x) * k, y: a.y + (bg.origin.y - a.y) * k };
    background.getState().update(floorId, { inchesPerPixel: nextIpp, origin, calibrated: true, calibration: { realInches: real, pixelDistance } });
    onClose();
    onCalibrated?.();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Calibrate drawing scale" description="Enter the real-world distance between the two points you picked.">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            apply();
          }}
        >
          <DialogBody className="flex flex-col gap-3">
            <Field label="Real distance" error={err ?? undefined}>
              <Input autoFocus value={text} onChange={(e) => (setText(e.target.value), setErr(null))} placeholder={units === "imperial" ? `e.g. 24' 6"` : "e.g. 7.47m"} aria-label="Real distance" />
            </Field>
            <dl className="grid grid-cols-2 gap-y-1 rounded-md bg-surface-2 px-3 py-2 text-[12px] tnum">
              <dt className="text-ink-3">Span on drawing</dt>
              <dd className="text-right">{pixelDistance.toFixed(1)} px</dd>
              <dt className="text-ink-3">Resulting scale</dt>
              <dd className="text-right">{nextIpp ? `1 px = ${nextIpp.toFixed(3)}"` : "—"}</dd>
              <dt className="text-ink-3">Resolution</dt>
              <dd className="text-right">{q ? `${q.pixelsPerFoot.toFixed(1)} px per foot` : "—"}</dd>
            </dl>
            {q?.insufficient ? (
              <p className="flex gap-2 rounded-md bg-danger-soft px-3 py-2 text-[12px] text-danger" role="alert">
                <AlertTriangle className="mt-px size-3.5 shrink-0" />
                Insufficient clarity: each image pixel covers more than 1&quot; of the building. Traced dimensions may be off by inches. Use a higher-resolution scan or PDF.
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary">
              Set scale
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Conflict
// ---------------------------------------------------------------------------
export function ConflictDialog({
  open,
  currentRevision,
  onReload,
  onOverwrite,
  onDownload,
}: {
  open: boolean;
  currentRevision: number | null;
  onReload: () => Promise<void>;
  onOverwrite: () => Promise<void>;
  onDownload: () => void;
}) {
  const [busy, setBusy] = React.useState<null | "reload" | "overwrite">(null);
  return (
    <Dialog open={open}>
      <DialogContent
        hideClose
        title="This building was changed somewhere else"
        description={`Someone saved a newer version${currentRevision !== null ? ` (revision ${currentRevision})` : ""} in another tab or on another device. Your changes since then haven't been saved.`}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogBody className="flex flex-col gap-2">
          <ChoiceButton
            icon={<RotateCcw />}
            title="Load their version"
            body="Discard your unsaved changes and continue from the latest saved version."
            loading={busy === "reload"}
            onClick={async () => {
              setBusy("reload");
              try {
                await onReload();
              } finally {
                setBusy(null);
              }
            }}
          />
          <ChoiceButton
            icon={<Upload />}
            title="Keep mine"
            body="Save your version over theirs. Their changes stay in revision history."
            loading={busy === "overwrite"}
            onClick={async () => {
              setBusy("overwrite");
              try {
                await onOverwrite();
              } finally {
                setBusy(null);
              }
            }}
          />
          <ChoiceButton icon={<Download />} title="Download mine as JSON" body="Keep a copy of your version before deciding." onClick={onDownload} />
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

function ChoiceButton({ icon, title, body, onClick, loading }: { icon: React.ReactNode; title: string; body: string; onClick: () => void; loading?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="flex items-start gap-3 rounded-lg border border-line px-3 py-2.5 text-left transition-colors hover:border-line-strong hover:bg-surface-2 disabled:opacity-60"
    >
      <span className="mt-0.5 text-ink-3 [&_svg]:size-4">{icon}</span>
      <span>
        <span className="block text-[13px] font-medium">{loading ? `${title}…` : title}</span>
        <span className="block text-[12px] text-ink-3">{body}</span>
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Restore unsaved draft
// ---------------------------------------------------------------------------
export function RestoreDraftDialog({ savedAt, onRestore, onDiscard }: { savedAt: number; onRestore: () => void; onDiscard: () => void }) {
  return (
    <Dialog open>
      <DialogContent
        hideClose
        title="Restore unsaved changes?"
        description={`This browser has changes from ${relativeTime(new Date(savedAt))} that never reached the server.`}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogBody>
          <p className="flex gap-2 text-[12.5px] text-ink-2">
            <CloudOff className="mt-0.5 size-4 shrink-0 text-warn" />
            Restoring replaces the saved version with your local copy and saves it. Discarding deletes the local copy.
          </p>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onDiscard}>
            Discard local changes
          </Button>
          <Button variant="primary" onClick={onRestore}>
            Restore unsaved changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Shortcuts
// ---------------------------------------------------------------------------
const MOD = () => (isMac() ? "⌘" : "Ctrl");
export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const m = MOD();
  const groups: { title: string; items: [string, string[]][] }[] = [
    {
      title: "Tools",
      items: [
        ["Select", ["V"]],
        ["Wall", ["W"]],
        ["Rectangle room", ["B"]],
        ["Room from walls", ["F"]],
        ["Polygon room", ["P"]],
        ["Window", ["N"]],
        ["Door", ["D"]],
        ["Measure", ["M"]],
        ["Pan", ["H"]],
      ],
    },
    {
      title: "Edit",
      items: [
        ["Undo", [m, "Z"]],
        ["Redo", [m, "Shift", "Z"]],
        ["Copy / paste", [m, "C / V"]],
        ["Cut", [m, "X"]],
        ["Select all on floor", [m, "A"]],
        ["Delete", ["Del"]],
        ["Rotate 90°", ["R"]],
        ["Nudge 1\" / 1'", ["←↑→↓", "Shift"]],
        ["Cancel / deselect", ["Esc"]],
      ],
    },
    {
      title: "Drawing",
      items: [
        ["Type exact length", ["12' 6\"", "Enter"]],
        ["Finish wall chain", ["Enter"]],
        ["Disable angle & grid snap", ["Shift"]],
        ["Toggle snapping", ["S"]],
        ["Toggle grid", ["G"]],
      ],
    },
    {
      title: "View",
      items: [
        ["Pan", ["Space", "drag"]],
        ["Zoom", ["Scroll"]],
        ["Zoom to fit", ["Shift", "1"]],
        ["Zoom in / out", ["+", "−"]],
        ["Actual size", [m, "0"]],
        ["Shortcuts", ["?"]],
      ],
    },
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Keyboard shortcuts" className="max-w-[680px]">
        <DialogBody className="grid grid-cols-2 gap-x-8 gap-y-5">
          {groups.map((g) => (
            <div key={g.title}>
              <h4 className="mb-1.5 text-[12px] font-semibold text-ink-3">{g.title}</h4>
              <ul>
                {g.items.map(([label, keys]) => (
                  <li key={label} className="flex h-7 items-center justify-between gap-3 text-[12.5px]">
                    <span className="text-ink-2">{label}</span>
                    <span className="flex gap-1">
                      {keys.map((k) => (
                        <Kbd key={k}>{k}</Kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

export { formatLength, cn };
