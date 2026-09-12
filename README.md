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

The lookbook uses vector composition studies. Styles are shooting intentions, **not color filters**. You can override framing and composition or return to free shooting. Selection persists in this browser. Each in-app photo records its shooting style for the current session.

## Focused interface

Camera, Styles, Photos and Settings. Conversation scripts and the previous content library are removed from the active app. Old saved Recipes and profile tabs route to Styles and Settings. Stored data is not silently deleted.

Live camera text, errors, voice guidance, photo review and the web app manifest are in English. Optional cloud reviews request English responses.

## What the camera measures

On-device MediaPipe body landmarks, pixel brightness and available device orientation. The first model load is about 18 MB. One priority instruction handles exposure, missing people, cropping, angle, style-specific subject scale and composition. After about 1.1 seconds of continuous stability, the frame turns green. New movement, stale frames and lost subjects reset it.

Styles use only measured signals. Background objects, expressions, actual focus and semantic scene understanding are not detected. A warm-toned frame is not proof of sunset. Green means the measured conditions are satisfied, not that the photo is perfect.

## Photos and privacy

The web shutter saves a JPEG of the visible video crop, including the front-camera mirror and excluding guides. It does not provide native camera HDR or full sensor resolution. Use Native camera when needed.

Up to 20 photos are held in the page session. **Save photos before refreshing.** Live guidance does not upload frames. Optional photo review sends only explicitly selected photos to Anthropic using the user's own key; provider fees may apply. The key is stored in this browser. This personal-key setup is not a multi-user backend.

## Deployment and updates

No build step is required. Host the repository root over HTTPS. For GitHub Pages, keep the selected implementation branch as the source. After deployment, save session photos, then refresh Safari to load the latest app. Service-worker shell version: v5.

## Validation

- `node --test tests/guidance.test.mjs`: geometry, readiness, preset behavior, environment-dependent hints, fallback and exposure priority.
- `tests/browser-smoke.cjs`: real bundled model load, style selection/persistence, English navigation, camera JPEG download and phone-sized layouts.
- GitHub Actions runs these checks in the cloud. Synthetic video and injected observations are used for repeatable controller tests.
- Real iPhone permission flows, speed, heat, image quality and download-to-Photos behavior still require device testing.
