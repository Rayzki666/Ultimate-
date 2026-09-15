# Frame for iPhone

Frame is moving from a browser-only PWA to a Capacitor iOS app in small, testable stages.

## Current stage

The repository has a reproducible Capacitor 8 configuration, a native shoot-ready haptic adapter, a tested browser camera backend seam, and a local Swift Package that reports camera hardware availability and reads or requests iOS video permission.

GitHub Actions uses a macOS runner to:

1. run the guidance and native-adapter tests;
2. bundle the current web app into `dist/`;
3. generate the iOS project with Swift Package Manager;
4. verify that the local `FrameCamera` plugin is linked and registered;
5. add the required camera permission description;
6. build unsigned simulator and arm64 iPhone device apps;
7. package a structurally verified unsigned IPA; and
8. upload the simulator app, unsigned IPA, checksum, and generated Xcode source.

The provisional bundle identifier is `com.rayzki.framecamera`. Keep the same identifier when refreshing a sideloaded build so iOS can replace the existing app.

## Install on your own iPhone without a paid membership

The workflow artifact named `frame-ios-builds` contains `Frame-iOS-Unsigned.ipa`. It is compiled for a real arm64 iPhone, but it must be signed with your Apple Account before iOS will launch it.

On Windows, the simplest current route is [Sideloadly](https://sideloadly.io/):

1. Download and unzip the latest `frame-ios-builds` artifact from the GitHub Actions run.
2. Install Sideloadly from its official website.
3. Connect the unlocked iPhone by USB and tap **Trust** when prompted.
4. Drop `Frame-iOS-Unsigned.ipa` into Sideloadly, select the iPhone, and sign it with a free Apple Account.
5. On iOS 16 or later, enable **Settings → Privacy & Security → Developer Mode** if iOS asks for it.
6. Open **Settings → General → VPN & Device Management** and trust the development profile if prompted.
7. Install future builds with the same Apple Account and bundle identifier so the existing copy is refreshed.

Frame never receives or stores the Apple Account credentials used by the signing tool. Sideloadly is third-party software; download it only from its official site. [AltStore Classic for Windows](https://faq.altstore.io/altstore-classic/how-to-install-altstore-windows) is an alternative if automatic refresh is preferred.

Apple's free Personal Team provisioning expires after seven days and allows up to three installed development apps per device. Refresh or reinstall Frame before expiry. A paid Apple Developer Program membership remains necessary for TestFlight and App Store distribution. See [Apple's membership comparison](https://developer.apple.com/support/compare-memberships/) and [Sideloadly's FAQ](https://sideloadly.io/faq).

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

The generated `ios/` folder is currently ignored. CI uploads the exact generated project for inspection. Native source that belongs to Frame lives in the versioned local Swift Package under `plugins/frame-camera/`.

## Native stages

1. **Capacitor shell** — simulator and unsigned arm64 device builds.
2. **Native feedback** — haptic confirmation when Frame recommends shooting. Implemented; physical-device feel still needs verification.
3. **Camera backend seam** — web lifecycle, capture, flip and stale-session protection behind one interface. Implemented.
4. **Native permission shell** — local plugin discovery, capability metadata, and video permission request. Implemented and inactive by default.
5. **Native camera** — AVFoundation preview, high-resolution capture, focus, exposure, and lens switching.
6. **On-device vision** — Vision/Core ML signals feeding the existing readiness system.
7. **Distribution** — signed release, privacy details, screenshots, TestFlight, and App Store review.

The active camera remains `WebCameraBackend`. The native adapter is not imported by the active controller, and it truthfully reports that native preview and capture are not implemented. This keeps the current camera stable while the AVFoundation path is built and tested on a physical iPhone.
