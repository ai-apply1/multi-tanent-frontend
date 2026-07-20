/**
 * Crop fully-transparent padding off an uploaded logo, in the browser, before
 * it is PUT to S3.
 *
 * WHY THIS EXISTS. Every render site bounds the logo to a fixed box and uses
 * `object-contain`, which fits the image's WHOLE CANVAS — baked-in transparent
 * margins included. The browser only sees the outer rectangle, so padding
 * inside the file is invisible to CSS and no styling can compensate for it.
 * Two real tenants, same CSS:
 *
 *   cropped tight   368 x 72,    ink 100% of height -> renders 208 x 41 in a 44px box
 *   heavily padded  3000 x 1500, ink  43% of height -> renders  76 x 19 in the same box
 *
 * The second one is 57% empty space and looks broken next to the first. That
 * is not a layout bug to fix downstream, it is a bad source file, and the only
 * durable fix is to normalise it at the point of upload rather than trust every
 * customer to export correctly forever.
 *
 * Deliberately conservative — it returns the ORIGINAL `File` untouched unless
 * there is genuinely something to crop:
 *
 *   - SVG is skipped. It is a vector; rasterising to trim it would throw away
 *     the resolution independence that made it the better upload.
 *   - Anything with no alpha channel (JPEG) has no transparent margin by
 *     definition, and re-encoding would only cost a generation of quality.
 *   - If the ink already reaches all four edges, the file is returned as-is, so
 *     a well-made logo is never re-encoded.
 *   - Any failure (a decode error, a tainted canvas, an unreadable file) falls
 *     back to the original. A logo that uploads slightly padded beats a logo
 *     that fails to upload.
 */

/**
 * Alpha below this counts as "empty". Not zero: PNG exporters leave a halo of
 * 1-3 alpha antialiasing around artwork, which would defeat a `> 0` test and
 * crop nothing. Low enough that it can't eat a faint but real part of a mark.
 */
const ALPHA_FLOOR = 8;

/** Only these can meaningfully carry a transparent margin. */
const TRIMMABLE_TYPES = ["image/png", "image/webp"];

export interface TrimResult {
  /** The file to upload — the original when nothing was cropped. */
  file: File;
  /** True when pixels were actually removed. */
  trimmed: boolean;
  /** Height the ink occupied, as a share of the original canvas (0-1). */
  inkHeightRatio: number;
}

export async function trimTransparentEdges(file: File): Promise<TrimResult> {
  const untouched: TrimResult = { file, trimmed: false, inkHeightRatio: 1 };
  if (!TRIMMABLE_TYPES.includes(file.type)) return untouched;

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;
    if (!width || !height) return untouched;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    // `willReadFrequently` keeps this on the CPU path; we do exactly one big
    // readback and never composite, so the GPU round-trip is pure overhead.
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return untouched;
    ctx.drawImage(bitmap, 0, 0);

    const { data } = ctx.getImageData(0, 0, width, height);
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y++) {
      const row = y * width * 4;
      for (let x = 0; x < width; x++) {
        if (data[row + x * 4 + 3] > ALPHA_FLOOR) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    // Fully transparent, or already flush to every edge: nothing to gain.
    if (maxX < 0 || (minX === 0 && minY === 0 && maxX === width - 1 && maxY === height - 1)) {
      return untouched;
    }

    const cropW = maxX - minX + 1;
    const cropH = maxY - minY + 1;
    const out = document.createElement("canvas");
    out.width = cropW;
    out.height = cropH;
    const outCtx = out.getContext("2d");
    if (!outCtx) return untouched;
    outCtx.drawImage(bitmap, minX, minY, cropW, cropH, 0, 0, cropW, cropH);

    const blob = await new Promise<Blob | null>((resolve) =>
      out.toBlob(resolve, "image/png"),
    );
    if (!blob) return untouched;

    // Always PNG out: the crop needs an alpha-capable lossless format, and a
    // WebP source re-encoded to PNG is still smaller than the padding it shed.
    const name = file.name.replace(/\.[^.]+$/, "") + ".png";
    return {
      file: new File([blob], name, { type: "image/png" }),
      trimmed: true,
      inkHeightRatio: cropH / height,
    };
  } catch {
    return untouched;
  } finally {
    bitmap?.close();
  }
}
