/**
 * Make a photograph small enough to actually arrive.
 *
 * A modern handset photographs at twelve megapixels and four megabytes. Twilio
 * will accept that; the carriers mostly will not. The failure is the bad kind
 * -- no error, no bounce, the message shows as delivered and the picture is
 * simply not on the tenant's phone. So the shrinking happens here, in the
 * browser, before a single byte crosses the network.
 *
 * It also makes the upload itself fast, which matters more than it sounds:
 * the person doing this is often standing in a driveway on one bar.
 *
 * Browser-only. Every API used here is a DOM API, and calling it from the
 * server would throw rather than degrade.
 */

/** Wide enough that a crack in a wall is still legible, small enough that a
 *  carrier will carry it. */
const MAX_EDGE = 1600;

/** Under what the meanest carrier cuts off. Quality steps down until the
 *  result fits, because a slightly softer photograph that arrives beats a
 *  crisp one that does not. */
const TARGET_BYTES = 550 * 1024;

const QUALITIES = [0.82, 0.7, 0.58, 0.45];

/** True for the things worth re-encoding. A PDF or a spreadsheet is passed
 *  through untouched -- there is nothing to downscale and re-encoding it
 *  would destroy it. GIFs are skipped because a canvas keeps one frame of an
 *  animation and throws the rest away. */
function worthShrinking(file: File): boolean {
  return file.type === "image/jpeg" || file.type === "image/png"
    || file.type === "image/webp";
}

export async function shrink(file: File): Promise<File> {
  if (!worthShrinking(file)) return file;
  // Already small enough and already a JPEG: nothing to gain, and re-encoding
  // would only lose a generation.
  if (file.size <= TARGET_BYTES && file.type === "image/jpeg") return file;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();

    let best: Blob | null = null;
    for (const q of QUALITIES) {
      const blob = await new Promise<Blob | null>((res) =>
        canvas.toBlob(res, "image/jpeg", q));
      if (!blob) break;
      best = blob;
      if (blob.size <= TARGET_BYTES) break;
    }
    // If every attempt came out bigger than the original -- which happens with
    // a small flat PNG, where JPEG is the wrong format -- keep the original.
    if (!best || best.size >= file.size) return file;

    const name = file.name.replace(/\.[^.]*$/, "") + ".jpg";
    return new File([best], name, { type: "image/jpeg", lastModified: Date.now() });
  } catch {
    // A format this browser cannot decode. Send it as it came and let the
    // server decide whether it is acceptable; failing to shrink is not a
    // reason to fail to send.
    return file;
  }
}
