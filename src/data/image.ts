/**
 * Getting a photo down to something worth storing.
 *
 * Every adapter needs the same thing and neither should invent it. The reason
 * this exists at all is that the file a person picks and the file an avatar
 * should be are not the same object: a phone camera hands over three to eight
 * megabytes of 4032x3024, and what gets drawn is a 92px disc. Uploading the
 * original spends a phone's uplink on detail that is thrown away by the first
 * `object-cover`, and storing it spends the bucket's 2 MB limit on one face.
 *
 * The rejected alternative was the one that was here before: check `file.size`
 * against the bucket limit and refuse anything larger. That is not a rule a
 * user can act on - the camera roll does not show file sizes, every modern
 * photo fails it, and "use a smaller image" asks somebody to go and find
 * another app. Normalising is the same limit enforced by doing the work.
 */

/**
 * Edge length of the stored square, in device-independent pixels.
 *
 * 512 rather than the 92 the account header draws: the same file is the source
 * for a 2x display and for whatever the largest avatar in this app becomes, and
 * re-uploading everyone's face to change a number is not a migration anybody
 * wants. At this size the encoded result is tens of kilobytes, so the headroom
 * is close to free.
 */
export const AVATAR_EDGE = 512;

/** Quality for the lossy encoders. High enough that 512px shows no ringing. */
const QUALITY = 0.85;

/**
 * Behind a transparent PNG once it lands in a format without an alpha channel.
 *
 * Mid-grey rather than black, because it sits inside the Avatar disc's own
 * gradient (#34343a -> #232327) and a black square inside a grey circle is the
 * one result that reads as a bug rather than as a photo.
 */
const MATTE = "#2b2b30";

/**
 * A square, downscaled, re-encoded copy of what the user picked.
 *
 * Throws rather than returning null when the image cannot be decoded: the
 * caller has to say something to the user either way, and a null would have to
 * be given a message at every call site instead of one here. The case that
 * actually reaches this is HEIC - an iPhone's default format, which no browser
 * engine decodes - so the message names a way out rather than the fault.
 */
export async function prepareAvatar(file: File): Promise<Blob> {
  const source = await decode(file);
  try {
    const canvas = squareCanvas(source);
    return await encode(canvas);
  } finally {
    // An ImageBitmap holds its pixels outside the JS heap, so it is not the
    // collector's problem until it is closed.
    if ("close" in source) source.close();
  }
}

/** The same bytes as a data URL, for the adapter that has nowhere to put a file. */
export function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("That image could not be read."));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

type Source = ImageBitmap | HTMLImageElement;

/**
 * Decode, honouring the EXIF orientation flag.
 *
 * A photo taken in portrait on a phone is usually stored in landscape with a
 * rotation recorded beside it. `<img>` applies that flag by default; a bare
 * `createImageBitmap` does not, which is how an avatar ends up sideways for
 * exactly the people who took the picture on their phone.
 */
async function decode(file: File): Promise<Source> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // Fall through: some engines reject the options bag rather than the
      // image, and the element path can still decode the file.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () =>
        reject(
          new Error(
            "That image could not be read. If it came from an iPhone, " +
              "it may be HEIC - screenshot it or save it as JPEG first.",
          ),
        );
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Centre-crop to a square and scale to the stored edge.
 *
 * Cropped here rather than left to `object-cover` in CSS, because the stored
 * file is what every other client will draw and only one of them is this app.
 * Never upscales: a 64px source stays 64px rather than being blown up to 512
 * and re-encoded, which would cost bytes to add nothing.
 */
function squareCanvas(source: Source): HTMLCanvasElement {
  const width = "naturalWidth" in source ? source.naturalWidth : source.width;
  const height = "naturalHeight" in source ? source.naturalHeight : source.height;
  if (width === 0 || height === 0) throw new Error("That image is empty.");

  const side = Math.min(width, height);
  const edge = Math.min(AVATAR_EDGE, side);

  const canvas = document.createElement("canvas");
  canvas.width = edge;
  canvas.height = edge;

  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("This device could not process that image.");

  ctx.fillStyle = MATTE;
  ctx.fillRect(0, 0, edge, edge);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, (width - side) / 2, (height - side) / 2, side, side, 0, 0, edge, edge);
  return canvas;
}

/**
 * Encode, preferring WebP.
 *
 * WebP is roughly a third of the JPEG for the same quality and keeps an alpha
 * channel. An engine that cannot encode it does not say so - `toBlob` quietly
 * hands back a PNG instead - so the result's own type is what gets checked,
 * and a PNG of a photograph is large enough to be worth re-encoding as JPEG.
 * All three outcomes are formats the avatars bucket accepts.
 */
async function encode(canvas: HTMLCanvasElement): Promise<Blob> {
  const webp = await toBlob(canvas, "image/webp");
  if (webp.type === "image/webp") return webp;
  return toBlob(canvas, "image/jpeg");
}

function toBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob === null) reject(new Error("That image could not be processed."));
        else resolve(blob);
      },
      type,
      QUALITY,
    );
  });
}
