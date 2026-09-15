const unavailableMetadata = featureEnabled => ({
  featureEnabled,
  pluginAvailable: false,
  videoInputAvailable: false,
  previewImplemented: false,
  captureImplemented: false,
});

const unavailablePermission = featureEnabled => ({
  featureEnabled,
  camera: 'unavailable',
  canRequest: false,
});

async function loadFrameCamera() {
  const { FrameCamera } = await import('@frame/camera');
  return FrameCamera;
}

export function createNativeCameraAdapter({
  enabled = false,
  loadPlugin = loadFrameCamera,
} = {}) {
  let pluginPromise = null;
  const isEnabled = () => enabled === true || (typeof enabled === 'function' && enabled() === true);

  const plugin = async () => {
    if (!isEnabled()) return null;
    if (!pluginPromise) pluginPromise = Promise.resolve().then(loadPlugin);
    try {
      return await pluginPromise;
    } catch (error) {
      pluginPromise = null;
      throw error;
    }
  };

  return {
    get featureEnabled() {
      try { return isEnabled(); } catch { return false; }
    },

    async getAvailability() {
      let featureEnabled = false;
      try { featureEnabled = isEnabled(); } catch {}
      if (!featureEnabled) return unavailableMetadata(false);
      try {
        const bridge = await plugin();
        if (!bridge) return unavailableMetadata(false);
        const metadata = await bridge.getAvailability();
        return { ...metadata, featureEnabled: true, pluginAvailable: true };
      } catch {
        return unavailableMetadata(true);
      }
    },

    async authorizationStatus() {
      let featureEnabled = false;
      try { featureEnabled = isEnabled(); } catch {}
      if (!featureEnabled) return unavailablePermission(false);
      try {
        const bridge = await plugin();
        if (!bridge) return unavailablePermission(false);
        return { ...await bridge.authorizationStatus(), featureEnabled: true };
      } catch {
        return unavailablePermission(true);
      }
    },

    async requestPermissions() {
      let featureEnabled = false;
      try { featureEnabled = isEnabled(); } catch {}
      if (!featureEnabled) return unavailablePermission(false);
      try {
        const bridge = await plugin();
        if (!bridge) return unavailablePermission(false);
        return { ...await bridge.requestPermissions(), featureEnabled: true };
      } catch {
        return unavailablePermission(true);
      }
    },
  };
}

// Deliberately disabled and not imported by the active camera controller.
export const nativeCamera = createNativeCameraAdapter();
