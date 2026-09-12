// Runs only in CI or an explicitly prepared browser-test environment.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.jpg': 'image/jpeg', '.wasm': 'application/wasm', '.png': 'image/png', '.task': 'application/octet-stream' };
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
    await context.addInitScript(() => { if (!localStorage.getItem('haohaopai:prefs')) localStorage.setItem('haohaopai:prefs', JSON.stringify({ track: false, tilt: false, voice: false, grid: true })); });
    page = await context.newPage();
    const errors = [];
    let aiCalls=0, aiMode='shoot';
    await page.route('https://frame-ai.test/**', async route => {
      if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Allow-Methods':'GET, POST, OPTIONS'}});
      const headers={'Access-Control-Allow-Origin':'*','Content-Type':'application/json'};
      if(route.request().url().endsWith('/health'))return route.fulfill({headers,body:JSON.stringify({status:'ready',protocol:1})});
      aiCalls++;
      const body=route.request().postDataJSON();
      assert.match(body.image,/^data:image\/jpeg;base64,/);
      if(aiMode==='error')return route.fulfill({status:502,headers,body:'{}'});
      return route.fulfill({headers,body:JSON.stringify({id:body.id,result:{decision:aiMode,confidence:.91,reason:'The light and background work well together.',action:aiMode==='adjust'?'Move a little to the right':'',actor:aiMode==='adjust'?'camera':'none',checks:{light:'good',composition:'good',background:aiMode==='shoot'?'good':'unknown',pose:'good',eyes:'good'}}})});
    });
    page.on('pageerror', error => { errors.push(error.message); console.error('PAGE ERROR:', error.message); });
    await page.goto(url + '/#debug');
    await page.waitForFunction(() => window.__coach);
    await page.screenshot({ path: 'test-results/camera-welcome.png', fullPage: true });
    // Replace the old content library with selectable, persistent shooting styles.
    await page.click('[data-go="styles"]');
    assert.equal(await page.locator('[data-style]').count(), 4);
    assert.equal(await page.locator('[data-go="cues"]').count(), 0);
    await page.waitForFunction(() => [...document.querySelectorAll('.style-art img')].every(img => img.complete && img.naturalWidth >= 1000));
    for (const id of ['cinematic', 'golden', 'travel', 'editorial']) {
      await page.click('[data-example="' + id + '"]');
      assert.equal(await page.locator('#exampleDialog').isVisible(), true);
      await page.waitForFunction(() => document.querySelector('#exampleImage').complete && document.querySelector('#exampleImage').naturalWidth >= 1000);
      await page.click('#closeExample');
      assert.equal(await page.locator('#exampleDialog').isVisible(), false);
    }
    await page.screenshot({ path: 'test-results/styles-lookbook.png', fullPage: true });
    await page.click('[data-style="editorial"]');
    assert.equal(await page.evaluate(() => window.__coach.composition), 'center');
    assert.equal(await page.evaluate(() => window.__coach.shotType), 'full');
    assert.equal(await page.locator('#activeStyleName').innerText(), 'Editorial');
    await page.reload();
    await page.waitForFunction(() => window.__coach);
    assert.equal(await page.evaluate(() => window.__coach.style.id), 'editorial');
    await page.click('#idleStyle');
    await page.click('#clearStyle');
    await page.click('#startCam');
    await page.waitForFunction(() => window.__coach.running && !document.querySelector('#captureNow').disabled);
    assert.equal(await page.locator('#cameraStage').evaluate(el => el.classList.contains('is-ready')), false);

    await page.click('#framingPanel summary');
    await page.click('[data-shot="half"]');
    await page.click('[data-composition="thirds"]');
    await page.click('#framingPanel summary');
    // The actual bundled runtime must load; fake video is only used as camera input.
    await page.click('#btnTrack');
    await page.waitForFunction(() => window.__coach.tracker.state !== 'loading', null, { timeout: 90000 });
    assert.equal(await page.evaluate(() => window.__coach.tracker.ready), true, 'bundled pose model loads');
    await page.click('#btnTrack');

    // Deterministic observations exercise the real controller, UI, and video capture together.
    await page.evaluate(() => {
      const c = window.__coach;
      c.tracker.state = 'ready';
      c.tilt.read = () => ({ roll: 0, pitch: 5, rollValid: true });
      c._testWristOffset = 0;
      c._detect = () => {
        c._lastPoseAt = performance.now();
        const pts = Array.from({ length: 33 }, () => ({ x: .33, y: .5, visibility: 0 }));
        for (const [i,x,y] of [[0,.33,.22],[2,.31,.2],[5,.35,.2],[11,.26,.35],[12,.4,.35],[15,.27,.61],[16,.39,.61],[31,.28,.9],[32,.39,.9]])
          pts[i] = { x: x + (i === 15 ? c._testWristOffset : 0), y, visibility: .95 };
        c.subjects = [{ head: { x: 1/3, y: .22 }, headTop: .16,
          box: { x0: .2, y0: .16, x1: .45, y1: .9 }, face: { x0: .29, y0: .18, x1: .37, y1: .26 },
          visible: { feet: true }, crop: null, pts }];
      };
      c.reader.read = () => ({ mean: 130, center: 130, outer: 130, left: 130, right: 130,
        top: 130, bottom: 130, clipHigh: 0, clipLow: 0, warmth: 0, backlit: 0, sideBias: 0 });
      c.reader.readRegion = () => 130;
    });
    await page.waitForFunction(() => window.__coach.ready);
    assert.equal(await page.locator('#coachTipText').innerText(), 'Basic checks passed');
    await page.waitForFunction(() => document.querySelector('#toast').hidden);
    assert.equal(await page.locator('#readinessTitle').innerText(), 'BASIC CHECKS PASSED');
    assert.equal(await page.locator('#readinessCount').innerText(), '5 / 5 checks');
    assert.equal(await page.locator('.ready-stamp').evaluate(el => getComputedStyle(el).opacity), '0');
    assert.equal(await page.locator('#shutterCue').innerText(), 'Take photo');
    await page.screenshot({ path: 'test-results/camera-ready.png', fullPage: true });
    await page.evaluate(() => { window.__coach.tilt.read = () => null; });
    await page.waitForFunction(() => !window.__coach.ready);
    assert.equal(await page.locator('#cameraStage').evaluate(el => el.classList.contains('is-ready')), false);
    assert.equal(await page.locator('#readinessTitle').innerText(), 'CHECKS INCOMPLETE');
    assert.equal(await page.locator('#captureNow').isEnabled(), true);
    await page.screenshot({ path: 'test-results/camera-incomplete.png', fullPage: true });
    await page.evaluate(() => { window.__coach.tilt.read = () => ({ roll: 0, pitch: 5, rollValid: true }); });
    await page.waitForFunction(() => window.__coach.ready);
    await page.evaluate(() => { window.__coach._testWristOffset = .08; });
    await page.waitForFunction(() => !window.__coach.ready);
    assert.equal(await page.locator('#readinessTitle').innerText(), 'HOLD STEADY');
    await page.waitForFunction(() => window.__coach.ready);


    // Connect a mocked gateway, but require real explicit per-session consent.
    assert.equal(aiCalls,0,'no preview uploads without opt-in');
    await page.click('[data-go="settings"]');
    await page.fill('#aiEndpoint','https://frame-ai.test');
    await page.fill('#aiAccessCode','private-access-code-for-camera-tests-123');
    await page.click('#connectAI');
    await page.waitForFunction(()=>document.querySelector('#aiConnectionStatus').textContent.startsWith('Connected.'));
    assert.equal(await page.locator('#aiAccessCode').inputValue(),'');
    await page.click('[data-go="coach"]');
    await page.click('#startCam');
    await page.waitForFunction(()=>window.__coach.running);
    await page.click('#btnAI');
    assert.equal(await page.locator('#aiConsent').isVisible(),true);
    await page.click('#cancelAI');
    assert.equal(aiCalls,0,'cancelled consent does not upload');
    await page.click('#btnAI');
    await page.click('#confirmAI');
    assert.equal(await page.evaluate(()=>window.__coach.facePulse.state),'ready','local face-detail check is available');
    assert.equal(aiCalls,0,'unclear face never becomes AI ready');
    await page.evaluate(()=>{
      const c=window.__coach;
      c.facePulse.stop();
      c.facePulse.sample=()=>{};
      c._testInstant='good';
      c.facePulse.read=()=>({state:c._testInstant,text:c._testInstant==='good'?'Face detail detected':'Face detail is unclear',signature:Array(32).fill(c._testFace ?? .5)});
      const original=c._sceneSnapshot.bind(c);
      c._testBackground=100;
      c._sceneSnapshot=()=>{const s=original();return s&&{...s,signature:Array(192).fill(c._testBackground)};};
    });
    await page.waitForFunction(()=>window.__coach.aiReady,null,{timeout:20000});
    assert.ok(aiCalls>0);
    assert.equal(await page.locator('#readinessTitle').innerText(),'AI SUGGESTS: SHOOT NOW');
    assert.equal(await page.locator('#shutterCue').innerText(),'SHOOT NOW');
    await page.screenshot({path:'test-results/camera-ai-ready.png',fullPage:true});
    const readyStamp = await page.locator('.ready-stamp').boundingBox();
    const readyChips = await page.locator('.hud-top').boundingBox();
    const readyStack = await page.locator('#camStack').boundingBox();
    assert.ok(readyStamp.y >= readyChips.y + readyChips.height + 8, 'AI go-signal clears the live HUD');
    assert.ok(readyStamp.y + readyStamp.height + 8 < readyStack.y, 'AI go-signal clears the floating controls');
    await page.evaluate(()=>window.__coach._testInstant='warn');
    await page.waitForFunction(()=>!window.__coach.aiReady);
    assert.equal(await page.locator('.ready-stamp').evaluate(el=>getComputedStyle(el).opacity),'0');
    assert.equal(await page.locator('#captureNow').isEnabled(),true);
    await page.evaluate(()=>window.__coach._testInstant='good');
    await page.waitForFunction(()=>window.__coach.aiReady,null,{timeout:15000});
    // A facial change withdraws the sampled recommendation until AI checks a fresh preview.
    await page.evaluate(()=>{const c=window.__coach;c.ai.lastAttempt=Infinity;c._testFace=.65;});
    await page.waitForFunction(()=>!window.__coach.aiReady);
    assert.equal(await page.evaluate(()=>window.__coach.ai.gate.result),null);
    await page.evaluate(()=>{window.__coach.ai.lastAttempt=-Infinity;});
    await page.waitForFunction(()=>window.__coach.aiReady,null,{timeout:15000});
    // Background changes invalidate cloud advice even with an unchanged body pose.
    aiMode='uncertain';
    await page.evaluate(()=>{window.__coach._testBackground=140;window.__coach.ai.lastAttempt=-Infinity;});
    await page.waitForFunction(()=>!window.__coach.aiReady);
    await page.waitForFunction(()=>window.__coach.ai.gate.result?.decision==='uncertain',null,{timeout:15000});
    assert.equal(await page.locator('#readinessTitle').innerText(),'BASIC CHECKS PASSED');
    await page.screenshot({path:'test-results/camera-ai-uncertain.png',fullPage:true});
    aiMode='error';
    await page.evaluate(()=>{const c=window.__coach;c.ai.invalidate();c.ai.lastAttempt=-Infinity;});
    await page.waitForFunction(()=>window.__coach.ai.status==='error',null,{timeout:15000});
    assert.equal(await page.evaluate(()=>window.__coach.aiReady),false);
    assert.equal(await page.locator('#captureNow').isEnabled(),true);
    await page.click('#btnAI');
    assert.equal(await page.evaluate(()=>window.__coach.ai.enabled),false);
    const callsAtStop=aiCalls;
    await page.waitForTimeout(700);
    assert.equal(aiCalls,callsAtStop,'stop sharing stops uploads');

    const frame = await page.locator('.camera-preview').boundingBox();
    const stage = await page.locator('#cameraStage').boundingBox();
    const stack = await page.locator('#camStack').boundingBox();
    const shutter = await page.locator('#captureNow').boundingBox();
    assert.ok(frame.height >= stage.height * .95, 'camera fills the shooting stage');
    assert.ok(stack.y > frame.y && stack.y + stack.height <= frame.y + frame.height, 'guidance floats inside the full-screen camera');
    assert.ok(shutter.y + shutter.height <= 844 - 58, 'shutter remains above navigation');

    await page.click('#captureNow');
    await page.waitForFunction(() => document.querySelector('#captureCount').textContent === '1');
    await page.click('#viewCaptures');
    await page.waitForSelector('#reviewGrid .shot img');
    assert.equal(await page.locator('#reviewGrid .shot').count(), 1);
    assert.equal(await page.evaluate(() => window.__coach.running), false);
    await page.waitForFunction(() => document.querySelector('#toast').hidden);
    await page.screenshot({ path: 'test-results/camera-review.png', fullPage: true });
    // Even the final photo must remain reachable with the checklist collapsed.
    await page.locator('#localChecklist').evaluate(el => { el.hidden = true; });
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const saveBounds = await page.getByRole('button', { name: 'Save photo', exact: true }).boundingBox();
    const navBounds = await page.locator('#tabbar').boundingBox();
    assert.ok(saveBounds.y + saveBounds.height <= navBounds.y, 'last photo save button clears fixed navigation');
    const [saved] = await Promise.all([
      page.waitForEvent('download', { timeout: 45000 }),
      page.getByRole('button', { name: 'Save photo', exact: true }).click({ timeout: 15000 }),
    ]);
    const filepath = await saved.path();
    const bytes = fs.readFileSync(filepath);
    assert.equal(bytes[0], 0xff);
    assert.equal(bytes[1], 0xd8);
    assert.ok(bytes.length > 1000, 'captured JPEG contains image data');

    // All existing navigation remains usable.
    for (const view of ['styles', 'settings', 'coach']) {
      await page.click('[data-go="' + view + '"]');
      assert.equal(await page.locator('#view-' + view).isVisible(), true);
      assert.equal(/[㐀-鿿]/.test(await page.locator('body').innerText()), false, 'visible UI is English');
    }
    await page.setViewportSize({ width: 360, height: 740 });
    await page.click('#idleStyle');
    await page.click('[data-style="travel"]');
    await page.click('#startCam');
    await page.waitForFunction(() => window.__coach.running);
    await page.waitForFunction(() => window.__coach._tip.shown?.key === 'style-space');
    assert.equal(await page.locator('#activeStyleName').innerText(), 'Travel Story');
    await page.waitForFunction(() => document.querySelector('#toast').hidden);
    await page.screenshot({ path: 'test-results/camera-small.png', fullPage: true });
    const smallShutter = await page.locator('#captureNow').boundingBox();
    assert.ok(smallShutter.y + smallShutter.height <= 740 - 58, 'small phone shutter remains reachable');
    await page.click('#btnStop');
    assert.equal(await page.evaluate(() => window.__coach.stream), null);
    assert.deepEqual(errors, []);
    console.log('Browser smoke passed: bundled model, readiness UI, capture/download, navigation, phone layouts, cleanup, AI consent/readiness/expiry and errors.');
    await context.close();
  } catch (error) {
    if (page) {
      await page.screenshot({ path: 'test-results/camera-failure.png', fullPage: true }).catch(() => {});
      console.error(await page.locator('#reviewGrid').innerText().catch(() => 'review unavailable'));
    }
    throw error;
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
