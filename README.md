# Frame — AI Camera

An English-first camera that helps you shoot toward an intention.
Choose **Styles → Use this look → Open camera**, then follow one live direction at a time.

## Shooting styles

| Preset | Default framing | How live guidance changes |
| --- | --- | --- |
| Cinematic Portrait | Portrait, thirds | Stronger subject presence; suggestions respond to brightness differences across the frame. |
| Golden Glow | Portrait, thirds | Backlight advice preserves the intended rim light while asking for more light on the face; warm-tone readings inform suggestions. |
| Travel Story | Full body, thirds | Allows a smaller subject and requests more space for the environment; bright upper frames trigger a suggestion to include less sky. |
| Editorial | Full body, center | Requests more subject presence and a deliberate central composition. |

The lookbook contains four AI-generated photographic examples stored in the repository. Tap an example to view it at full size. Styles are shooting intentions, **not color filters**. You can override framing and composition or return to free shooting. Selection persists in this browser. Each in-app photo records its shooting style for the current session.

## Focused interface

Camera, Styles, Photos and Settings. Conversation scripts and the previous content library are removed from the active app. Old saved Recipes and profile tabs route to Styles and Settings. Stored data is not silently deleted.

Live camera text, errors, voice guidance, photo review and the web app manifest are in English. Optional cloud reviews request English responses.

## What the camera measures

On-device MediaPipe body landmarks, pixel brightness and available device orientation. The first model load is about 18 MB. One priority instruction handles exposure, missing people, cropping, angle, style-specific subject scale and composition. Full readiness requires five measured checks: pose basics, camera angle, light, framing and sustained stability. After about 1.1 seconds of stability, a high-contrast READY TO SHOOT state lights the guidance panel, viewfinder corners and shutter. Missing orientation readings or pose landmarks prevent full readiness; manual capture is still available. Head, scale or visible limb movement, stale frames and lost subjects reset it.

Styles use only measured signals. Background objects, expressions, actual focus and semantic scene understanding are not detected. A warm-toned frame is not proof of sunset. Pose basics require visible shoulders and hands below shoulder level; full-body framing also requires both feet. Close-ups check face landmarks instead. This does not match the example pose exactly. Green means the measured conditions are satisfied, not that the photo is perfect.

## Photos and privacy

The web shutter saves a JPEG of the visible video crop, including the front-camera mirror and excluding guides. It does not provide native camera HDR or full sensor resolution. Use Native camera when needed.

Up to 20 photos are held in the page session. **Save photos before refreshing.** Live guidance does not upload frames. Optional photo review sends only explicitly selected photos to Anthropic using the user's own key; provider fees may apply. The key is stored in this browser. This personal-key setup is not a multi-user backend.

## Deployment and updates

No build step is required for GitHub Pages. Host the repository root over HTTPS and keep the selected implementation branch as the Pages source. After deployment, save session photos, then refresh Safari to load the latest app. Service-worker shell version: v13.

## Validation

- `node --test tests/guidance.test.mjs`: geometry, readiness, preset behavior, environment-dependent hints, fallback and exposure priority.
- `node --test tests/camera-backend.test.mjs`: browser camera lifecycle, track cleanup, capture delegation and stale-start rejection.
- `node --test tests/native*.test.mjs`: native haptics and camera-adapter fallbacks, throttling, permissions and capability metadata.
- `tests/browser-smoke.cjs`: bundled model load, style selection, English navigation, camera JPEG download and phone-sized layouts.
- GitHub Actions also compiles both the iPhone Simulator and unsigned arm64 iPhone app, verifies the IPA structure, and uploads build artifacts.
- Real iPhone permission flows, speed, heat, image quality and download-to-Photos behavior still require device testing.

## Optional live AI suggestions

A private gateway and explicit camera-session consent enable recent scene/style advice. Basic checks and AI shoot suggestions have distinct signals; missing or stale AI results do not turn the AI indicator green. Flexible poses replace the universal lowered-hands rule. The camera fills the shooting stage while secondary framing choices stay in a compact drawer. The gateway requires deployment and server-side provider credentials before cloud analysis is usable. See [setup, limits and verification](docs/live-ai-setup.md).

## iPhone app build

Capacitor 8 packages the same interface as an iOS app. Native builds add a haptic when AI readiness first changes to **SHOOT NOW**. A local Swift plugin provides camera availability and permission probes for the next native stage; web video remains the active camera backend.

The macOS GitHub Actions workflow produces:

- `Frame-iOS-Simulator.zip`;
- `Frame-iOS-Unsigned.ipa` for arm64 iPhones;
- a SHA-256 checksum; and
- the generated Xcode source.

The unsigned IPA can be signed and installed from Windows with a free Apple Account. Free provisioning expires after seven days; TestFlight and App Store distribution require the paid program. No Apple credentials or signing secrets are stored in this repository. See [the iPhone build and sideload guide](docs/ios-app.md).

- Configuration: [`capacitor.config.json`](capacitor.config.json)
- Build workflow: [`.github/workflows/ios-build.yml`](.github/workflows/ios-build.yml)

The bundle identifier `com.rayzki.framecamera` is provisional for App Store distribution but should stay unchanged between sideload refreshes.
