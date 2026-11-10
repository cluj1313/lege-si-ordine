// Test automat LEGE ȘI ORDINE: viewport 360x780 și 412x915, touch, CPU încetinit (4x).
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://127.0.0.1:8765/index.html';
const SHOTS = new URL('../screenshots/', import.meta.url).pathname;
fs.mkdirSync(SHOTS, { recursive: true });
const results = [];
let failed = 0;

let curPage = null, failN = 0;
async function step(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push(`PASS ${name} (${Date.now() - t0} ms)`); console.log('PASS', name); }
  catch (e) {
    failed++; failN++;
    const where = (e.stack || '').split('\n').find(l => l.includes('e2e.mjs')) || '';
    results.push(`FAIL ${name}: ${e.message.split('\n')[0]} ${where.trim()}`); console.log('FAIL', name, e.message.split('\n')[0], where);
    if (curPage) { await curPage.screenshot({ path: `/tmp/fail-${failN}.png` }).catch(() => {}); await curPage.reload().catch(() => {}); await curPage.waitForSelector('.tab-pill').catch(() => {}); }
  }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'assert'); };

async function run(vp, label, full) {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const ctx = await browser.newContext({
    viewport: vp, hasTouch: true, isMobile: true, deviceScaleFactor: 2, locale: 'ro-RO', acceptDownloads: true, permissions: ['microphone'],
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.230 Mobile Safari/537.36',
  });
  const p = await ctx.newPage(); curPage = p;
  p.setDefaultTimeout(10000);
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const errors = [];
  p.on('console', m => { if (m.type() === 'error' || (m.type() === 'warning' && !/i18n/.test(m.text()) === false)) errors.push(`${m.type()}: ${m.text()}`); });
  p.on('pageerror', e => errors.push('pageerror: ' + e.message));

  const tap = async (sel) => { await p.locator(sel).first().waitFor({ state: 'visible', timeout: 8000 }); await p.locator(sel).first().tap(); };
  const gone = async (sel) => p.locator(sel).first().waitFor({ state: 'detached', timeout: 8000 });
  const sheetOpt = async (text) => tap(`.m-sheet .sheet-opt:has-text("${text}")`);
  const pin = async (digits) => { for (const d of digits) await tap(`[data-test=pin] .pin-key[data-k="${d}"]`); };
  const yes = async () => { await tap('[data-test=confirm] .m-actions .btn:last-child'); await gone('[data-test=confirm]'); };
  const goTab = async (name) => { await p.locator('.tab-pill', { hasText: name }).first().scrollIntoViewIfNeeded(); await p.locator('.tab-pill', { hasText: name }).first().tap(); await p.waitForTimeout(150); };
  const longPress = async (sel) => {
    await p.locator(sel).first().scrollIntoViewIfNeeded();
    await p.locator(sel).first().evaluate(el => { const r = el.getBoundingClientRect(); el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.x + 10, clientY: r.y + 10, pointerId: 7, pointerType: 'touch' })); });
    await p.waitForTimeout(800);
    await p.locator(sel).first().evaluate(el => el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7, pointerType: 'touch' })));
  };
  const openSet = async () => { await tap('#hdr-brand'); await p.locator('[data-test=settings]').waitFor(); await p.waitForTimeout(260); };
  const noToasts = async () => { await p.evaluate(() => document.querySelectorAll('#toasts .toast').forEach(t => t.remove())); };
  const dragTo = async (src, dst, { hold = 600, fx = 0.5, fy = 0.5, sx = 0.35 } = {}) => {
    await p.locator(src).first().scrollIntoViewIfNeeded();
    const a = await p.locator(src).first().boundingBox();
    const x0 = a.x + a.width * sx, y0 = a.y + a.height / 2;
    await p.mouse.move(x0, y0); await p.mouse.down(); await p.waitForTimeout(hold);
    const b = await p.locator(dst).first().boundingBox();
    const tx = b.x + b.width * fx, ty = b.y + b.height * fy;
    for (let i = 1; i <= 14; i++) { await p.mouse.move(x0 + (tx - x0) * i / 14, y0 + (ty - y0) * i / 14); await p.waitForTimeout(16); }
    await p.waitForTimeout(150); await p.mouse.up(); await p.waitForTimeout(250);
  };
  const tabOrder = () => p.$$eval('.tab-pill[data-id]', els => els.map(e => e.querySelector('.tp-name').textContent.trim()));
  const kv = key => p.evaluate(k => new Promise(res => { const r = indexedDB.open('lso_db'); r.onsuccess = () => { const q = r.result.transaction('lso_kv').objectStore('lso_kv').get(k); q.onsuccess = () => res(q.result && q.result.v); }; }), key);
  const search = async (q) => { await tap('#hdr-search'); await p.locator('[data-test=search-input]').fill(q); };
  const save = async () => { await tap('[data-test=editor] .m-actions .btn.primary'); await gone('[data-test=editor]'); };
  const noOverflow = async () => { const o = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); assert(o <= 1, 'depășire orizontală ' + o + 'px'); };
  const idbItems = () => p.evaluate(() => new Promise(res => { const r = indexedDB.open('lso_db'); r.onsuccess = () => { const q = r.result.transaction('lso_items').objectStore('lso_items').getAll(); q.onsuccess = () => res(q.result); }; }));
  const assertModalFit = async (sel) => {
    const r = await p.locator(sel).evaluate(el => {
      const ov = el.closest('.m-overlay');
      const box = el.classList.contains('m-box') ? el : (el.closest('.m-box') || el);
      const br = box.getBoundingClientRect();
      const btns = [...box.querySelectorAll('.m-actions .btn')].map(b => {
        const x = b.getBoundingClientRect();
        return { t: (b.textContent || '').trim(), l: x.left, r: x.right, top: x.top, b: x.bottom };
      });
      const titles = [...box.querySelectorAll('.m-title')].map(t => t.textContent.trim());
      return {
        ovOp: getComputedStyle(ov).opacity, open: ov.classList.contains('open'), boxOp: getComputedStyle(box).opacity,
        br: { l: br.left, r: br.right, t: br.top, b: br.bottom },
        vw: window.innerWidth, vh: window.innerHeight, btns, titles,
        buried: [...document.querySelectorAll('.m-overlay')].filter(o => o !== ov).map(o => getComputedStyle(o).visibility),
      };
    });
    assert(r.ovOp === '1' && r.open && r.boxOp === '1', 'fereastra nu e opacă: ' + JSON.stringify(r));
    assert(r.br.l >= -1 && r.br.r <= r.vw + 1 && r.br.t >= -1 && r.br.b <= r.vh + 1, 'dialog în afara ecranului: ' + JSON.stringify(r.br) + ' vw=' + r.vw);
    if (r.btns.length) assert(r.btns.every(b => b.l >= -1 && b.r <= r.vw + 1 && b.top >= -1 && b.b <= r.vh + 1), 'butoane tăiate: ' + JSON.stringify(r.btns));
    assert(r.titles.length <= 1, 'titlu dublat: ' + r.titles.join('|'));
    assert(r.buried.every(v => v === 'hidden'), 'modala de dedesubt încă se vede');
  };
  const pickFromSheet = async (field, sheet, name) => {
    await p.locator(`[data-test=${field}]`).tap();
    await p.locator(`[data-test=${sheet}]`).waitFor();
    await p.locator(`[data-test=${sheet}] .sheet-opt`, { hasText: name }).first().tap();
    await gone(`[data-test=${sheet}]`);
  };

  await step(`[${label}] pornire fără erori`, async () => {
    await p.goto(BASE);
    await p.waitForSelector('.tab-pill', { timeout: 15000 });
    await p.waitForTimeout(800);
    const tabs = await p.$$eval('.tab-pill', els => els.map(e => e.textContent.trim()));
    assert(tabs.join('|') === 'Taskuri|Urgențe|Dosare|Clienți|Termene|Documente|Legi|Monitorul Oficial|Ultimele noutăți|Salvate|Foldere|RECORDINGS 🔴|+', 'ordine taburi: ' + tabs.join('|'));
    assert(await p.evaluate(() => getComputedStyle(document.querySelector('.top')).position) === 'sticky', 'header nefixat');
    const ff = await p.evaluate(() => getComputedStyle(document.body).fontFamily + ' ' + getComputedStyle(document.body).fontWeight);
    assert(/Oswald/.test(ff) && /300/.test(ff), 'font ' + ff);
  });

  const tabNames = ['Taskuri', 'Urgențe', 'Dosare', 'Clienți', 'Termene', 'Documente', 'Legi', 'Monitorul Oficial', 'Ultimele noutăți', 'Salvate', 'Foldere', 'RECORDINGS'];
  await step(`[${label}] toate taburile se deschid, fără depășire pe lățime`, async () => {
    for (const n of tabNames) {
      await goTab(n);
      assert(await p.locator('#view').evaluate(v => v.children.length > 0), 'gol: ' + n);
      await noOverflow();
      // text tăiat: niciun element din vizualizare nu iese din ecran
      const cut = await p.evaluate(() => [...document.querySelectorAll('#view *')].filter(e => { const r = e.getBoundingClientRect(); return r.width && r.right > window.innerWidth + 1 && !e.closest('.subtabs,.folder-strip,.pill-row,.day-sum'); }).map(e => e.className).slice(0, 3));
      assert(!cut.length, `${n}: elemente în afara ecranului ${cut}`);
      if (full) await p.screenshot({ path: `${SHOTS}${label}-${n.replace(/\s+/g, '-').toLowerCase()}.png` });
    }
  });

  await step(`[${label}] clienți: 2 rânduri, rândul 2 apare/dispare la atingere, deschide elementul`, async () => {
    await goTab('Clienți');
    const c = p.locator('#view .card').first();
    assert(await c.locator('.r2').count() === 0, 'rândul 2 vizibil inițial');
    const t1 = await c.locator('.r1t').textContent();
    assert(/ – /.test(t1), 'rând 1 fără „Nume – ce reprezintă”: ' + t1);
    await c.locator('.r1').tap();
    await p.locator('#view .card.open .r2').first().waitFor();
    const r2 = await p.locator('#view .card.open .r2').first().textContent();
    assert(/Termen \d{2}\/\d{2}\/\d{4} • \d{2}:\d{2}/.test(r2), 'termen DD/MM/YYYY • HH:MM lipsă: ' + r2);
    assert(await p.locator('#view .card.open .r2 .pill.stage').count() === 1, 'pastilă stadiu lipsă');
    if (full) await p.screenshot({ path: `${SHOTS}${label}-clienti-deschis.png` });
    await p.locator('#view .card.open .r1').first().tap();
    assert(await p.locator('#view .card .r2').count() === 0, 'nu s-a închis');
    await p.locator('#view .card .r1').first().tap();
    await p.locator('#view .card.open .r2').first().tap({ position: { x: 20, y: 12 } });
    await p.locator('[data-test=editor]').waitFor();
    await tap('[data-test=editor] .m-actions .btn.ghost:not(.more)');
    await gone('[data-test=editor]');
  });

  if (!full) { await finish(); return; }

  await step(`[${label}] taskuri: text multilinie, Enter = linie nouă, subtaskuri, bifare, terminate jos`, async () => {
    await goTab('Taskuri');
    await tap('[data-test=fab-add]');
    const ta = p.locator('[data-test=editor] textarea[data-k=text]');
    await ta.tap(); await ta.type('Termen apel Vasilescu'); await p.keyboard.press('Enter'); await ta.type('a doua linie');
    assert((await ta.inputValue()).includes('\n'), 'Enter nu a creat linie nouă');
    assert(await p.locator('[data-test=editor]').count() === 1, 'Enter a salvat/închis editorul');
    const sub = p.locator('[data-test=editor] input[placeholder="Subtask nou…"]');
    await sub.tap(); await sub.fill('Sub unu'); await p.keyboard.press('Enter'); await sub.fill('Sub doi'); await p.keyboard.press('Enter');
    assert(await p.locator('[data-test=editor] .subs .sub').count() === 2, 'subtaskuri');
    await save();
    const card = p.locator('#view .card', { hasText: 'Termen apel Vasilescu' });
    await card.locator('.r1').tap();
    await card.locator('.subs .sub').first().waitFor();
    // linia de legătură doar între cercuri
    const conn = await card.locator('.subs .sub').nth(1).evaluate(el => getComputedStyle(el, '::before').height);
    assert(conn === '10px', 'linie de legătură ' + conn);
    await card.locator('.r1 .circ').tap();
    await p.waitForTimeout(400);
    const last = await p.locator('#view .card').last().textContent();
    assert(last.includes('Termen apel Vasilescu'), 'taskul terminat nu e jos');
    assert(await p.locator('#view .card.done').count() >= 1, 'nu e estompat');
  });

  await step(`[${label}] dosar: creare, editare, ștergere → Coș → restaurare`, async () => {
    await goTab('Dosare');
    await tap('[data-test=fab-add]');
    await p.locator('[data-test=editor] [data-k=title]').fill('Țărănescu contra Ștefănescu');
    const date = p.locator('[data-test=editor] .date-inp').first();
    await date.fill(''); await date.type('15122026');
    assert(await date.inputValue() === '15/12/2026', 'mască dată: ' + await date.inputValue());
    await p.locator('[data-test=editor] .time-inp').first().type('0930');
    await p.locator('[data-test=editor] .stage-pick .st-acte').tap();
    await save();
    const card = p.locator('#view .card', { hasText: 'Țărănescu contra Ștefănescu' });
    await card.waitFor();
    await card.locator('.r1').tap();
    const r2 = await card.locator('.r2').textContent();
    assert(r2.includes('15/12/2026 • 09:30') && r2.includes('Așteaptă acte'), 'rând 2: ' + r2);
    await card.locator('.r2').tap({ position: { x: 20, y: 12 } });
    await p.locator('[data-test=editor] [data-k=title]').fill('Țărănescu contra Ștefănescu – apel');
    await save();
    await p.locator('#view .card', { hasText: '– apel' }).waitFor();
    await p.locator('#view .card', { hasText: '– apel' }).locator('.r2').tap({ position: { x: 20, y: 12 } });
    await tap('[data-test=editor] .m-actions .more');
    await sheetOpt('Șterge');
    await yes();
    await gone('[data-test=editor]');
    assert(await p.locator('#view .card', { hasText: '– apel' }).count() === 0, 'nu a dispărut din listă');
    await tap('#hdr-menu'); await tap('[data-test=menu-trash]');
    const row = p.locator('[data-test=trash] .trash-row', { hasText: '– apel' });
    await row.waitFor();
    await row.locator('[data-test=restore]').tap();
    await p.waitForTimeout(300);
    await tap('[data-test=trash] .m-back'); await gone('[data-test=trash]');
    await p.locator('#view .card', { hasText: '– apel' }).waitFor();
  });

  await step(`[${label}] căutare: diacritice, AND, parțial, rând secundar, Coș marcat, salt la element`, async () => {
    await tap('#hdr-search');
    const q = p.locator('[data-test=search-input]');
    await q.fill('taranescu');
    await p.locator('[data-test=search] .sr', { hasText: 'Țărănescu' }).first().waitFor();
    await q.fill('taran stef');
    assert(await p.locator('[data-test=search] .sr', { hasText: 'Țărănescu' }).count() >= 1, 'AND parțial');
    await q.fill('taranescu inexistent');
    await p.waitForTimeout(400);
    assert(await p.locator('[data-test=search] .sr[data-id]').count() === 0, 'AND trebuia să excludă');
    await q.fill('judecatoria sectorului');
    await p.locator('[data-test=search] .sr[data-id]').first().waitFor();
    await q.fill('asteapta acte');
    await p.locator('[data-test=search] .sr', { hasText: 'Țărănescu' }).first().waitFor();
    await p.locator('[data-test=search] .sr', { hasText: 'Țărănescu' }).first().tap();
    await gone('[data-test=search]');
    await p.locator('#view .card.open', { hasText: 'Țărănescu' }).waitFor();
    // în Coș: mutăm un element și îl căutăm
    await goTab('Urgențe');
    await p.locator('#view .card .r1').first().tap();
    await p.locator('#view .card.open .r2').first().tap({ position: { x: 20, y: 12 } });
    await tap('[data-test=editor] .m-actions .more'); await sheetOpt('Șterge'); await yes(); await gone('[data-test=editor]');
    await tap('#hdr-search');
    await p.locator('[data-test=search-input]').fill('intampinare');
    await p.locator('[data-test=search] .sr.in-trash .trash-mark').first().waitFor();
    await p.locator('[data-test=search] .sr.in-trash').first().tap();
    await p.locator('[data-test=trash] .trash-row.flash').waitFor();
    await p.locator('[data-test=trash] .trash-row.flash [data-test=restore]').tap();
    await tap('[data-test=trash] .m-back'); await gone('[data-test=trash]');
  });

  await step(`[${label}] lacăt pe element: criptare reală (PBKDF2+AES-GCM), ascuns în căutare, deblocare cu PIN`, async () => {
    await goTab('Urgențe');
    await tap('[data-test=fab-add]');
    await p.locator('[data-test=editor] [data-k=title]').fill('Strategie confidențială');
    await p.locator('[data-test=editor] textarea[data-k=text]').fill('cod secret martor ZXQ');
    await save();
    const card = p.locator('#view .card', { hasText: 'Strategie confidențială' });
    await card.locator('.r1').tap(); await card.locator('.r2').tap({ position: { x: 20, y: 12 } });
    await tap('[data-test=editor] .m-actions .more'); await sheetOpt('Blochează cu PIN');
    await pin('1234'); await pin('1234');
    await p.waitForFunction(() => document.querySelectorAll('[data-test=pin]').length === 0);
    await p.waitForTimeout(500);
    await tap('[data-test=editor] .m-actions .btn.ghost:not(.more)'); await gone('[data-test=editor]');
    await p.locator('#view .card.locked').first().waitFor();
    const items = await idbItems();
    const raw = JSON.stringify(items.filter(i => i.lock));
    assert(items.some(i => i.lock && i.sec && i.sec.ct && !i.data), 'înregistrarea nu e criptată');
    assert(!/ZXQ|confiden/i.test(raw), 'text în clar în IndexedDB');
    await tap('#hdr-search'); await p.locator('[data-test=search-input]').fill('ZXQ');
    await p.locator('[data-test=search] .locked-hint').waitFor();
    assert(await p.locator('[data-test=search] .sr[data-id]').count() === 0, 'conținut blocat vizibil în căutare');
    await p.locator('[data-test=search] .locked-hint .btn').first().tap();
    await pin('9999');
    await p.locator('[data-test=pin] .pin-msg', { hasText: 'PIN greșit' }).waitFor();
    await pin('1234');
    await p.locator('[data-test=search] .sr', { hasText: 'Strategie' }).first().waitFor();
    await tap('[data-test=search] .m-back'); await gone('[data-test=search]');
  });

  await step(`[${label}] lacăt pe tab: conținutul tabului criptat, ecran „e blocat”, reblocare la ieșire`, async () => {
    await goTab('Documente');
    await longPress('.tab-pill.active');
    await sheetOpt('Blochează cu PIN');
    await pin('4321'); await pin('4321');
    await p.waitForTimeout(1500);
    const items = await idbItems();
    const docs = items.filter(i => i.kind === 'document');
    assert(docs.length && docs.every(i => i.sec && !i.data), 'documentele tabului nu sunt criptate');
    await goTab('Termene'); await goTab('Documente');
    await p.locator('.locked-screen').waitFor();
    if (full) await p.screenshot({ path: `${SHOTS}${label}-tab-blocat.png` });
    await tap('[data-test=unlock-tab]'); await pin('4321');
    await p.locator('#view .card', { hasText: 'Cerere de chemare' }).waitFor();
    // deblocare permanentă (curățenie)
    await longPress('.tab-pill.active'); await sheetOpt('Deblochează permanent'); await pin('4321');
    await p.waitForTimeout(1500);
    const after = (await idbItems()).filter(i => i.kind === 'document');
    assert(after.every(i => i.data && !i.sec), 'nu s-a decriptat la deblocarea permanentă');
  });

  await step(`[${label}] [NOU] Setări: panou din stânga deschis din logo/titlu, ca în Notis`, async () => {
    await openSet();
    await p.locator('[data-test=settings]').waitFor();
    assert(await p.locator('[data-test=settings] [data-test=set-name]').count() === 1, 'câmpul Nume');
    assert(await p.locator('[data-test=remind-urgents]').count() === 1, 'amintește urgențele');
    await p.locator('[data-test=settings] details.set-sec[data-sec=backup]').evaluate(el => { el.open = true; });
    await p.locator('[data-test=bk-manual]').waitFor();
    await p.locator('[data-test=bk-auto]').waitFor();
    assert(await p.locator('[data-test=export]').count() === 1, 'salvează backup');
    assert(await p.locator('[data-test=weekly-backup]').count() === 1, 'copie săptămânală');
    if (label === '412x915') {
      await p.screenshot({ path: `${SHOTS}${label}-setari.png` });
      await p.locator('[data-test=settings] details.set-sec[data-sec=backup]').evaluate(el => el.scrollIntoView({ block: 'start' }));
      await p.screenshot({ path: `${SHOTS}${label}-setari-backup.png` });
    } else {
      await p.screenshot({ path: `${SHOTS}${label}-setari.png` });
    }
    await tap('[data-test=settings] .m-back'); await gone('[data-test=settings]');
  });

  await step(`[${label}] setări: reordonare taburi cu ≡ (pointer) și ascundere`, async () => {
    await openSet();
    await p.locator('[data-test=settings] details[data-sec=tabs] summary').tap();
    const rows = p.locator('[data-test=tab-order] .to-row');
    await rows.first().waitFor();
    const h1 = await rows.nth(0).locator('.drag').boundingBox();
    const h3 = await rows.nth(2).locator('.drag').boundingBox();
    await p.mouse.move(h1.x + h1.width / 2, h1.y + h1.height / 2);
    await p.mouse.down();
    for (let i = 1; i <= 8; i++) await p.mouse.move(h1.x + h1.width / 2, h1.y + h1.height / 2 + ((h3.y + h3.height - h1.y) * i / 8), { steps: 2 });
    await p.mouse.up();
    await p.waitForTimeout(500);
    const order = await rows.evaluateAll(r => r.map(x => x.querySelector('.to-name').textContent.trim()));
    assert(order[2] === 'Taskuri' || order[1] === 'Taskuri', 'reordonare: ' + order.slice(0, 4).join(','));
    await tap('[data-test=settings] .m-back'); await gone('[data-test=settings]');
    const bar = await p.$$eval('.tab-pill', els => els.map(e => e.textContent.trim()));
    assert(bar[0] !== 'Taskuri', 'bara de taburi nu s-a actualizat: ' + bar.slice(0, 3));
    // mută înapoi prin drag and drop în bara de taburi (apăsare lungă + tragere)
    for (let i = 0; i < 4 && (await tabOrder())[0] !== 'Taskuri'; i++) {
      await p.evaluate(() => { document.querySelector('#tabbar').scrollLeft = 0; });
      await dragTo('.tab-pill[data-id]:has-text("Taskuri")', '.tab-pill[data-id] >> nth=0', { fx: 0.1 });
    }
    assert((await tabOrder())[0] === 'Taskuri', 'drag tab înapoi: ' + (await tabOrder()).slice(0, 3));
  });

  await step(`[${label}] Foldere: Folder 1/2/3 orizontal cu contor, intrare în folder`, async () => {
    await tap('#hdr-folders');
    const tiles = await p.$$eval('[data-test=folder-row] .subtab:not(.add)', els => els.map(e => e.textContent));
    assert(await p.locator('#view img[src*=folder]').count() === 0, 'icoane de folder pe Foldere');
    assert(tiles.length === 3 && /Folder 1/.test(tiles[0]), 'foldere: ' + tiles);
    await p.locator('[data-test=folder-row] .subtab', { hasText: 'Folder 1' }).tap();
    await p.locator('.crumbs', { hasText: 'Folder 1' }).waitFor();
    await p.locator('.folder-panel .card', { hasText: 'checklist' }).waitFor();
    await p.screenshot({ path: `${SHOTS}${label}-foldere-folder1.png` });
  });

  await step(`[${label}] Ultimele noutăți: adăugare termen, ștergere Da/Nu, oră zilnică salvată`, async () => {
    await goTab('Ultimele noutăți');
    await p.locator('.news-sec[data-group=w] .add-term input').fill('uzucapiune');
    await p.locator('.news-sec[data-group=w] .add-term .btn').tap();
    await p.locator('.news-row', { hasText: 'uzucapiune' }).waitFor();
    assert(await p.locator('.news-row', { hasText: 'uzucapiune' }).locator('a[href^="https://wa.me/?text="]').count() === 1, 'link WhatsApp');
    assert(await p.locator('.news-row', { hasText: 'uzucapiune' }).locator('a[href^="mailto:"]').count() === 1, 'link e-mail');
    await p.locator('.news-row', { hasText: 'uzucapiune' }).locator('button[aria-label="Șterge"]').tap();
    await tap('[data-test=confirm] .m-actions .btn:first-child'); // Nu
    assert(await p.locator('.news-row', { hasText: 'uzucapiune' }).count() === 1, '„Nu” a șters');
    await p.locator('.news-row', { hasText: 'uzucapiune' }).locator('button[aria-label="Șterge"]').tap();
    await yes();
    await p.waitForTimeout(300);
    assert(await p.locator('.news-row', { hasText: 'uzucapiune' }).count() === 0, '„Da” nu a șters');
    const tm = p.locator('.news-hour .time-inp'); await tm.fill(''); await tm.type('0745');
    await p.locator('.news-hour .btn').tap();
    await p.waitForTimeout(400);
  });


  await step(`[${label}] setări: ascundere și reafișare tab prin bifă`, async () => {
    await openSet();
    const row = p.locator('[data-test=tab-order] .to-row', { hasText: 'Documente' });
    if (!(await row.isVisible())) await p.locator('[data-test=settings] details[data-sec=tabs] summary').tap();
    await row.locator('input[type=checkbox]').tap();
    await p.waitForTimeout(300);
    assert(!(await p.$$eval('.tab-pill', els => els.map(e => e.textContent.trim()))).includes('Documente'), 'tabul nu s-a ascuns');
    await row.locator('input[type=checkbox]').tap();
    await p.waitForTimeout(300);
    assert((await p.$$eval('.tab-pill', els => els.map(e => e.textContent.trim()))).includes('Documente'), 'tabul nu a reapărut');
    await tap('[data-test=settings] .m-back'); await gone('[data-test=settings]');
  });

  await step(`[${label}] documente: atașare fișier cu nume, salvare locală (IndexedDB), vizualizare`, async () => {
    await goTab('Documente');
    await p.locator('#view .card .r1').first().tap();
    await p.locator('#view .card.open .r2').first().tap({ position: { x: 20, y: 12 } });
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.locator('[data-test=editor] .btn', { hasText: 'Foto cu nume' }).tap()]);
    await fc.setFiles({ name: 'dovada.png', mimeType: 'image/png', buffer: png });
    await p.locator('.m-dialog input.inp').waitFor();
    await p.locator('.m-dialog input.inp').fill('Dovadă comunicare');
    await p.locator('.m-overlay:not(.closing) .m-dialog .m-actions .btn.primary').tap();
    await p.locator('[data-test=editor] .file-row', { hasText: 'Dovadă comunicare' }).waitFor();
    await save();
    const media = await p.evaluate(() => new Promise(res => { const r = indexedDB.open('lso_db'); r.onsuccess = () => { const q = r.result.transaction('lso_media').objectStore('lso_media').getAll(); q.onsuccess = () => res(q.result.map(m => m.name)); }; }));
    assert(media.includes('Dovadă comunicare'), 'media lipsă: ' + media);
    await p.locator('#view .card.open .r2').first().tap({ position: { x: 20, y: 12 } });
    await p.locator('[data-test=editor] .file-open', { hasText: 'Dovadă comunicare' }).tap();
    await p.locator('.viewer img.viewer-img').waitFor();
    await tap('.viewer .m-back'); await gone('.viewer');
    await tap('[data-test=editor] .m-actions .btn.ghost:not(.more)'); await gone('[data-test=editor]');
    await search('dovada comunicare');
    await p.locator('[data-test=search] .sr', { hasText: 'Cerere de chemare' }).first().waitFor();
    await tap('[data-test=search] .m-back'); await gone('[data-test=search]');
  });

  await step(`[${label}] legi: link oficial vizibil cu sursă și dată; salvare în Salvate`, async () => {
    await goTab('Legi');
    const c = p.locator('#view .card', { hasText: 'Codul civil' });
    await c.locator('.r1').tap();
    const r2 = await c.locator('.r2').textContent();
    assert(/legislatie\.just\.ro/.test(r2) && r2.includes('17/07/2009'), 'sursă/dată: ' + r2);
    assert(await c.locator('a[href="https://legislatie.just.ro/Public/DetaliiDocument/109884"]').count() === 1, 'link');
    await c.locator('button', { hasText: 'Salvează' }).tap();
    await p.waitForTimeout(300);
    await goTab('Salvate');
    await p.locator('#view .card', { hasText: 'Codul civil' }).waitFor();
  });

  await step(`[${label}] folder blocat cu PIN: conținut criptat, intrare cu PIN`, async () => {
    await tap('#hdr-folders');
    await longPress('[data-test=folder-row] .subtab:has-text("Folder 1")');
    await sheetOpt('Blochează cu PIN');
    await pin('2468'); await pin('2468');
    await p.locator('[data-test=folder-row] .subtab:has-text("Folder 1") .pill-lock').waitFor();
    const notes = (await idbItems()).filter(i => i.kind === 'note' && i.folder);
    assert(notes.length && notes.every(i => i.sec && !i.data), 'notițele din folder nu sunt criptate');
    await p.locator('[data-test=folder-row] .subtab', { hasText: 'Folder 1' }).tap();
    await pin('2468');
    await p.locator('.folder-panel .card', { hasText: 'checklist' }).waitFor();
  });

  await step(`[${label}] [NOU] rând orizontal comun: „+” la capăt, adăugare, foaie de vizibilitate, persistență (Documente)`, async () => {
    await goTab('Documente');
    const row = p.locator('[data-test=cat-row]');
    assert(await row.locator('> :last-child').evaluate(e => e.textContent.trim() === '+' && e.classList.contains('pr-add')), '„+” nu e ultimul');
    for (const n of ['Dosar penal', 'Corespondență', 'Executare']) {
      await row.locator('.pr-add').tap();
      await p.locator('.m-overlay:not(.closing) .m-dialog input.inp').fill(n);
      await p.locator('.m-overlay:not(.closing) .m-dialog .m-actions .btn.primary').tap();
      await p.locator('[data-test=cat-row] .subtab.active', { hasText: n }).waitFor();
    }
    assert(await row.evaluate(r => r.scrollWidth > r.clientWidth + 10), 'rândul nu derulează orizontal');
    assert(await row.locator('> :last-child').evaluate(e => e.textContent.trim() === '+'), '„+” nu mai e ultimul după adăugare');
    await row.locator('.subtab', { hasText: 'Dosar penal' }).tap();
    await tap('[data-test=fab-add]');
    await p.locator('[data-test=editor] [data-k=title]').fill('Plângere penală Vasile');
    await save();
    await p.locator('#view .card', { hasText: 'Plângere penală Vasile' }).waitFor();
    assert(await p.locator('#view .card').count() === 1, 'categoria nu filtrează');
    await row.locator('.subtab', { hasText: 'Executare' }).tap();
    await p.waitForTimeout(200);
    assert(await p.locator('#view .card').count() === 0, 'Executare ar trebui să fie gol');
    await row.locator('.subtab', { hasText: 'Dosar penal' }).tap();
    await p.locator('#view .card', { hasText: 'Plângere penală Vasile' }).waitFor();
    await row.locator('.subtab', { hasText: 'Toate' }).tap();
    assert(await p.locator('#view .card').count() >= 3, '„Toate” nu arată tot');
    await p.screenshot({ path: `${SHOTS}${label}-NOU-documente.png` });
    await row.locator('.pr-manage').tap();
    await p.locator('[data-test=visibility] .to-row').first().waitFor();
    await p.waitForTimeout(400);
    await p.screenshot({ path: `${SHOTS}${label}-NOU-foaie-vizibilitate.png` });
    await p.locator('[data-test=visibility] .to-row', { hasText: 'Probe' }).locator('input').tap();
    // reordonare: „Executare” sus
    const hFrom = await p.locator('[data-test=visibility] .to-row', { hasText: 'Executare' }).locator('.drag').boundingBox();
    const hTo = await p.locator('[data-test=visibility] .to-row').first().locator('.drag').boundingBox();
    await p.mouse.move(hFrom.x + 10, hFrom.y + 10); await p.mouse.down();
    for (let i = 1; i <= 8; i++) await p.mouse.move(hFrom.x + 10, hFrom.y + 10 - (hFrom.y - hTo.y + 8) * i / 8, { steps: 2 });
    await p.mouse.up();
    await p.locator('[data-test=visibility] .m-actions .btn.primary').tap();
    await gone('[data-test=visibility]');
    await p.reload(); await p.waitForSelector('.tab-pill.active');
    await goTab('Documente');
    const names = await p.locator('[data-test=cat-row] .subtab:not(.add)').evaluateAll(els => els.map(e => e.querySelector('.pill-name').textContent));
    assert(!names.includes('Probe'), 'Probe încă vizibil: ' + names);
    assert(names[1] === 'Executare', 'ordinea nu s-a păstrat: ' + names);
    const cats = await p.evaluate(() => new Promise(res => { const r = indexedDB.open('lso_db'); r.onsuccess = () => { const q = r.result.transaction('lso_tabs').objectStore('lso_tabs').getAll(); q.onsuccess = () => res(q.result.find(t => t.name === 'Documente').cats); }; }));
    assert(cats.find(c => c.name === 'Probe').visible === false && cats.length === 6, 'IndexedDB: ' + JSON.stringify(cats.map(c => c.name)));
  });

  await step(`[${label}] [NOU] Legi: subcategorii (pastile), filtrare, „+” la capăt; Salvate și Foldere folosesc același rând`, async () => {
    await goTab('Legi');
    const row = p.locator('[data-test=cat-row]');
    const pills = await row.locator('.subtab:not(.add)').evaluateAll(els => els.map(e => e.firstChild.textContent));
    assert(pills.join('|') === 'Toate|Constituție|Coduri|Legi|Portaluri', 'pastile: ' + pills);
    await row.locator('.subtab', { hasText: 'Coduri' }).tap();
    const titles = await p.locator('#view .card .r1t').allTextContents();
    assert(titles.length === 4 && titles.every(x => /^Cod/.test(x)), 'filtru Coduri: ' + titles);
    assert(await row.locator('> :last-child').evaluate(e => e.textContent.trim() === '+'), '„+” Legi');
    await p.screenshot({ path: `${SHOTS}${label}-NOU-legi.png` });
    await row.locator('.subtab', { hasText: 'Toate' }).tap();
    await goTab('Salvate');
    assert(await p.locator('[data-test=saved-row] > :last-child').evaluate(e => e.textContent.trim() === '+'), '„+” Salvate');
    assert(await p.locator('[data-test=saved-row] .pr-manage').count() === 1, 'vizibilitate Salvate');
    await goTab('Foldere');
    assert(await p.locator('[data-test=folder-row] > :last-child').evaluate(e => e.textContent.trim() === '+'), '„+” Foldere');
  });

  await step(`[${label}] [NOU] Monitorul Oficial pe zile: gol inițial, un rând pe dată, rezumat pe un rând, deschide/închide`, async () => {
    await goTab('Monitorul Oficial');
    await p.locator('#view .empty').waitFor();
    assert(await p.locator('#view .mo-sources a[href="https://www.monitoruloficial.ro/"]').count() === 1, 'link oficial MO');
    const add = async (title, date) => {
      await tap('[data-test=fab-add]');
      await p.locator('[data-test=editor] [data-k=title]').fill(title);
      const di = p.locator('[data-test=editor] .date-inp'); await di.fill(''); await di.type(date);
      await save();
    };
    await add('Legea nr. 100/2026 privind modificarea Codului de procedură civilă în materia executării silite', '05112026');
    await add('Hotărârea Guvernului nr. 812/2026', '05112026');
    await add('Ordonanța de urgență nr. 45/2026', '03112026');
    const rows = p.locator('#view .day-row');
    assert(await rows.count() === 2, 'rânduri pe zi: ' + await rows.count());
    const d0 = await rows.nth(0).locator('.day-date').textContent();
    assert(d0 === '05/11/2026', 'data/ordinea: ' + d0);
    const geo = await rows.nth(0).evaluate(r => { const s = r.querySelector('.day-sum'); return { h: r.getBoundingClientRect().height, right: r.getBoundingClientRect().right, ws: getComputedStyle(s).whiteSpace, sh: s.getBoundingClientRect().height }; });
    assert(geo.ws === 'nowrap' && geo.sh < 30 && geo.right <= vp.width, 'rezumatul nu e pe un rând: ' + JSON.stringify(geo));
    assert(await p.locator('#view .day-group .card').count() === 0, 'zilele trebuie să fie închise inițial');
    await rows.nth(0).tap();
    await p.locator('#view .day-group.open .card').nth(1).waitFor();
    assert(await p.locator('#view .day-group.open .card').count() === 2, 'nu s-au deschis toate elementele zilei');
    await p.screenshot({ path: `${SHOTS}${label}-NOU-monitorul-oficial.png` });
    await p.locator('#view .day-row').nth(0).tap();
    await p.waitForTimeout(200);
    assert(await p.locator('#view .day-group.open').count() === 0, 'nu s-a închis');
  });

  await step(`[${label}] [NOU] RECORDINGS: rând compact, acțiuni pe o linie, client/nr dosar, un singur Salvat.`, async () => {
    await goTab('RECORDINGS');
    await p.locator('.rec-big').tap();
    await p.locator('.rec-big.on').waitFor();
    await p.waitForTimeout(2200);
    await p.locator('.rec-big.on').tap();
    const day = p.locator('#view .day-row').first();
    await day.waitFor({ timeout: 15000 });
    const now = new Date(); const pad = n => String(n).padStart(2, '0');
    assert(await day.locator('.day-date').textContent() === `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`, 'data rândului');
    const chip = await day.locator('.chip').first().textContent();
    assert(/^Înregistrare \d{2}:\d{2}$/.test(chip), 'nume implicit: ' + chip);
    await day.tap();
    const c = p.locator('#view .day-group.open .card[data-kind=rec]').first();
    await c.waitFor();
    assert(await c.locator('.r1-date').count() === 0, 'ora nu trebuie să apară pe rândul 1');
    assert(await c.locator('.r1 .rec-st').count() === 0, 'starea nu trebuie să apară pe rândul 1');
    assert(/^Înregistrare \d{2}:\d{2}$/.test((await c.locator('.r1t').textContent()).trim()), 'titlu compact: ' + await c.locator('.r1t').textContent());
    assert(await c.locator('.r2').count() === 0, 'rândul 2 trebuie să fie închis inițial');
    await p.screenshot({ path: `${SHOTS}${label}-recordings-collapsed.png` });
    await c.locator('.r1').tap();
    await c.locator('audio').waitFor();
    assert((await c.locator('audio').getAttribute('src') || '').startsWith('blob:'), 'audio');
    assert((await c.locator('[data-test=rec-case]').textContent()).trim() === '—', 'nr dosar gol trebuie „—”');
    assert(/\d+\s+(sec|min)/.test((await c.locator('[data-test=rec-len]').textContent()).trim()), 'durata: ' + await c.locator('[data-test=rec-len]').textContent());
    assert((await c.locator('[data-test=rec-row-status]').textContent()).trim() === 'Nouă', 'stare implicită');
    assert(await c.locator('[data-test=rec-row-delete]').count() === 1, 'ștergere pe rândul 2');
    const acts = c.locator('.rec-actions');
    assert((await acts.locator('button').nth(0).textContent()).trim() === 'Redenumește', 'prima acțiune');
    assert((await acts.locator('[data-test=rec-archive]').textContent()).trim() === 'Arhivează', 'Arhivează, nu pilula de stare');
    const del = c.locator('[data-test=rec-delete]');
    const share = c.locator('[data-test=rec-share]');
    assert(await del.getAttribute('aria-label') === 'Șterge', 'eticheta accesibilă Șterge');
    assert((await del.textContent()).includes('🗑'), 'icoană coș');
    assert(await share.getAttribute('aria-label') === 'Partajează', 'eticheta accesibilă Partajează');
    assert(await share.locator('svg').count() === 1, 'icoana Share lipsește');
    const layout = await acts.evaluate(el => {
      const btns = [...el.querySelectorAll('button')];
      const boxes = btns.map(b => {
        const r = b.getBoundingClientRect();
        return { t: r.top, b: r.bottom, l: r.left, r: r.right, w: r.width, h: r.height, label: (b.getAttribute('aria-label') || b.textContent || '').trim(), trunc: b.scrollWidth > b.clientWidth + 1 };
      });
      return {
        n: boxes.length,
        sameLine: Math.max(...boxes.map(x => x.t)) - Math.min(...boxes.map(x => x.t)) <= 2,
        trunc: boxes.filter(x => x.trunc).map(x => x.label),
        tooSmall: boxes.filter(x => x.w < 40 || x.h < 40),
        rightGap: el.getBoundingClientRect().right - boxes[boxes.length - 1].r,
        order: boxes.map(x => x.label),
      };
    });
    assert(layout.n === 4, 'trebuie 4 acțiuni pe rând, avem ' + layout.n);
    assert(layout.sameLine, 'acțiunile nu sunt pe o singură linie: ' + JSON.stringify(layout.order));
    assert(!layout.trunc.length, 'text tăiat: ' + layout.trunc.join(', '));
    assert(!layout.tooSmall.length, 'țintă sub 40px: ' + JSON.stringify(layout.tooSmall));
    assert(layout.rightGap < 4, 'coșul nu e în dreapta de tot: ' + layout.rightGap);
    assert(layout.order[0] === 'Redenumește' && layout.order[1] === 'Arhivează', 'ordinea acțiunilor: ' + layout.order.join(' · '));
    await p.screenshot({ path: `${SHOTS}${label}-recordings-expanded.png` });
    await p.screenshot({ path: `${SHOTS}${label}-NOU-recordings-deschis.png` });
    await p.screenshot({ path: `${SHOTS}${label}-recordings-cos.png` });
    await p.screenshot({ path: `${SHOTS}${label}-recordings-actiuni.png` });
    // un singur toast „Salvat.” după salvare din editor
    await c.locator('.r2').tap({ position: { x: 20, y: 8 } });
    await p.locator('[data-test=editor] textarea[data-k=transcript]').fill('Declarația martorului principal despre contractul de vânzare');
    await save();
    const savedToasts = await p.locator('[data-test=toast]', { hasText: 'Salvat.' }).count();
    assert(savedToasts === 1, 'Salvat. de ' + savedToasts + ' ori');
    await p.locator('#view .card[data-kind=rec] .r1t', { hasText: 'Declarația martorului principal despre contractul de…' }).waitFor();
    await p.locator('#view .card[data-kind=rec] button', { hasText: 'Redenumește' }).tap();
    await p.locator('[data-test=rec-edit]').waitFor();
    await p.locator('[data-test=rec-edit-name]').fill('Audiere martor');
    await pickFromSheet('rec-edit-client', 'client-pick-sheet', 'Ion Popescu (exemplu)');
    await pickFromSheet('rec-edit-case', 'case-pick-sheet', '1234/299/2026 (exemplu)');
    await p.locator('[data-test=rec-edit] .m-actions .btn.primary').tap();
    await gone('[data-test=rec-edit]');
    await p.locator('#view .card[data-kind=rec] .r1t', { hasText: 'Ion Popescu (exemplu)' }).waitFor();
    assert((await p.locator('#view .card[data-kind=rec] [data-test=rec-case]').textContent()).trim() === '1234/299/2026 (exemplu)', 'nr dosar după editare');
    await p.locator('#view .card[data-kind=rec] [data-test=rec-delete]').tap();
    await p.locator('[data-test=confirm]').waitFor();
    await p.locator('[data-test=confirm] .m-actions .btn.ghost').tap();
    await gone('[data-test=confirm]');
    assert(await p.locator('#view .card[data-kind=rec]', { hasText: 'Ion Popescu (exemplu)' }).count() === 1, 'Nu nu trebuie să mute în Coș');
  });

  await step(`[${label}] [NOU] Arhivare în folder imbricat, search în arhivă, share Text/Voce/Ambele, căutare globală`, async () => {
    await goTab('RECORDINGS');
    const day = p.locator('#view .day-row').first();
    if (await p.locator('#view .day-group.open').count() === 0) await day.tap();
    const c = p.locator('#view .day-group.open .card[data-kind=rec]').first();
    await c.waitFor();
    if (await c.locator('.r2').count() === 0) await c.locator('.r1').tap();
    await c.locator('[data-test=rec-archive]').tap();
    await p.locator('[data-test=folder-pick]').waitFor();
    await assertModalFit('[data-test=folder-pick]');
    assert(await p.locator('[data-test=fp-new]', { hasText: 'Creează Folder' }).count() === 1, 'Creează Folder la rădăcină');
    assert(await p.locator('[data-test=folder-pick] .fp-item').count() >= 3, 'folderele de înregistrări (din clienți/dosare)');
    assert(await p.locator('[data-test=folder-pick] .fp-item', { hasText: 'Ion Popescu' }).count() === 1, 'folder după client');
    await p.screenshot({ path: `${SHOTS}${label}-recordings-folder-pick.png` });
    // Creează Folder întreabă întotdeauna; Nu anulează
    await p.locator('[data-test=fp-new]').tap();
    await p.locator('[data-test=create-folder]').waitFor();
    await assertModalFit('[data-test=create-folder]');
    await p.locator('[data-test=folder-name]').fill('Nu acesta');
    await p.screenshot({ path: `${SHOTS}${label}-recordings-create-folder.png` });
    assert(await p.locator('[data-test=toast]').count() <= 1, 'un singur toast, avem ' + await p.locator('[data-test=toast]').count());
    await p.locator('[data-test=create-folder] .m-actions .btn.ghost').tap();
    await gone('[data-test=create-folder]');
    assert(await p.locator('[data-test=folder-pick]').count() === 1, 'picker-ul rămâne deschis');
    assert(await p.locator('[data-test=folder-pick] .fp-item', { hasText: 'Nu acesta' }).count() === 0, 'Nu nu trebuie să creeze folderul');
    // Folder 1 e lacătuit dintr-un test anterior; creăm un folder nou, apoi un subfolder.
    await p.locator('[data-test=fp-new]').tap();
    await p.locator('[data-test=create-folder]').waitFor();
    await p.locator('[data-test=folder-name]').fill('Arhivă test');
    await p.locator('[data-test=create-folder] .m-actions .btn.primary').tap();
    await gone('[data-test=create-folder]');
    await p.locator('[data-test=folder-pick] .crumbs', { hasText: 'Arhivă test' }).waitFor();
    await p.locator('[data-test=fp-new-sub]', { hasText: 'Creează Subfolder' }).waitFor();
    await p.locator('[data-test=fp-new-sub]').tap();
    await p.locator('[data-test=create-folder]').waitFor();
    await p.locator('[data-test=folder-name]').fill('Sub Arhivă');
    await p.locator('[data-test=create-folder] .m-actions .btn.primary').tap();
    await gone('[data-test=create-folder]');
    await p.locator('[data-test=folder-pick] .crumbs', { hasText: 'Sub Arhivă' }).waitFor();
    await p.locator('[data-test=fp-here]', { hasText: 'Arhivează aici' }).tap();
    await gone('[data-test=folder-pick]');
    await p.locator('#view .card[data-kind=rec] [data-test=rec-row-status]', { hasText: 'Arhivată' }).waitFor();
    // Share: Text / Voce / Ambele (fără Web Share, ca să verificăm foaia și varianta de rezervă)
    await p.evaluate(() => { try { navigator.canShare = () => false; } catch (e) {} navigator.share = undefined; });
    await p.locator('#view .card[data-kind=rec] [data-test=rec-share]').tap();
    await p.locator('[data-test=sheet]', { hasText: 'Partajează înregistrarea' }).waitFor();
    assert(await p.locator('[data-test=sheet] .sheet-opt[data-v=text]').textContent().then(t => t.includes('Text')), 'Text');
    assert(await p.locator('[data-test=sheet] .sheet-opt[data-v=voice]').textContent().then(t => t.includes('Voce')), 'Voce');
    assert(await p.locator('[data-test=sheet] .sheet-opt[data-v=both]').textContent().then(t => t.includes('Ambele')), 'Ambele');
    await p.screenshot({ path: `${SHOTS}${label}-recordings-share.png` });
    await p.locator('[data-test=sheet] .sheet-opt[data-v=text]').tap();
    await gone('[data-test=sheet]');
    await p.locator('[data-test=toast]', { hasText: 'Copiat.' }).waitFor();
    // RECORDINGS: folderul propriu (nu tab-ul Foldere), căutare în arhivă
    await goTab('RECORDINGS');
    const recRow = p.locator('[data-test=rec-folder-row]');
    await recRow.locator('.subtab', { hasText: 'Arhivă test' }).waitFor();
    await recRow.locator('.subtab', { hasText: 'Arhivă test' }).tap();
    await p.waitForTimeout(200);
    const recCard = p.locator('#view .card[data-kind=rec]', { hasText: 'Ion Popescu (exemplu)' });
    await recCard.waitFor();
    await p.locator('[data-test=archive-search]').fill('declaratia martorului');
    await p.waitForTimeout(200);
    assert(await p.locator('#view .card[data-kind=rec]').count() === 1, 'search în arhivă (fără diacritice)');
    await p.locator('[data-test=archive-search]').fill('xyz-nu-exista');
    await p.waitForTimeout(200);
    assert(await p.locator('#view', { hasText: 'Nicio înregistrare găsită' }).count() === 1, 'fără rezultate');
    await p.locator('[data-test=archive-search]').fill('1234/299');
    await p.waitForTimeout(200);
    await p.locator('#view .card[data-kind=rec]', { hasText: 'Ion Popescu (exemplu)' }).waitFor();
    await p.screenshot({ path: `${SHOTS}${label}-recordings-archive-search.png` });
    const rec = p.locator('#view .card[data-kind=rec]').first();
    if (await rec.locator('.r2').count() === 0) await rec.locator('.r1').tap();
    await rec.locator('[data-test=rec-share]').tap();
    await p.locator('[data-test=sheet] .sheet-opt[data-v=both]').waitFor();
    await p.locator('.m-overlay').last().evaluate(el => { el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await gone('[data-test=sheet]');
    await recRow.locator('.subtab', { hasText: 'Toate' }).tap();
    await p.waitForTimeout(150);
    // căutare globală (inclusiv transcrierea)
    await search('declaratia martorului');
    await p.locator('[data-test=search] .sr', { hasText: 'Ion Popescu (exemplu)' }).waitFor();
    await p.locator('[data-test=search] .m-back').tap();
    await gone('[data-test=search]');
    await goTab('RECORDINGS');
    await p.locator('#view .day-row').first().tap();
    await p.waitForTimeout(200);
    assert(await p.locator('#view .day-group.open').count() === 0, 'ziua nu s-a închis');
    assert(await p.locator('#view .day-row .chip', { hasText: 'Ion Popescu (exemplu)' }).count() === 1, 'cip după arhivare');
    await p.screenshot({ path: `${SHOTS}${label}-NOU-recordings.png` });
  });

  await step(`[${label}] [NOU] RECORDINGS: pastile compacte (Toate + foldere client/dosar), filtru, + la capăt`, async () => {
    await goTab('RECORDINGS');
    const row = p.locator('[data-test=rec-folder-row]');
    await row.waitFor();
    await row.locator('.subtab', { hasText: 'Ion Popescu' }).waitFor();
    assert(await p.locator('#view img[src*=folder], #view .folder-tile').count() === 0, 'fără icoane de folder pe RECORDINGS');
    const labels = await row.locator('.subtab:not(.add)').evaluateAll(els => els.map(e => e.textContent.replace(/🔒/g,'').replace(/\d+$/,'').trim()));
    assert(labels[0] === 'Toate' || labels[0].startsWith('Toate'), 'prima pastilă trebuie să fie Toate: ' + labels.join('|'));
    assert(labels.some(l => /Ion Popescu/.test(l)) && labels.some(l => /Maria Ionescu/.test(l)), 'folderele din clienți lipsesc: ' + labels.join('|'));
    assert(await row.locator(':scope > :last-child').evaluate(e => e.textContent.trim() === '+'), '„+” la capăt');
    assert(await row.locator('.pr-manage').count() === 1, '⋯ vizibilitate');
    await p.screenshot({ path: `${SHOTS}${label}-recordings-pastile.png` });
    await row.locator('.subtab', { hasText: 'Maria Ionescu' }).tap();
    await p.waitForTimeout(200);
    assert(await p.locator('#view .day-group .card[data-kind=rec]').count() === 0, 'Maria Ionescu ar trebui să fie goală');
    await row.locator('.subtab', { hasText: 'Toate' }).tap();
    await p.waitForTimeout(200);
    assert(await p.locator('#view .day-row, #view .card[data-kind=rec]').count() >= 1, 'Toate trebuie să arate înregistrările');
    await row.locator('.pr-add, .subtab.add').tap();
    await p.locator('[data-test=create-folder]').waitFor();
    assert(await p.locator('[data-test=rec-folder-client]').count() === 1, 'Din Clienți');
    assert(await p.locator('[data-test=rec-folder-case]').count() === 1, 'Din Dosare');
    await p.locator('[data-test=create-folder] .m-actions .btn.ghost').tap();
    await gone('[data-test=create-folder]');
  });

  await step(`[${label}] [NOU] Selector Client sau Firmă: căutare, + Client nou / + Firmă nouă, dialog Da/Nu`, async () => {
    await goTab('Dosare');
    await tap('[data-test=fab-add]');
    await p.locator('[data-test=client-pick]').waitFor();
    await p.locator('[data-test=client-pick]').tap();
    await p.locator('[data-test=client-pick-sheet]').waitFor();
    await assertModalFit('[data-test=client-pick-sheet]');
    assert(await p.locator('[data-test=client-pick-sheet] .sheet-opt', { hasText: 'Ion Popescu (exemplu)' }).count() === 1, 'clienții existenți');
    assert(await p.locator('[data-test=client-new]').count() === 1, '+ Client nou');
    assert(await p.locator('[data-test=client-new-firm]').count() === 1, '+ Firmă nouă');
    await p.locator('[data-test=client-pick-search]').fill('maria');
    await p.waitForTimeout(150);
    assert(await p.locator('[data-test=client-pick-sheet] .sheet-opt', { hasText: 'Maria Ionescu' }).count() === 1, 'căutare');
    assert(await p.locator('[data-test=client-pick-sheet] .sheet-opt', { hasText: 'Ion Popescu' }).count() === 0, 'filtru căutare');
    await p.screenshot({ path: `${SHOTS}${label}-client-picker.png` });
    await p.locator('[data-test=client-new]').tap();
    await p.locator('[data-test=create-client]').waitFor();
    await assertModalFit('[data-test=create-client]');
    await p.locator('[data-test=client-name]').fill('Vasilescu Ana');
    await p.screenshot({ path: `${SHOTS}${label}-client-nou.png` });
    await p.locator('[data-test=create-client] .m-actions .btn.primary').tap();
    await gone('[data-test=create-client]');
    await gone('[data-test=client-pick-sheet]');
    assert((await p.locator('[data-test=client-pick]').textContent()).includes('Vasilescu Ana'), 'clientul nou trebuie selectat');
    await p.locator('[data-test=editor] [data-k=title]').fill('Dosar Vasilescu');
    await save();
    await p.locator('#view .card', { hasText: 'Dosar Vasilescu' }).waitFor();
    await goTab('Clienți');
    await p.locator('#view .card', { hasText: 'Vasilescu Ana' }).waitFor();
  });

  await step(`[${label}] [NOU] Citește: textul vorbit include titlul și Notele dosarului (mock)`, async () => {
    await goTab('Dosare');
    await tap('[data-test=fab-add]');
    await p.locator('[data-test=editor] [data-k=title]').fill('Dosar citire test');
    await p.locator('[data-test=editor] textarea[data-k=notes]').fill('Să pregătesc dosarul pentru instanță');
    await save();
    const citire = p.locator('#view .card', { hasText: 'Dosar citire test' });
    await citire.waitFor();
    if (!(await citire.evaluate(el => el.classList.contains('open')))) await citire.locator('.r1').tap();
    await citire.locator('.r2').tap({ position: { x: 20, y: 12 } });
    await p.locator('[data-test=editor]').waitFor();
    await p.evaluate(() => { window.__spoken = []; window.addEventListener('lso-speak', e => window.__spoken.push(e.detail.text)); });
    await tap('[data-test=editor] .m-actions .more');
    await sheetOpt('Citește cu voce');
    await p.waitForTimeout(400);
    const spoken = await p.evaluate(() => [window.__lsoLastSpeak, ...(window.__spoken || [])].filter(Boolean).join('\n'));
    assert(/Dosar citire test/.test(spoken) && /Să pregătesc dosarul pentru instanță/.test(spoken), 'text citit: ' + spoken);
    if (await p.locator('[data-test=speak-stop]').count()) await p.locator('[data-test=speak-stop]').tap();
    await tap('[data-test=editor] .m-actions .btn.ghost:not(.more)');
    await gone('[data-test=editor]');
  });

  await step(`[${label}] selecție multiplă: selectare și mutare în Coș cu Da/Nu`, async () => {
    await goTab('Termene');
    await tap('#hdr-select');
    await p.locator('#view .card .r1').first().tap();
    await p.locator('#selbar .btn', { hasText: 'Șterge' }).tap();
    await yes();
    await p.waitForTimeout(300);
    assert(await p.locator('#view .card').count() === 1, 'nu s-a mutat în Coș');
  });

  let backupPath = null;
  await step(`[${label}] backup: export JSON, modificare, import cu Da/Nu + checkpoint, restaurare`, async () => {
    await openSet();
    await p.locator('[data-test=settings] details.set-sec[data-sec=backup]').evaluate(el => { el.open = true; });
    const [dl] = await Promise.all([p.waitForEvent('download'), p.locator('[data-test=export]').tap()]);
    backupPath = `/tmp/lso-backup-${label}.json`;
    await dl.saveAs(backupPath);
    const j = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
    assert(j.app === 'lege-si-ordine' && j.items.length > 10 && j.tabs.length === 12, 'conținut backup');
    assert(j.items.some(i => i.lock && i.sec), 'elementul blocat trebuie să rămână criptat în backup');
    await tap('[data-test=settings] .m-back'); await gone('[data-test=settings]');
    await goTab('Urgențe');
    await tap('[data-test=fab-add]');
    await p.locator('[data-test=editor] [data-k=title]').fill('Notă după backup');
    await save();
    await p.locator('#view .card', { hasText: 'Notă după backup' }).waitFor();
    await openSet();
    await p.locator('[data-test=settings] details.set-sec[data-sec=backup]').evaluate(el => { el.open = true; });
    const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.locator('[data-test=import]').tap()]);
    await fc.setFiles(backupPath);
    await p.locator('[data-test=confirm]').waitFor();
    await Promise.all([p.waitForEvent('load', { timeout: 20000 }), yes()]);
    await p.waitForSelector('.tab-pill', { timeout: 15000 });
    await goTab('Urgențe');
    await p.waitForTimeout(300);
    assert(await p.locator('#view .card', { hasText: 'Notă după backup' }).count() === 0, 'importul nu a restaurat starea');
    assert(await p.locator('#view .card.locked').count() === 1, 'elementul blocat lipsește după import');
    const bks = await p.evaluate(() => new Promise(res => { const r = indexedDB.open('lso_db'); r.onsuccess = () => { const q = r.result.transaction('lso_backups').objectStore('lso_backups').getAll(); q.onsuccess = () => res(q.result.map(b => b.reason)); }; }));
    assert(bks.includes('before-import'), 'lipsă checkpoint înainte de import: ' + bks);
  });

  await step(`[${label}] persistență: revine la ultimul tab și poziție după reîncărcare`, async () => {
    await goTab('Legi');
    await p.evaluate(() => window.scrollTo(0, 200));
    await p.waitForTimeout(600);
    const y0 = await p.evaluate(() => window.scrollY);
    await p.reload();
    await p.waitForSelector('.tab-pill.active');
    await p.waitForTimeout(800);
    const act = await p.locator('.tab-pill.active').textContent();
    assert(act.trim() === 'Legi', 'tab activ după reload: ' + act);
    const y1 = await p.evaluate(() => window.scrollY);
    assert(y0 === 0 || Math.abs(y1 - y0) < 30, `poziție ${y0} → ${y1}`);
    await p.locator('#view .card', { hasText: 'Codul civil' }).waitFor();
  });

  await step(`[${label}] tema Navy Aur se aplică`, async () => {
    await openSet();
    await p.locator('[data-test=settings] details[data-sec=design] summary').tap();
    await p.locator('.theme-opt[data-theme=navy]').tap();
    await p.waitForTimeout(300);
    assert(await p.evaluate(() => document.documentElement.dataset.theme) === 'navy', 'tema');
    await tap('[data-test=settings] .m-back'); await gone('[data-test=settings]');
    await goTab('Dosare');
    await p.locator('#view .card .r1').first().tap();
    await p.screenshot({ path: `${SHOTS}${label}-tema-navy-dosare.png` });
    await openSet();
    await p.locator('.theme-opt[data-theme=light]').tap();
    await tap('[data-test=settings] .m-back'); await gone('[data-test=settings]');
  });


  await step(`[${label}] [v1.0.5] Antet: logo/titlu deschid Setările în panoul din stânga; un singur loc`, async () => {
    await goTab('Taskuri');
    assert(await p.locator('#hdr-settings').count() === 0, 'butonul roată încă există');
    const shot = n => p.screenshot({ path: `${SHOTS}${label}-v105-${n}.png` });
    await noToasts();
    if (label === '412x915') await p.locator('.top').screenshot({ path: `${SHOTS}${label}-v105-antet.png` });
    await tap('[data-test=hdr-emblem]');
    await p.locator('[data-test=settings].m-drawer').waitFor();
    await p.waitForTimeout(350);
    const g = await p.locator('[data-test=settings]').evaluate(el => { const r = el.getBoundingClientRect(); const ov = el.closest('.m-overlay'); return { l: r.left, r: r.right, w: innerWidth, op: getComputedStyle(ov, '::before').opacity, bg: getComputedStyle(ov, '::before').backgroundColor, tr: getComputedStyle(el).transform }; });
    assert(Math.abs(g.l) < 2 && g.r < g.w - 30, 'panoul nu e în stânga: ' + JSON.stringify(g));
    assert(g.op === '1' && (g.tr === 'none' || /matrix\(1, 0, 0, 1, 0, 0\)/.test(g.tr)), 'tranziție blocată: ' + JSON.stringify(g));
    for (const sec of ['voice', 'tabs', 'design', 'alarms', 'trash', 'backup', 'about']) assert(await p.locator(`[data-test=settings] details[data-sec=${sec}]`).count() === 1, 'lipsește secțiunea ' + sec);
    await p.locator('[data-test=settings] details.set-sec').evaluateAll(ds => ds.forEach(d => { d.open = false; }));
    await p.waitForTimeout(150); await noToasts();
    if (label === '412x915') await shot('setari-panou-stanga');
    // închidere: atingere pe fundal
    await p.mouse.click(g.w - 12, 400);
    await gone('[data-test=settings]');
    // deschidere din text, închidere cu Înapoi (istoric)
    await tap('[data-test=hdr-title]'); await p.locator('[data-test=settings]').waitFor(); await p.waitForTimeout(250);
    await p.evaluate(() => history.back());
    await gone('[data-test=settings]');
    // închidere prin glisare spre stânga (touch)
    await tap('[data-test=hdr-brand]'); await p.locator('[data-test=settings]').waitFor(); await p.waitForTimeout(250);
    const y = 300;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y }] });
    for (let x = 290; x >= 120; x -= 20) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await gone('[data-test=settings]');
    assert(await p.locator('.m-overlay').count() === 0, 'a rămas un fundal');
  });

  await step(`[${label}] [v1.0.5] Alarme și notificări: stare reală, permisiune, notificare de test`, async () => {
    await openSet();
    await p.locator('[data-test=settings] details[data-sec=alarms]').evaluate(el => { el.open = true; });
    await p.locator('[data-test=notif-state]').waitFor();
    const st = await p.locator('[data-test=notif-state]').textContent();
    assert(/Neîntrebat|Refuzate|Permise/.test(st), 'stare: ' + st);
    assert(!(await p.locator('[data-test=alarms-sec]').textContent()).includes('versiune web'), 'textul vechi „versiune web”');
    assert(await p.locator('[data-test=notif-test]').count() === 1, 'buton test');
    await p.locator('[data-test=settings] details[data-sec=alarms]').evaluate(el => el.scrollIntoView({ block: 'start' }));
    await p.waitForTimeout(200); await noToasts();
    if (label === '412x915') await p.screenshot({ path: `${SHOTS}${label}-v105-notificari-browser.png` });
    await p.context().grantPermissions(['notifications']);
    await tap('[data-test=settings] .m-back'); await gone('[data-test=settings]');
    await openSet();
    await p.locator('[data-test=settings] details[data-sec=alarms]').evaluate(el => { el.open = true; });
    await p.locator('[data-test=notif-state]', { hasText: 'Permise' }).waitFor();
    await tap('[data-test=notif-test]');
    await p.locator('[data-test=toast]', { hasText: 'test' }).waitFor();
    await tap('[data-test=settings] .m-back'); await gone('[data-test=settings]');
  });

  await step(`[${label}] [v1.0.5] Notificări native (APK simulat): cerere permisiune, canal, alarmă programată, refuz → setări`, async () => {
    const np = await p.context().newPage();
    await np.addInitScript(() => {
      const calls = window.__ln = { req: 0, sched: [], chan: [], openSettings: 0, cancel: [] };
      let perm = localStorage.getItem('mockPerm') || 'prompt';
      const LN = {
        checkPermissions: async () => ({ display: perm }),
        requestPermissions: async () => { calls.req++; perm = 'granted'; localStorage.setItem('mockPerm', perm); return { display: perm }; },
        checkExactNotificationSetting: async () => ({ exact_alarm: 'granted' }),
        changeExactNotificationSetting: async () => ({ exact_alarm: 'granted' }),
        createChannel: async c => { calls.chan.push(c); },
        schedule: async o => { calls.sched.push(...o.notifications); return { notifications: o.notifications.map(n => ({ id: n.id })) }; },
        getPending: async () => ({ notifications: [] }), cancel: async o => { calls.cancel.push(o); },
        getDeliveredNotifications: async () => ({ notifications: [] }), removeDeliveredNotifications: async () => {},
        addListener: async () => ({ remove() {} }),
      };
      window.__setPerm = v => { perm = v; localStorage.setItem('mockPerm', v); };
      window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', Plugins: { LocalNotifications: LN, LsoSystem: { openNotificationSettings: async () => { calls.openSettings++; return { opened: true }; } } } };
    });
    await np.goto(BASE); await np.waitForSelector('.tab-pill');
    await np.locator('#hdr-brand').tap();
    await np.locator('[data-test=settings] details[data-sec=alarms]').evaluate(el => { el.open = true; });
    await np.locator('[data-test=notif-state]', { hasText: 'Neîntrebat' }).waitFor();
    const npShot = async n => { await np.locator('[data-test=settings] details[data-sec=alarms]').evaluate(el => el.scrollIntoView({ block: 'start' })); await np.waitForTimeout(250); await np.evaluate(() => document.querySelectorAll('#toasts .toast').forEach(t => t.remove())); if (label === '412x915') await np.screenshot({ path: `${SHOTS}${label}-v105-${n}.png` }); };
    await npShot('notificari-apk-neintrebat');
    assert(!(await np.locator('[data-test=alarms-sec]').textContent()).includes('browser'), 'text web în APK');
    await np.locator('[data-test=notif-allow]').tap();
    await np.locator('[data-test=notif-state]', { hasText: 'Permise' }).waitFor();
    await np.locator('[data-test=exact-state]', { hasText: 'Permise' }).waitFor();
    await npShot('notificari-apk-permise');
    let c = await np.evaluate(() => window.__ln);
    assert(c.req === 1 && c.chan.some(x => x.id === 'lso_alarme' && x.importance === 5), 'permisiune/canal: ' + JSON.stringify(c));
    await np.locator('[data-test=notif-test]').tap();
    await np.waitForTimeout(300);
    c = await np.evaluate(() => window.__ln);
    assert(c.sched.some(n => n.id === 900001 && n.channelId === 'lso_alarme'), 'notificarea de test nu s-a programat');
    // o alarmă viitoare se programează nativ (sună și cu aplicația închisă)
    await np.evaluate(async () => {
      const it = [...window.LSO.state.items.values()].find(i => i.kind === 'task');
      it.alarmAt = Date.now() + 3600000; delete it.firedAt;
      const r = indexedDB.open('lso_db');
      await new Promise(res => { r.onsuccess = () => { const tx = r.result.transaction('lso_items', 'readwrite'); tx.objectStore('lso_items').put(it); tx.oncomplete = res; }; });
    });
    await np.reload(); await np.waitForSelector('.tab-pill'); await np.waitForTimeout(1200);
    c = await np.evaluate(() => window.__ln);
    assert(c.sched.some(n => n.extra && n.extra.id && n.schedule.allowWhileIdle && n.isExactNotification === true && +new Date(n.schedule.at) > Date.now()), 'alarma nu e programată nativ: ' + JSON.stringify(c.sched));
    // refuz definitiv → butonul deschide setările de notificări ale aplicației
    await np.evaluate(() => window.__setPerm('denied'));
    await np.locator('#hdr-brand').tap();
    await np.locator('[data-test=settings] details[data-sec=alarms]').evaluate(el => { el.open = true; });
    await np.locator('[data-test=notif-state]', { hasText: 'Refuzate' }).waitFor();
    await np.locator('[data-test=notif-allow]', { hasText: 'setările' }).tap();
    await np.waitForTimeout(200);
    assert((await np.evaluate(() => window.__ln.openSettings)) === 1, 'nu a deschis setările aplicației');
    await np.evaluate(() => localStorage.removeItem('mockPerm'));
    await np.close();
  });

  await step(`[${label}] [v1.0.5] Meniul din dreapta sus: Coș (N), Mutare, Sortare cu bifă, salvată pe tab`, async () => {
    await goTab('Clienți');
    await tap('#hdr-menu');
    const menu = p.locator('[data-test=hdr-dropmenu]');
    await menu.waitFor();
    const txt = await menu.textContent();
    for (const w of ['Coș de gunoi', 'Mutare', 'SORTARE', 'Alfabetic', 'Manual', 'Data creării', 'Data modificării']) assert(txt.includes(w), 'lipsește ' + w);
    assert(/Coș de gunoi \(\d+\)/.test(txt), 'contor coș');
    assert(await menu.locator('[data-test=sort-manual] .dm-check').count() === 1, 'Manual ✓ implicit');
    const mb = await menu.boundingBox(); const vw = await p.evaluate(() => innerWidth);
    assert(mb.x + mb.width <= vw + 1 && mb.y > 40, 'meniul nu e ancorat sus dreapta');
    await noToasts();
    if (label === '412x915') await p.screenshot({ path: `${SHOTS}${label}-v105-meniu-dreapta-sus.png` });
    await tap('[data-test=sort-alpha]'); await gone('[data-test=hdr-dropmenu]');
    const names = await p.locator('#view .card .r1t').allTextContents();
    const sorted = [...names].sort((a, b) => a.localeCompare(b, 'ro', { sensitivity: 'base' }));
    assert(names.join('|') === sorted.join('|'), 'nu e alfabetic: ' + names.join('|'));
    await p.reload(); await p.waitForSelector('.tab-pill.active');
    await tap('#hdr-menu');
    assert(await p.locator('[data-test=sort-alpha] .dm-check').count() === 1, 'sortarea nu s-a păstrat');
    const ui = await kv('ui');
    assert(ui && ui.sort && Object.values(ui.sort).includes('alpha'), 'nu e în lso_kv: ' + JSON.stringify(ui && ui.sort));
    await tap('[data-test=sort-manual]'); await gone('[data-test=hdr-dropmenu]');
    await tap('#hdr-menu'); await tap('[data-test=menu-trash]');
    await p.locator('[data-test=trash]').waitFor();
    await tap('[data-test=trash] .m-back'); await gone('[data-test=trash]');
  });

  await step(`[${label}] [v1.0.5] Apăsare lungă pe tab: foaia de meniu (fără Mută la stânga/dreapta); mutarea doar prin tragere`, async () => {
    await goTab('Taskuri');
    await p.evaluate(() => { document.querySelector('#tabbar').scrollLeft = 0; });
    await longPress('.tab-pill[data-id]:has-text("Dosare")');
    const m = p.locator('.m-sheet[data-test=sheet]');
    await m.waitFor();
    assert((await m.locator('.m-title').textContent()).trim() === 'Dosare', 'titlul foii nu e numele tabului');
    const opts = (await m.locator('.sheet-opt').allTextContents()).map(x => x.trim());
    for (const w of ['Redenumește', 'Culoare', 'Blochează cu PIN', 'Ascunde', 'Șterge']) assert(opts.some(o => o.includes(w)), 'lipsește ' + w + ': ' + opts);
    assert(!opts.some(o => /Mută la (stânga|dreapta)/.test(o)), 'Mută la stânga/dreapta încă există: ' + opts);
    assert(await m.locator('.sheet-opt.danger', { hasText: 'Șterge' }).count() === 1, 'Șterge roșu');
    assert((await p.locator('.tab-pill.active').textContent()).includes('Taskuri'), 'apăsarea lungă a schimbat tabul');
    assert(await p.evaluate(() => String(getSelection())) === '', 'text selectat');
    await p.waitForTimeout(300); await noToasts();
    if (label === '412x915') await p.screenshot({ path: `${SHOTS}${label}-v105-meniu-tab-apasare-lunga.png` });
    // Șterge → Da/Nu; „Nu” nu șterge nimic
    await sheetOpt('Șterge');
    await p.locator('[data-test=confirm]').waitFor();
    await tap('[data-test=confirm] .m-actions .btn:first-child'); await gone('[data-test=confirm]');
    assert((await tabOrder()).includes('Dosare'), '„Nu” a șters tabul');
    // Culoare (persistată)
    await longPress('.tab-pill[data-id]:has-text("Dosare")'); await sheetOpt('Culoare');
    await p.locator('.colors .color-dot').nth(2).tap();
    await p.waitForTimeout(400);
    assert(await p.locator('.tab-pill[data-id]:has-text("Dosare")').evaluate(e => !!e.style.getPropertyValue('--tab-color')), 'culoarea nu s-a aplicat');
    // reordonare prin apăsare lungă + tragere: Dosare înaintea lui Urgențe
    const before = await tabOrder();
    await dragTo('.tab-pill[data-id]:has-text("Dosare")', '.tab-pill[data-id]:has-text("Urgențe")', { fx: 0.15 });
    const after = await tabOrder();
    assert(after.indexOf('Dosare') < after.indexOf('Urgențe'), 'tragere tab: ' + before.slice(0, 4) + ' → ' + after.slice(0, 4));
    assert(await p.locator('.m-overlay').count() === 0, 'tragerea a deschis meniul');
    await p.reload(); await p.waitForSelector('.tab-pill.active');
    const persisted = await tabOrder();
    assert(persisted.indexOf('Dosare') < persisted.indexOf('Urgențe'), 'ordinea taburilor nu s-a păstrat');
    const tabsDb = await p.evaluate(() => new Promise(res => { const r = indexedDB.open('lso_db'); r.onsuccess = () => { const q = r.result.transaction('lso_tabs').objectStore('lso_tabs').getAll(); q.onsuccess = () => res(q.result); }; }));
    const ord = n => tabsDb.find(x => x.name === n).order;
    assert(ord('Dosare') < ord('Urgențe'), 'lso_tabs.order');
    // înapoi
    await dragTo('.tab-pill[data-id]:has-text("Dosare")', '.tab-pill[data-id]:has-text("Clienți")', { fx: 0.2 });
    const back = await tabOrder();
    assert(back.indexOf('Dosare') > back.indexOf('Urgențe'), 'readucere: ' + back.slice(0, 5));
  });

  await step(`[${label}] [v1.0.5] Drag and drop: element pe pastilă (mutare cu Da/Nu), reordonare manuală, pastile reordonate`, async () => {
    await goTab('Documente');
    const row = p.locator('[data-test=cat-row]');
    await row.locator('.subtab', { hasText: 'Toate' }).tap();
    await p.waitForTimeout(200);
    assert(await p.locator('#view img').count() === 0, 'icoane în Documente');
    await noToasts();
    if (label === '412x915') await p.screenshot({ path: `${SHOTS}${label}-v105-documente-pastile.png` });
    const target = await row.locator('.subtab:not(.add):not(.fixed)').nth(0).locator('.pill-name').textContent();
    const card = '#view .card:has-text("Cerere de chemare")';
    await dragTo(`${card} .r1`, `[data-test=cat-row] .subtab:has-text("${target}")`);
    await p.locator('[data-test=confirm]').waitFor();
    assert((await p.locator('[data-test=confirm]').textContent()).includes(target), 'confirmarea nu numește destinația');
    await yes();
    await p.waitForTimeout(400);
    const tabs = await p.evaluate(() => new Promise(res => { const r = indexedDB.open('lso_db'); r.onsuccess = () => { const q = r.result.transaction('lso_tabs').objectStore('lso_tabs').getAll(); q.onsuccess = () => res(q.result); }; }));
    const doc = tabs.find(x => x.name === 'Documente');
    const catId = doc.cats.find(c => c.name === target).id;
    const it = (await idbItems()).find(i => i.kind === 'document' && i.data && /Cerere de chemare/.test(i.data.title));
    assert(it && it.cat === catId, 'nu s-a mutat în pastilă: ' + (it && it.cat) + ' vs ' + catId);
    // reordonare manuală a listei (Sortare = Manual)
    const t0 = await p.locator('#view .card .r1t').allTextContents();
    await dragTo('#view .card >> nth=0', '#view .card >> nth=1', { fy: 0.9, sx: 0.6 });
    await p.waitForTimeout(300);
    const t1 = await p.locator('#view .card .r1t').allTextContents();
    assert(t1[0] === t0[1] && t1[1] === t0[0], 'reordonare: ' + t0.slice(0, 3) + ' → ' + t1.slice(0, 3));
    await p.reload(); await p.waitForSelector('.tab-pill.active');
    const t2 = await p.locator('#view .card .r1t').allTextContents();
    assert(t2[0] === t0[1], 'ordinea manuală nu s-a păstrat: ' + t2.slice(0, 3));
    assert(Object.keys((await kv('ui')).manual || {}).length >= 1, 'ui.manual lipsă');
    // reordonare pastile prin tragere
    const p0 = await row.locator('.subtab:not(.add):not(.fixed) .pill-name').allTextContents();
    await dragTo(`[data-test=cat-row] .subtab:has-text("${p0[1]}")`, `[data-test=cat-row] .subtab:has-text("${p0[0]}")`, { fx: 0.1 });
    await p.waitForTimeout(400);
    const p1 = await p.locator('[data-test=cat-row] .subtab:not(.add):not(.fixed) .pill-name').allTextContents();
    assert(p1[0] === p0[1], 'pastilele nu s-au reordonat: ' + p0 + ' → ' + p1);
    // modul Mutare din meniu: mânere ≡ și bară „Gata”
    await tap('#hdr-menu'); await tap('[data-test=menu-move]');
    await p.locator('[data-test=drag-handle]').first().waitFor();
    await tap('[data-test=drag-done]');
    assert(await p.locator('[data-test=drag-handle]').count() === 0, 'mânerele au rămas');
  });

  await step(`[${label}] [v1.0.5] Foldere și RECORDINGS: doar pastile, fără icoane de folder`, async () => {
    await tap('#hdr-folders');
    await p.locator('[data-test=folder-row] .subtab').first().waitFor();
    assert(await p.locator('#view img, .folder-tile').count() === 0, 'icoane pe Foldere');
    await noToasts();
    if (label === '412x915') await p.screenshot({ path: `${SHOTS}${label}-v105-foldere-pastile.png` });
    await goTab('RECORDINGS');
    await p.locator('[data-test=rec-folder-row] .subtab').first().waitFor();
    assert(await p.locator('#view img, .folder-tile').count() === 0, 'icoane pe RECORDINGS');
    await p.waitForTimeout(300); await noToasts();
    if (label === '412x915') await p.screenshot({ path: `${SHOTS}${label}-v105-recordings-pastile.png` });
  });

  await step(`[${label}] voce: meniul se deschide; degradare elegantă fără API`, async () => {
    await goTab('Taskuri');
    await tap('[data-test=fab-voice]');
    await p.locator('.m-sheet .sheet-opt', { hasText: 'Dictare' }).waitFor();
    await p.screenshot({ path: `${SHOTS}${label}-meniu-voce.png` });
    await sheetOpt('Citire');
    await p.waitForTimeout(500);
  });

  await finish();

  async function finish() {
    const real = errors.filter(e => !/favicon/.test(e));
    await step(`[${label}] fără erori în consolă`, async () => { assert(!real.length, real.slice(0, 5).join(' | ')); });
    await browser.close();
  }
}

await run({ width: 360, height: 780 }, '360x780', true);
if (!process.env.ONLY360) await run({ width: 412, height: 915 }, '412x915', true);
console.log(results.join('\n'));
fs.writeFileSync(new URL('./results.txt', import.meta.url), results.join('\n') + '\n');
process.exit(failed ? 1 : 0);
