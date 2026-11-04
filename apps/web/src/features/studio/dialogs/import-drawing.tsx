"use client";
import * as React from "react";
import { FileUp, FileImage, FileText, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogBody, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Button, Spinner } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { drawings, DRAWING_MAX_BYTES, DRAWING_TYPES } from "@/lib/api/endpoints";
import { errorMessage } from "@/lib/api/client";
import { parseLength } from "@hvac/building-geometry";
import { cn } from "@/lib/utils";
import { blobToImage, openPdf, primeRaster, renderPdfPage, type BackgroundPlacement, type PdfDoc } from "../background";
import { useStudio } from "../context";

/** PDF pages are rasterized at this scale (≈216 dpi) so traced detail survives calibration. */
const PDF_RENDER_SCALE = 3;

type Source =
  | { kind: "image"; img: HTMLImageElement; file: File }
  | { kind: "pdf"; doc: PdfDoc; file: File; pages: number };

/**
 * Import drawing: pick file → preview (choose PDF page) → upload → place on current floor.
 * The initial scale is a guess (1/4" = 1' on a 96-dpi raster) until the user calibrates.
 */
export function ImportDrawingDialog({ open, onOpenChange, onPlaced }: { open: boolean; onOpenChange: (o: boolean) => void; onPlaced: () => void }) {
  const { projectId, editor, background, viewport } = useStudio();
  const [src, setSrc] = React.useState<Source | null>(null);
  const [page, setPage] = React.useState(1);
  const [preview, setPreview] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<null | "reading" | "uploading">(null);
  const [error, setError] = React.useState<string | null>(null);
  const [drag, setDrag] = React.useState(false);
  const [scaleText, setScaleText] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!open) {
      setSrc(null);
      setPage(1);
      setPreview(null);
      setError(null);
      setBusy(null);
      setScaleText("");
    }
  }, [open]);

  // Render preview thumbnail
  React.useEffect(() => {
    let cancelled = false;
    if (!src) return;
    if (src.kind === "image") {
      setPreview(src.img.src);
      return;
    }
    renderPdfPage(src.doc, page, 0.6)
      .then((c) => !cancelled && setPreview(c.toDataURL("image/png")))
      .catch((e) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [src, page]);

  async function pick(file: File) {
    setError(null);
    if (!DRAWING_TYPES.includes(file.type)) {
      setError("Use a PDF, PNG or JPG file. DXF/DWG import comes later.");
      return;
    }
    if (file.size > DRAWING_MAX_BYTES) {
      setError(`That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 25 MB.`);
      return;
    }
    setBusy("reading");
    try {
      if (file.type === "application/pdf") {
        const doc = await openPdf(await file.arrayBuffer());
        setSrc({ kind: "pdf", doc, file, pages: doc.numPages });
        setPage(1);
      } else {
        setSrc({ kind: "image", img: await blobToImage(file), file });
      }
    } catch (e) {
      setError(`Couldn't read ${file.name}: ${errorMessage(e)}`);
    } finally {
      setBusy(null);
    }
  }

  async function place() {
    if (!src) return;
    setBusy("uploading");
    setError(null);
    try {
      const uploaded = await drawings.upload(projectId, src.file);
      let raster: CanvasImageSource & { width: number; height: number };
      let renderScale = 1;
      if (src.kind === "pdf") {
        renderScale = PDF_RENDER_SCALE;
        raster = await renderPdfPage(src.doc, page, renderScale);
      } else {
        raster = src.img;
      }
      // Default scale guess: for PDFs, assume 1/4" = 1' (1 PDF point = 1/72"; 1/4" paper = 12" real
      // → 1 pt = 0.6667"), divided by render scale. For images, assume 96 dpi at 1/4" = 1'.
      let inchesPerPixel = src.kind === "pdf" ? 48 / 72 / renderScale : 48 / 96;
      const typed = scaleText.trim() ? parseLength(scaleText, editor.getState().model.displayUnits) : null;
      if (typed && typed > 0) inchesPerPixel = typed / raster.width; // "image width is X"
      const v = viewport.getState();
      const center = { x: (v.width / 2 - v.ox) / (v.zoom), y: (v.oy - v.height / 2) / v.zoom };
      const w = raster.width * inchesPerPixel, h = raster.height * inchesPerPixel;
      const placement: BackgroundPlacement = {
        drawingId: uploaded.id,
        filename: uploaded.filename ?? src.file.name,
        contentType: uploaded.contentType ?? src.file.type,
        page: src.kind === "pdf" ? page : 1,
        renderScale,
        pixelWidth: raster.width,
        pixelHeight: raster.height,
        origin: { x: Math.round(center.x - w / 2), y: Math.round(center.y + h / 2) },
        inchesPerPixel,
        calibrated: false,
        calibration: null,
        opacity: 0.55,
        locked: true,
      };
      primeRaster(placement, raster);
      const floorId = editor.getState().floorId;
      background.getState().set(floorId, placement);
      editor.getState().setLayer("background", true);
      toast.success("Drawing placed. Calibrate it before tracing.");
      onOpenChange(false);
      onPlaced();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Import drawing" description="Place a floor plan under the current floor to trace over it." className="max-w-[600px]">
        <DialogBody>
          {!src ? (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                const f = e.dataTransfer.files[0];
                if (f) void pick(f);
              }}
              className={cn(
                "flex h-[240px] flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-line-strong bg-surface-2/50 text-center transition-colors",
                drag && "border-accent bg-accent-soft",
              )}
            >
              {busy === "reading" ? (
                <Spinner className="size-5 text-ink-3" />
              ) : (
                <>
                  <div className="flex size-10 items-center justify-center rounded-lg border border-line bg-surface text-ink-3 shadow-sm">
                    <FileUp className="size-5" />
                  </div>
                  <div>
                    <p className="text-[13px] font-medium">Drop a PDF, PNG or JPG here</p>
                    <p className="mt-0.5 text-[12px] text-ink-3">Up to 25 MB. Multi-page PDFs let you choose the sheet.</p>
                  </div>
                  <Button size="sm" onClick={() => inputRef.current?.click()}>
                    Choose file
                  </Button>
                </>
              )}
              <input
                ref={inputRef}
                type="file"
                accept="application/pdf,image/png,image/jpeg"
                className="sr-only"
                data-testid="drawing-input"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void pick(f);
                  e.target.value = "";
                }}
              />
            </div>
          ) : (
            <div className="grid grid-cols-[minmax(0,1fr)_200px] gap-4">
              <div className="flex h-[300px] items-center justify-center overflow-hidden rounded-lg border border-line bg-[repeating-conic-gradient(var(--surface-2)_0_25%,var(--surface)_0_50%)] bg-[length:16px_16px]">
                {preview ? <img src={preview} alt="Drawing preview" className="max-h-full max-w-full object-contain shadow-sm" /> : <Spinner className="size-5 text-ink-3" />}
              </div>
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2 text-[12.5px]">
                  {src.kind === "pdf" ? <FileText className="size-4 text-ink-3" /> : <FileImage className="size-4 text-ink-3" />}
                  <span className="min-w-0 flex-1 truncate font-medium" title={src.file.name}>
                    {src.file.name}
                  </span>
                </div>
                {src.kind === "pdf" ? (
                  <div>
                    <p className="text-[12px] font-medium text-ink-2">Page</p>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <Button size="icon-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">
                        <ChevronLeft />
                      </Button>
                      <span className="flex-1 text-center text-[12.5px] tnum">
                        {page} of {src.pages}
                      </span>
                      <Button size="icon-sm" disabled={page >= src.pages} onClick={() => setPage((p) => p + 1)} aria-label="Next page">
                        <ChevronRight />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-[12px] text-ink-3 tnum">
                    {src.img.naturalWidth} × {src.img.naturalHeight} px
                  </p>
                )}
                <Field label="Drawing width (optional)" hint="Real width the whole sheet represents. You can calibrate precisely after placing.">
                  <Input value={scaleText} onChange={(e) => setScaleText(e.target.value)} placeholder={`e.g. 60'`} className="h-7" />
                </Field>
                <Button size="sm" variant="ghost" onClick={() => setSrc(null)}>
                  Choose a different file
                </Button>
              </div>
            </div>
          )}
          {error ? (
            <p role="alert" className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-[12.5px] text-danger">
              {error}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <p className="mr-auto text-[11.5px] text-ink-4">Placement is saved in this browser for now.</p>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!src} loading={busy === "uploading"} onClick={() => void place()}>
            Place on floor
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
