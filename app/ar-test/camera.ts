export type CameraResult =
  | { ok: true; stream: MediaStream }
  | { ok: false; reason: 'denied' | 'not-found' | 'error'; message: string }

export async function startCamera(): Promise<CameraResult> {
  if (!navigator.mediaDevices?.getUserMedia) {
    return { ok: false, reason: 'error', message: 'This device or browser cannot open the camera.' }
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' }, // rear camera on a phone
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    })
    return { ok: true, stream }
  } catch (err) {
    const name = (err as DOMException).name

    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      return {
        ok: false,
        reason: 'denied',
        message: 'Kavach needs the camera to look at your surroundings. Allow camera access, then try again.',
      }
    }
    if (name === 'NotFoundError') {
      return { ok: false, reason: 'not-found', message: 'No camera was found on this device.' }
    }
    return {
      ok: false,
      reason: 'error',
      message: 'The camera could not be started. Close other apps using it and try again.',
    }
  }
}

export function stopCamera(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop())
}