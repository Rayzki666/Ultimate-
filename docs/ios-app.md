# Frame for iPhone

Frame is moving from a browser-only PWA to a Capacitor iOS app in small, testable stages.

## Current stage

The repository now has a reproducible Capacitor 8 configuration and a native shoot-ready haptic adapter. GitHub Actions uses a macOS runner to:

1. run the existing guidance tests;
2. collect the current web app into `dist/`;
3. generate the iOS project with Swift Package Manager;
4. add the required camera permission description;
5. build an unsigned iPhone Simulator app; and
6. upload both the simulator app and generated Xcode source as workflow artifacts.

The provisional bundle identifier is `com.rayzki.framecamera`. Change it before creating the permanent App Store record if a different identifier is preferred.

## Build on a Mac

Requirements: Node.js 22 or newer, macOS, and Xcode 26 or newer.

```sh
npm ci
npm run ios:generate
npx cap open ios
```

After the first generation, update the native project with:

```sh
npm run ios:sync
```

The generated `ios/` folder is intentionally ignored during this first stage. The CI artifact makes the exact generated project inspectable. It will be committed when the first custom Swift camera module is introduced.

## Planned native stages

1. **Capacitor shell** — reproducible simulator build and camera permission.
2. **Native feedback** — haptic confirmation when Frame recommends shooting. Implemented; physical-device feel still needs verification.
3. **Native camera** — AVFoundation preview, high-resolution capture, focus, exposure, lens switching, and Photo Library save.
4. **On-device vision** — Vision/Core ML scene signals feeding the existing readiness system.
5. **Distribution** — signed device build, TestFlight, privacy details, screenshots, and App Store review.

A signed device or TestFlight build needs an Apple Developer Program team, bundle identifier, signing certificate, and provisioning profile. No signing credentials are required for the current simulator build. The browser build keeps its existing vibration fallback; the Capacitor bundle adds the native iOS Haptics plugin.
