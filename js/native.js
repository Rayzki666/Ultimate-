const READY_COOLDOWN_MS = 1500;

function nativeCapacitor() {
  const capacitor = globalThis.Capacitor;
  if (!capacitor) return false;
  if (typeof capacitor.isNativePlatform === 'function') return capacitor.isNativePlatform();
  return typeof capacitor.getPlatform === 'function' && capacitor.getPlatform() !== 'web';
}

async function nativeImpact() {
  const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
  await Haptics.impact({ style: ImpactStyle.Medium });
}

function nativeDebugEnabled() {
  return globalThis.__FRAME_DEBUG_NATIVE__ === true;
}

export function createShootReadySignal({
  isNative = nativeCapacitor,
  now = () => Date.now(),
  impact = nativeImpact,
  cooldownMs = READY_COOLDOWN_MS,
  debug = nativeDebugEnabled,
} = {}) {
  let lastReadySignal = Number.NEGATIVE_INFINITY;

  return async function shootReadySignal() {
    if (!isNative()) return false;

    const currentTime = now();
    if (currentTime - lastReadySignal < cooldownMs) return false;
    lastReadySignal = currentTime;

    try {
      await impact();
      return true;
    } catch (error) {
      if (debug()) console.debug('[Frame native] Shoot-ready haptic unavailable.', error);
      return false;
    }
  };
}

export const signalShootReady = createShootReadySignal();
