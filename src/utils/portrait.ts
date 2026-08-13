/**
 * Portrait images are stored as data URLs ON the character, which means they
 * ride along everywhere the character goes: the persisted library
 * (`dnd_cm_library_v1`), every snapshot taken of that character (up to 30), the
 * Drive sync payload, and the sheet the DM is lent over the LAN.
 *
 * So the raw file cannot be stored. A phone photo is ~4 MB, and base64 inflates
 * it by a third — one upload times the library plus its snapshots blows the
 * ~10 MB localStorage quota, at which point the persist write throws and
 * EVERYTHING silently stops saving until the app is restarted. The user finds
 * out at next launch, having lost the session.
 *
 * 512 px at JPEG 0.82 lands around 40–60 KB, roughly a hundredth of the input,
 * and is still sharper than any place the app actually draws a portrait.
 */

/** Longest edge of a stored portrait, in pixels. */
const MAX_EDGE = 512;
const JPEG_QUALITY = 0.82;

/**
 * Reads an uploaded image file and returns a downscaled JPEG data URL.
 *
 * Rejects if the file isn't a decodable image, so the caller can say so instead
 * of storing a broken portrait. Transparency is flattened onto white rather
 * than left to JPEG's black default — a PNG portrait with a cut-out background
 * would otherwise arrive as a face on a black slab.
 */
export function fileToPortraitDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      try {
        const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('Could not get a 2D canvas context.'));

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("That file couldn't be read as an image."));
    };

    img.src = objectUrl;
  });
}
