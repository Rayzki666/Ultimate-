# Live AI guidance setup

The GitHub Pages frontend works without a server. Cloud scene analysis stays off until a private gateway is connected and camera-session sharing is explicitly enabled. No provider key is bundled into the website.

## Deploy the gateway

Deploy this repository to a Node 22 HTTPS host, using:
- Start command: `node server/server.mjs`
- Or build the container from the repository root: `docker build -f server/Dockerfile -t frame-ai .`
- Expose the host-assigned PORT (default 8080).
- Set secrets in the hosting provider's environment settings, never in source or GitHub Pages:
  - ANTHROPIC_API_KEY: your provider key.
  - ANTHROPIC_MODEL: a vision-capable model ID available to your account. No model is silently selected.
  - APP_TOKEN: a unique random access code of at least 32 characters, maximum 256. This is separate from your provider key.
  - ALLOWED_ORIGIN: `https://rayzki666.github.io` (origin only, no /Ultimate- path).
- Use one instance. Limits are in memory: one active analysis, at least 4 seconds between upstream requests, at most 120 upstream attempts per hour per process. Restarts reset the limit. Configure a provider spending limit separately.
- Health endpoint: GET /health with Authorization: Bearer APP_TOKEN. It validates configuration and the access code, not upstream credit or model availability. It returns {"status":"ready","protocol":1}.

The gateway accepts JPEG previews only, limits request size, applies origin checks plus bearer authentication, sends only the supplied preview and a fixed style intention to Anthropic, and validates the model response. Provider error bodies and image bytes are never logged by this code. Your hosting platform and model provider have their own data policies. Configure HTTPS at the host.

## Connect on iPhone

1. Refresh Frame in Safari, then open Settings > Live AI guidance.
2. Enter the service origin and its APP_TOKEN access code, then Connect service.
3. Return to Camera, Open camera, tap AI, and read the destination disclosure.
4. Enable for this session. The face model loads in a worker, then clear steady frames can be sampled.
5. Tap AI again or close the camera to stop sharing. Leaving the camera tab or backgrounding the page also stops it.

The service address is remembered on this browser. The access code is memory-only and must be re-entered after reload; it is excluded from preference export. Camera-session consent is never persisted. Existing optional photo review uses its separate user-provided key.

## Actual behavior and limits

- Basic guidance uses pose landmarks, measured light and device orientation. Visible head/shoulders are checked, with feet for full-body shots; raised or hidden hands no longer fail simply because a template has lowered hands.
- AI does not match example poses or rate attractiveness, body size or identity. It considers scene lighting, composition, background and pose relationships.
- Instant face checks use MediaPipe Face Landmarker eye-blink coefficients and a face-region detail heuristic. This cannot certify autofocus, expression quality, or absence of all blur. Small, obscured or uncertain faces block the AI signal rather than passing.
- The additional face model comes from Google's model host on first use; it is not bundled with this repository. If that host or the worker is unavailable, basic guidance still works and the AI signal remains unavailable.
- Preview JPEGs match the visible crop and front-camera mirroring, maximum edge 640 pixels, quality 0.65.
- Client attempts are at least 5 seconds apart, no queue, max 60 attempts per enabled session. Three consecutive network/model failures pause AI.
- Every result is bound to a frame ID, camera/session, style, crop size and scene signature. Significant subject, lighting or background changes invalidate the result and abort an obsolete request. Switching styles/cameras, capture, navigation and stop invalidate it too.
- Results expire 6.5 seconds after preview capture, not after the reply arrives. The scene-signature check is a heuristic; it cannot detect every subtle change.
- A valid shoot verdict needs confidence >=0.8 and all semantic checks marked good, plus fresh local face checks and sustained basic readiness. The extra local hold is 500 ms. These are initial conservative engineering thresholds, not calibrated aesthetic probabilities.
- Missing, malformed, timed-out or old results never trigger AI green. Manual capture remains available.
- UI separates BASIC CHECKS PASSED from AI SUGGESTS: SHOOT NOW. Green is a recent recommendation, not a guarantee of a best possible photograph.

## Verification

CI tests the contract, expiry and invalidation, single in-flight requests, consent/stop flows, backend authentication/CORS/input validation/rate limits and mocked provider failures. Browser tests use deterministic observations to verify the signal and load the real face worker/model separately. A mocked shoot verdict is not a live-model quality test.

Before production use, verify the chosen live model/key on the deployed host and test on the target iPhone with motion, occlusion, varied light, glasses, different skin tones and body types. Real iPhone performance and aesthetic accuracy cannot be established by desktop Chromium emulation.

References:
- [Anthropic vision API](https://platform.claude.com/docs/en/build-with-claude/vision)
- [MediaPipe Face Landmarker for Web](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js)
