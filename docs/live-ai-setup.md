# Live AI guidance setup

The GitHub Pages frontend works without a server. Cloud scene analysis stays off until a private gateway is connected and camera-session sharing is explicitly enabled. No provider key is bundled into the website.

## Fastest iPhone setup: xAI Grok on Render

1. Create an API key in the [xAI Console](https://console.x.ai/). Keep it private.
2. Create a separate random access code of 32–256 characters and save it in your password manager. This is your `APP_TOKEN`; do not reuse the xAI key.
3. Tap the button below, sign in to Render, and approve the Blueprint. Render will ask for `XAI_API_KEY` and `APP_TOKEN`.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Rayzki666/Ultimate-/tree/claude/ai-photo-assistant-4cxjbo)

The included `render.yaml` selects `grok-4.3`, low image detail, no reasoning, one free instance, and the correct GitHub Pages origin. After the deployment shows **Live**:

1. Copy the Render service URL, such as `https://frame-grok-gateway.onrender.com`.
2. In Frame, open **Settings → Live AI guidance**.
3. Put the Render URL in **Service address**. Use the origin only, with no path or query.
4. Put the separate `APP_TOKEN` you created in **Service access code**.
5. Tap **Connect service**. A successful Grok gateway reports **Connected to Grok**.
6. Return to Camera, open the camera, tap **AI**, review the disclosure, and enable it for that camera session.

Never paste `XAI_API_KEY` into either Frame field. It belongs only in Render's environment settings. The free Render service can sleep; the Connect button allows up to 30 seconds for a cold start. Once connected, keep the camera session active so the service remains awake. An always-on service is more reliable for live guidance.

## Manual gateway deployment

Deploy this repository to a Node 22 HTTPS host:

- Start command: `node server/server.mjs`
- Or build the container from the repository root: `docker build -f server/Dockerfile -t frame-ai .`
- Expose the host-assigned `PORT` (default 8080).
- Store secrets in the hosting provider's environment settings, never in source or GitHub Pages.
- Use one instance. Limits are in memory: one active analysis, at least 4 seconds between upstream requests, and at most 120 upstream attempts per hour per process. Restarts reset the limit. Configure a provider spending limit separately.
- Health endpoint: `GET /health` with `Authorization: Bearer APP_TOKEN`. It validates configuration and the access code, not upstream credit or model availability. It returns `{"status":"ready","protocol":1,"provider":"xai"}` for Grok.

### xAI Grok

```text
AI_PROVIDER=xai
XAI_API_KEY=<your xAI API key>
XAI_MODEL=grok-4.3
XAI_IMAGE_DETAIL=low
XAI_REASONING_EFFORT=none
APP_TOKEN=<independent random code, 32-256 characters>
ALLOWED_ORIGIN=https://rayzki666.github.io
```

`grok-4.3` accepts image input and strict structured output. `none` reduces live latency. You may use `low`, `medium`, `high`, or `xhigh` reasoning if the chosen model supports it, but slower replies can expire before the live signal appears. `XAI_IMAGE_DETAIL` accepts `low`, `auto`, or `high`.

The gateway sends JPEG data URLs to xAI's fixed `https://api.x.ai/v1/responses` endpoint with `store:false`. It never accepts a caller-supplied upstream URL.

### Anthropic compatibility

Existing Anthropic deployments continue to work when `AI_PROVIDER` is omitted:

```text
ANTHROPIC_API_KEY=<your Anthropic API key>
ANTHROPIC_MODEL=<vision-capable model available to your account>
APP_TOKEN=<independent random code, 32-256 characters>
ALLOWED_ORIGIN=https://rayzki666.github.io
```

No model is silently selected for a manual deployment.

## Privacy and access controls

The gateway accepts JPEG previews only, limits request size, applies origin checks plus bearer authentication, sends only the supplied preview and a fixed style intention to the configured provider, and validates every model response. Provider error bodies and image bytes are never logged by this code. Your hosting platform and model provider have their own data policies. Configure HTTPS at the host.

`APP_TOKEN` protects an internet-facing, billable endpoint. Keep it separate from the provider key and rotate it if exposed. The in-memory hourly limit applies per process; multiple instances and restarts can bypass it.

## Connect on iPhone

1. Refresh Frame in Safari, then open **Settings → Live AI guidance**.
2. Enter the service origin and its `APP_TOKEN`, then tap **Connect service**.
3. Return to Camera, open the camera, tap **AI**, and read the destination disclosure.
4. Enable it for this session. Local face-detail checks start, then clear steady frames can be sampled.
5. Tap AI again or close the camera to stop sharing. Leaving the camera tab or backgrounding the page also stops it.

The service address is remembered on this browser. The access code is memory-only and must be re-entered after reload; it is excluded from preference export. Camera-session consent is never persisted. Existing optional photo review uses its separate user-provided Anthropic key.

## Actual behavior and limits

- Basic guidance uses pose landmarks, measured light and device orientation. Visible head and shoulders are checked, with feet for full-body shots; raised or hidden hands do not fail simply because a template has lowered hands.
- AI does not match example poses or rate attractiveness, body size or identity. It considers scene lighting, composition, background and pose relationships.
- Cloud analysis checks whether visible eyes look clearly open in the sampled still. Local face-region detail and eye-band change heuristics invalidate a recommendation when the face changes. They cannot certify autofocus, expression quality, catch every blink, or prove the absence of blur. Small, obscured or unclear faces block the AI signal rather than passing.
- Preview JPEGs match the visible crop and front-camera mirroring, maximum edge 640 pixels, quality 0.65.
- Client attempts are at least 5 seconds apart, with no queue and a maximum of 60 attempts per enabled session. Three consecutive network or model failures pause AI.
- Every result is bound to a frame ID, camera session, style, crop size and scene signature. Significant subject, lighting or background changes invalidate the result and abort an obsolete request. Switching styles or cameras, capture, navigation and stop invalidate it too.
- Results expire 6.5 seconds after preview capture, not after the reply arrives. The scene-signature check is a heuristic and cannot detect every subtle change.
- A valid shoot verdict needs confidence >=0.8 and all semantic checks marked good, plus fresh local face checks and sustained basic readiness. The extra local hold is 500 ms. These are initial conservative engineering thresholds, not calibrated aesthetic probabilities.
- Missing, malformed, timed-out or old results never trigger AI green. Manual capture remains available.
- UI separates **BASIC CHECKS PASSED** from **AI SUGGESTS: SHOOT NOW**. Green is a recent recommendation, not a guarantee of a best possible photograph.

## Verification

CI tests both Anthropic and xAI request shapes, strict response validation, expiry and invalidation, single in-flight requests, consent and stop flows, backend authentication, CORS, input validation, rate limits, and mocked provider failures. Browser tests use deterministic observations to verify the signal, facial-change invalidation and failure handling. A mocked shoot verdict is not a live-model quality test.

Before production use, verify the chosen live model and key on the deployed host and test on the target iPhone with motion, occlusion, varied light, glasses, different skin tones and body types. Real iPhone performance and aesthetic accuracy cannot be established by desktop Chromium emulation.

References:

- [xAI Responses API](https://docs.x.ai/developers/rest-api-reference/inference/responses)
- [xAI image understanding](https://docs.x.ai/developers/model-capabilities/images/understanding)
- [xAI structured outputs](https://docs.x.ai/developers/model-capabilities/text/structured-outputs)
- [Grok 4.3](https://docs.x.ai/developers/models/grok-4.3)
- [Anthropic vision API](https://platform.claude.com/docs/en/build-with-claude/vision)
- [Render Blueprint specification](https://render.com/docs/blueprint-spec)
