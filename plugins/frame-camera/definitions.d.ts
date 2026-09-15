export type FrameCameraPermission = 'prompt' | 'restricted' | 'denied' | 'granted' | 'unknown';

export interface FrameCameraAvailability {
  platform: 'ios';
  pluginAvailable: true;
  videoInputAvailable: boolean;
  previewImplemented: false;
  captureImplemented: false;
  simulator: boolean;
}

export interface FrameCameraPermissionStatus {
  camera: FrameCameraPermission;
  canRequest: boolean;
}

export interface FrameCameraPlugin {
  getAvailability(): Promise<FrameCameraAvailability>;
  authorizationStatus(): Promise<FrameCameraPermissionStatus>;
  requestPermissions(): Promise<FrameCameraPermissionStatus>;
}
