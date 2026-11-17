// Upgrade 1.2.2 (cache-first SW) → 1.2.4: noul UI trebuie să se încarce, IndexedDB rămâne.
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = '/tmp/lso-sw-upgrade';
const PORT = Number(process.env.SW_PORT || 8768);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
};

function listWebFiles(from) {
  const out = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (['android', 'node_modules', 'tests', 'dist', 'screenshots', '.git', 'tools'].includes(ent.name)) continue;
        walk(p);
      } else out.push(p);
    }
  };
  walk(from);
  return out;
}

function extract122() {
  fs.rmSync(FIX, { recursive: true, force: true });
  fs.mkdirSync(FIX, { recursive: true });
  const r = spawnSync('git', ['archive', '7aedd04'], { cwd: ROOT, encoding: 'buffer', maxBuffer: 80 * 1024 * 1024 });
  if (r.status !== 0) throw new Error('git archive 1.2.2 failed: ' + (r.stderr || ''));
  const tar = spawnSync('tar', ['-x', '-C', FIX], { input: r.stdout, maxBuffer: 80 * 1024 * 1024 });
  if (tar.status !== 0) throw new Error('tar extract failed');
}

function copy124into(dest, { keepOldSw = false } = {}) {
  const rels = [
    'index.html', 'sw.js', 'manifest.webmanifest', 'css', 'js', 'i18n', 'icons', 'fonts',
  ];
  for (const rel of rels) {
    if (keepOldSw && rel === 'sw.js') continue;
    const src = path.join(ROOT, rel);
    const dst = path.join(dest, rel);
    if (!fs.existsSync(src)) continue;
    const st = fs.statSync(src);
    if (st.isDirectory()) {
      fs.cpSync(src, dst, { recursive: true });
    } else {
      fs.copyFileSync(src, dst);
    }
  }
}

function startServer(root, { pinSw = null } = {}) {
  const state = { pinSw, root };
  const server = http.createServer((req, res) => {
    try {
      const u = new URL(req.url, 'http://127.0.0.1');
      let rel = decodeURIComponent(u.pathname);
      if (rel.endsWith('/')) rel += 'index.html';
      rel = rel.replace(/^\/+/, '');
      if (rel === 'sw.js' && state.pinSw) {
        const body = fs.readFileSync(state.pinSw);
        res.writeHead(200, { 'content-type': MIME['.js'], 'cache-control': 'no-cache' });
        res.end(body);
        return;
      }
      const file = path.join(state.root, rel);
      if (!file.startsWith(state.root)) { res.writeHead(403); res.end(); return; }
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
      const ext = path.extname(file);
      res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': 'no-cache' });
      fs.createReadStream(file).pipe(res);
    } catch (e) {
      res.writeHead(500); res.end(String(e));
    }
  });
  return new Promise((resolve, reject) => {
    server.listen(PORT, '127.0.0.1', () => resolve({ server, state }));
    server.on('error', reject);
  });
}

const FLUSH = `(function(){
  var VER='1.2.4';
  if(sessionStorage.getItem('lso_sw_gone')===VER) return;
  Promise.resolve().then(function(){return (async function(){
    try {
      var had=false;
      if('serviceWorker' in navigator){
        var regs=await navigator.serviceWorker.getRegistrations();
        had=regs.length>0;
        await Promise.all(regs.map(function(r){return r.unregister();}));
      }
      if(window.caches){
        var keys=await caches.keys();
        await Promise.all(keys.filter(function(k){return k.indexOf('lso-cache-')===0;}).map(function(k){return caches.delete(k);}));
      }
      sessionStorage.setItem('lso_sw_gone', VER);
      if(had) location.reload();
    } catch(e) {}
  })();});
})()`;

function assert(c, m) { if (!c) throw new Error(m || 'assert'); }

async function waitForVersion(page, ver, ms = 20000) {
  const t0 = Date.now();
  let last = '';
  while (Date.now() - t0 < ms) {
    last = await page.evaluate(() => (window.LSO && window.LSO.version) || document.documentElement.dataset.appVersion || '').catch(() => '');
    if (last === ver) return last;
    await page.waitForTimeout(300);
  }
  throw new Error('versiunea așteptată ' + ver + ', am ' + last);
}

async function seedMarker(page) {
  await page.evaluate(async () => {
    await new Promise((resolve, reject) => {
      const req = indexedDB.open('lso_db');
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        try {
          const db = req.result;
          localStorage.setItem('lso_sw_upgrade_mark', 'keep-me-123');
          db.close();
          resolve();
        } catch (e) { reject(e); }
      };
    });
  });
}

async function markerAlive(page) {
  return page.evaluate(() => localStorage.getItem('lso_sw_upgrade_mark'));
}

async function cacheNames(page) {
  return page.evaluate(async () => window.caches ? await caches.keys() : []);
}

const results = [];
let failed = 0;

async function withBrowser(fn) {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({
    viewport: { width: 360, height: 780 },
    hasTouch: true,
    isMobile: true,
    serviceWorkers: 'allow',
  });
  await ctx.addInitScript(() => { try { localStorage.setItem('lso_newsOb', 'true'); } catch {} });
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  try { await fn({ browser, ctx, page }); }
  finally { await browser.close(); }
}

async function testPwaUpgrade({ server, state }) {
  extract122();
  state.pinSw = null;
  await withBrowser(async ({ page }) => {
    await page.goto(`http://127.0.0.1:${PORT}/index.html`);
    await page.waitForSelector('.tab-pill', { timeout: 20000 });
    await page.evaluate(async () => { if (navigator.serviceWorker) await navigator.serviceWorker.ready; });
    const v0 = await page.evaluate(() => (window.LSO && window.LSO.version) || '');
    assert(v0 === '1.2.2', 'ar trebui 1.2.2 la start, am ' + v0);
    const caches0 = await cacheNames(page);
    assert(caches0.some(k => k.includes('lso-cache-v1.2.2')), 'lipsește cache 1.2.2: ' + caches0.join(','));
    await seedMarker(page);

    copy124into(FIX, { keepOldSw: false });
    await page.evaluate(async () => {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.update()));
    });
    // așteaptă SW nou + claim, apoi reîncarcă (posibil de două ori)
    for (let i = 0; i < 4; i++) {
      await page.waitForTimeout(800);
      await page.reload({ waitUntil: 'domcontentloaded' });
      const v = await page.evaluate(() => (window.LSO && window.LSO.version) || document.documentElement.dataset.appVersion || '').catch(() => '');
      if (v === '1.2.4') break;
    }
    await page.waitForSelector('.tab-pill', { timeout: 20000 });
    await waitForVersion(page, '1.2.4');
    assert((await markerAlive(page)) === 'keep-me-123', 's-au pierdut datele locale la upgrade');
    const caches1 = await cacheNames(page);
    assert(!caches1.some(k => k.includes('lso-cache-v1.2.2')), 'cache-ul 1.2.2 a rămas: ' + caches1.join(','));

    // UI nou: punem un mock SR, pornim dictarea, bara compactă, fără balon alb
    await page.evaluate(() => {
      class MockSR {
        constructor() { this.onresult = null; this.onerror = null; this.onend = null; window.__lsoSR = this; }
        start() { window.__lsoSR = this; }
        stop() { if (this.onend) this.onend(); }
        abort() { this.stop(); }
      }
      window.SpeechRecognition = window.webkitSpeechRecognition = MockSR;
    });
    await page.locator('.tab-pill', { hasText: 'Taskuri' }).first().tap();
    await page.locator('[data-test=fab-voice]').tap();
    await page.locator('.m-sheet .sheet-opt', { hasText: 'Dictare' }).tap();
    await page.locator('#punct-pill').waitFor();
    const ui = await page.evaluate(() => {
      const bar = document.getElementById('punct-pill');
      const cs = bar ? getComputedStyle(bar) : null;
      const bg = cs ? cs.backgroundColor : '';
      const m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([0-9.]+))?\)/);
      return {
        hasBubble: !!document.querySelector('.dict-bubble'),
        hasBar: !!bar,
        alpha: m && m[4] != null ? Number(m[4]) : (m ? 1 : -1),
        version: (window.LSO && window.LSO.version) + ' (' + (window.LSO && window.LSO.versionCode) + ')',
      };
    });
    assert(!ui.hasBubble, 'balonul alb e încă prezent după upgrade');
    assert(ui.hasBar, 'lipsește bara compactă după upgrade');
    assert(ui.alpha > 0.45 && ui.alpha < 0.75, 'bara nu e semi-transparentă: ' + JSON.stringify(ui));
    await page.locator('[data-test=dict-stop]').tap().catch(() => {});
    if (await page.locator('[data-test=editor] .m-back').count()) {
      await page.locator('[data-test=editor] .m-back').tap();
      const confirmDa = page.locator('[data-test=confirm] .m-actions .btn').last();
      if (await confirmDa.isVisible().catch(() => false)) await confirmDa.tap();
      await page.locator('[data-test=editor]').first().waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
    }
    await page.locator('[data-test=hdr-brand]').tap();
    const ver = page.locator('[data-test=app-version]');
    await ver.waitFor();
    await ver.scrollIntoViewIfNeeded();
    const verTxt = ((await ver.textContent()) || '').trim();
    assert(/Versiunea 1\.2\.4 \(27\)/.test(verTxt), 'footer Setări: ' + verTxt);
  });
}

async function testNativeFlush({ server, state }) {
  extract122();
  const sw122 = path.join(FIX, 'sw.js.122');
  fs.copyFileSync(path.join(FIX, 'sw.js'), sw122);
  state.pinSw = sw122; // browserul nu vede sw.js 1.2.4 — ca pe telefon, unde native nu reînregistrează SW
  await withBrowser(async ({ page }) => {
    await page.goto(`http://127.0.0.1:${PORT}/index.html`);
    await page.waitForSelector('.tab-pill', { timeout: 20000 });
    await page.evaluate(async () => { if (navigator.serviceWorker) await navigator.serviceWorker.ready; });
    assert((await page.evaluate(() => window.LSO && window.LSO.version)) === '1.2.2', 'start 1.2.2');
    await seedMarker(page);
    copy124into(FIX, { keepOldSw: true });
    // reload: SW 1.2.2 cache-first + ignoreSearch servește HTML/JS vechi, deși pe disc e 1.2.4
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.tab-pill', { timeout: 20000 });
    const stuck = await page.evaluate(() => (window.LSO && window.LSO.version) || '');
    assert(stuck === '1.2.2', 'reproducere eșuată — pagina s-a actualizat fără flush, am ' + stuck);

    await page.evaluate(FLUSH);
    for (let i = 0; i < 5; i++) {
      await page.waitForTimeout(600);
      const v = await page.evaluate(() => (window.LSO && window.LSO.version) || document.documentElement.dataset.appVersion || '').catch(() => '');
      if (v === '1.2.4') break;
    }
    await page.waitForSelector('.tab-pill', { timeout: 20000 });
    await waitForVersion(page, '1.2.4');
    assert((await markerAlive(page)) === 'keep-me-123', 'flush-ul a șters datele utilizatorului');
    const cssHas = await page.evaluate(() => {
      const s = [...document.styleSheets].flatMap(ss => {
        try { return [...ss.cssRules].map(r => r.cssText); } catch { return []; }
      }).join('\n');
      return /rgba\(\s*11,\s*26,\s*51,\s*0\.6/.test(s) || /punct-pill/.test(s);
    });
    assert(cssHas, 'CSS 1.2.4 nu s-a încărcat după flush');
  });
}

const { server, state } = await startServer(FIX);
try {
  for (const [name, fn] of [
    ['PWA 1.2.2 cache-first → 1.2.4 UI nou, date păstrate', testPwaUpgrade],
    ['SW vechi cache-first blochează 1.2.4 până la flush nativ, apoi UI nou', testNativeFlush],
  ]) {
    const t0 = Date.now();
    try {
      await fn({ server, state });
      results.push(`PASS ${name} (${Date.now() - t0} ms)`);
      console.log('PASS', name);
    } catch (e) {
      failed++;
      results.push(`FAIL ${name}: ${e.message}`);
      console.log('FAIL', name, e.message, e.stack);
    }
  }
} finally {
  server.close();
}
console.log('\n--- SW upgrade ---\n' + results.join('\n'));
if (failed) process.exit(1);
