// Runs only in CI or an explicitly prepared browser-test environment.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm', '.png': 'image/png', '.task': 'application/octet-stream' };
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (error, data) => {
    if (error) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    res.end(data);
  });
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + server.address().port;
  fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
  const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl'] });
  let page;
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, permissions: ['camera'] });
    await context.addInitScript(() => localStorage.setItem('haohaopai:prefs', JSON.stringify({ track: false, tilt: false, voice: false, grid: true })));
    page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => { errors.push(error.message); console.error('PAGE ERROR:', error.message); });
    await page.goto(url + '/#debug');
    await page.waitForFunction(() => window.__coach);
    await page.screenshot({ path: 'test-results/camera-welcome.png', fullPage: true });
    await page.click('#startCam');
    await page.waitForFunction(() => window.__coach.running && !document.querySelector('#captureNow').disabled);
    assert.equal(await page.locator('#cameraStage').evaluate(el => el.classList.contains('is-ready')), false);

    // The actual bundled runtime must load; fake video is only used as camera input.
    await page.click('#btnTrack');
    await page.waitForFunction(() => window.__coach.tracker.state !== 'loading', null, { timeout: 90000 });
    assert.equal(await page.evaluate(() => window.__coach.tracker.ready), true, 'bundled pose model loads');
    await page.click('#btnTrack');

    // Deterministic observations exercise the real controller, UI, and video capture together.
    await page.evaluate(() => {
      const c = window.__coach;
      c.tracker.state = 'ready';
      c._detect = () => {
        c._lastPoseAt = performance.now();
        c.subjects = [{ head: { x: 1/3, y: .22 }, headTop: .16,
          box: { x0: .2, y0: .16, x1: .45, y1: .9 }, face: { x0: .29, y0: .18, x1: .37, y1: .26 },
          visible: { feet: true }, crop: null, pts: [] }];
      };
      c.reader.read = () => ({ mean: 130, center: 130, outer: 130, left: 130, right: 130,
        top: 130, bottom: 130, clipHigh: 0, clipLow: 0, warmth: 0, backlit: 0, sideBias: 0 });
      c.reader.readRegion = () => 130;
    });
    await page.waitForFunction(() => window.__coach.ready);
    assert.equal(await page.locator('#coachTipText').innerText(), '现在可以拍');
    await page.waitForFunction(() => document.querySelector('#toast').hidden);
    await page.screenshot({ path: 'test-results/camera-ready.png', fullPage: true });

    const frame = await page.locator('.camera-preview').boundingBox();
    const stack = await page.locator('#camStack').boundingBox();
    const shutter = await page.locator('#captureNow').boundingBox();
    assert.ok(frame.y + frame.height <= stack.y + 1, 'guidance does not cover saved picture');
    assert.ok(shutter.y + shutter.height <= 844 - 58, 'shutter remains above navigation');

    await page.click('#captureNow');
    await page.waitForFunction(() => document.querySelector('#captureCount').textContent === '1');
    await page.click('#viewCaptures');
    await page.waitForSelector('#reviewGrid .shot img');
    assert.equal(await page.locator('#reviewGrid .shot').count(), 1);
    assert.equal(await page.evaluate(() => window.__coach.running), false);
    await page.screenshot({ path: 'test-results/camera-review.png', fullPage: true });
    const [saved] = await Promise.all([
      page.waitForEvent('download', { timeout: 45000 }),
      page.getByRole('button', { name: '保存照片', exact: true }).click({ timeout: 15000 }),
    ]);
    const filepath = await saved.path();
    const bytes = fs.readFileSync(filepath);
    assert.equal(bytes[0], 0xff);
    assert.equal(bytes[1], 0xd8);
    assert.ok(bytes.length > 1000, 'captured JPEG contains image data');

    // All existing navigation remains usable.
    for (const view of ['recipes', 'cues', 'duo', 'her', 'coach']) {
      await page.click('[data-go="' + view + '"]');
      assert.equal(await page.locator('#view-' + view).isVisible(), true);
    }
    await page.setViewportSize({ width: 360, height: 740 });
    await page.click('#startCam');
    await page.waitForFunction(() => window.__coach.running);
    await page.screenshot({ path: 'test-results/camera-small.png', fullPage: true });
    const smallShutter = await page.locator('#captureNow').boundingBox();
    assert.ok(smallShutter.y + smallShutter.height <= 740 - 58, 'small phone shutter remains reachable');
    await page.click('#btnStop');
    assert.equal(await page.evaluate(() => window.__coach.stream), null);
    assert.deepEqual(errors, []);
    console.log('Browser smoke passed: bundled model, readiness UI, capture/download, navigation, phone layouts, cleanup.');
    await context.close();
  } catch (error) {
    if (page) {
      await page.screenshot({ path: 'test-results/camera-failure.png', fullPage: true }).catch(() => {});
      console.error(await page.locator('#reviewGrid').innerText().catch(() => 'review unavailable'));
    }
    throw error;
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
