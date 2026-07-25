/**
 * Camera capture for the "read the board" board reader (#39).
 *
 * Deliberately standalone rather than folded into the DM Console: the same
 * capture is wanted DM-side (a camera on the DM's own machine, the "Direct
 * connection" source) and later player-side (the table is in the players' room,
 * so a player's sheet takes the photo and pushes it to the DM). Keeping it here
 * means neither one owns it. Mirrors dmSpeech.ts, which does the same job for
 * the microphone.
 *
 * EVERYTHING here is optional by construction: no camera, a denied permission,
 * or a browser without mediaDevices all resolve to "no cameras" / a thrown
 * capture, and the caller simply doesn't offer the feature. Nothing in the app
 * depends on a camera existing.
 */

/** A camera the user could point at the table. */
export interface TableCamera {
  deviceId: string;
  label: string;
}

/** True when this build can even ask for a camera (Tauri's webview can; a
 *  non-secure context can't). Cheap, synchronous, no permission prompt. */
export function cameraApiAvailable(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

/** Cameras we could capture from, or [] if there are none / we're not allowed
 *  to look. NEVER throws — the caller uses "is this empty?" to decide whether
 *  to offer a board read at all.
 *
 *  Note labels are blank until the user has granted camera permission once;
 *  that's fine, we fall back to "Camera 1". We deliberately do NOT prompt for
 *  permission here — merely opening the DM Console shouldn't trip a camera
 *  prompt. The prompt happens on the first actual capture. */
export async function listTableCameras(): Promise<TableCamera[]> {
  if (!cameraApiAvailable() || !navigator.mediaDevices.enumerateDevices) return [];
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === 'videoinput')
      .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }));
  } catch {
    return [];
  }
}

const sleep = (ms: number) => new Promise<void>((r) => { setTimeout(r, ms); });

/** How long to let the sensor auto-expose and focus before grabbing the frame.
 *
 *  A webcam pointed down at a table needs a beat. The first frames after the
 *  stream opens are typically dark and still hunting focus, and the whole job
 *  downstream is making out printed column letters — so a rushed shot costs
 *  read accuracy directly, not just prettiness.
 *
 *  Hardware is never the ideal on paper: this is the knob to turn if photos
 *  come out dim or soft on a particular camera. */
const SENSOR_SETTLE_MS = 800;

/** Give up rather than hang if the camera opens but never produces a frame. */
const FIRST_FRAME_TIMEOUT_MS = 6000;

/** Pixel size of an image data URL, or null if it can't be decoded. */
export function imageDimensions(dataUrl: string): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

/** Below roughly this many photo pixels per map square, printed column letters
 *  stop being legible and the read degrades no matter how good the model is. */
const MIN_PX_PER_CELL = 30;

/** A warning if this photo is too coarse to read `cols` squares off, else null.
 *
 *  `width: {ideal: 1920}` in getUserMedia is a HINT, not a constraint — a laptop
 *  webcam can hand back 640x480 and nothing says so, which then looks like the
 *  model being bad at its job rather than the photo being unreadable.
 *
 *  Measured against the map's own width rather than an absolute resolution,
 *  because that's what actually matters: 1280px is plenty for a 12-wide map and
 *  thin for a 40-wide one. This assumes the map fills the frame, so it's a
 *  FLOOR — a photo that fails here is definitely too coarse; one that passes
 *  may still be if the map only occupies part of the shot. */
export async function coarsePhotoWarning(photo: string, cols: number): Promise<string | null> {
  if (cols <= 0) return null;
  const dim = await imageDimensions(photo);
  if (!dim || !dim.w) return null;
  const pxPerCell = dim.w / cols;
  if (pxPerCell >= MIN_PX_PER_CELL) return null;
  return `That photo is ${dim.w}×${dim.h}, about ${Math.round(pxPerCell)} pixels per square across a ${cols}-wide map — `
    + 'likely too coarse to read the printed labels. Move the camera closer or use a higher-resolution one.';
}

/** Grabs ONE still frame and returns it as a JPEG data URL.
 *
 *  Opens the camera, waits for a real frame, draws it to a canvas and shuts the
 *  camera straight back off — we want a photo, not a running video feed, so the
 *  light goes out immediately and nothing keeps the device busy.
 *
 *  `quality` 0.85 and the native resolution keep the file small enough for the
 *  vision call (a few hundred KB) while staying legible enough to read the map's
 *  printed grid labels, which is the whole job.
 *
 *  ALWAYS settles — resolves or throws, never hangs. That matters because the
 *  player-side caller runs this unattended (see TableCameraButton's autoSend)
 *  and clears its "busy" flag in a `finally`: a capture that never settled would
 *  leave that device ignoring every later photo request until it was reloaded.
 *
 *  Throws with a readable message on denial/absence so the caller can surface it.
 */
export async function captureTableFrame(
  deviceId?: string, quality = 0.85, settleMs = SENSOR_SETTLE_MS,
): Promise<string> {
  if (!cameraApiAvailable()) throw new Error('This device has no camera support.');
  let stream: MediaStream | null = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: deviceId
        ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
        : { width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });

    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    // NOT awaited: play() can stay pending indefinitely in a hidden document,
    // and on the player's side this runs while their app may well be in the
    // background. Frames arriving is what we actually wait on, below.
    void video.play().catch(() => {});

    // Timer-based, deliberately NOT requestAnimationFrame: rAF is paused
    // outright in a hidden document, so the old loop never advanced on a
    // backgrounded player device and the capture hung forever. Timers are only
    // throttled there (~1s), so this still finishes, just more coarsely.
    const deadline = Date.now() + FIRST_FRAME_TIMEOUT_MS;
    while (!video.videoWidth && Date.now() < deadline) await sleep(50);

    const w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) throw new Error('The camera returned no image.');
    // Dimensions only mean metadata arrived; the picture still needs to settle.
    await sleep(settleMs);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')!.drawImage(video, 0, 0, w, h);
    video.pause();
    video.srcObject = null;
    return canvas.toDataURL('image/jpeg', quality);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/NotAllowedError|Permission/i.test(msg)) throw new Error('Camera permission was denied.');
    if (/NotFoundError|NotReadable|Overconstrained/i.test(msg)) throw new Error('That camera is unavailable.');
    throw new Error(`Couldn't take the photo: ${msg}`);
  } finally {
    stream?.getTracks().forEach((t) => t.stop()); // light off, device released
  }
}
