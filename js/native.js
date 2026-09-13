let lastReadySignal = 0;

function nativeCapacitor() {
  const capacitor = globalThis.Capacitor;
  if (!capacitor) return false;
  if (typeof capacitor.isNativePlatform === 'function') return capacitor.isNativePlatform();
  return typeof capacitor.getPlatform === 'function' && capacitor.getPlatform() !== 'web';
}

export async function signalShootReady() {
  if (!nativeCapacitor()) return false;

  const now = Date.now();
  if (now - lastReadySignal < 1500) return false;
  lastReadySignal = now;

  try {
    const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
    await Haptics.impact({ style: ImpactStyle.Medium });
    return true;
  } catch {
    return false;
  }
}
