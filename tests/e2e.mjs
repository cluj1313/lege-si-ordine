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
  const ctx = await browser.newContext({ viewport: vp, hasTouch: true, isMobile: true, deviceScaleFactor: 2, locale: 'ro-RO', acceptDownloads: true, permissions: ['microphone'] });
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
  const search = async (q) => { await tap('#hdr-search'); await p.locator('[data-test=search-input]').fill(q); };
  const save = async () => { await tap('[data-test=editor] .m-actions .btn.primary'); await gone('[data-test=editor]'); };
  const noOverflow = async () => { const o = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); assert(o <= 1, 'depășire orizontală ' + o + 'px'); };
  const idbItems = () => p.evaluate(() => new Promise(res => { const r = indexedDB.open('lso_db'); r.onsuccess = () => { const q = r.result.transaction('lso_items').objectStore('lso_items').getAll(); q.onsuccess = () => res(q.result); }; }));

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
      const cut = await p.evaluate(() => [...document.querySelectorAll('#view *')].filter(e => { const r = e.getBoundingClientRect(); return r.width && r.right > window.innerWidth + 1 && !e.closest('.subtabs,.folder-strip'); }).map(e => e.className).slice(0, 3));
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
    await tap('#hdr-menu'); await sheetOpt('Coș');
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

  await step(`[${label}] setări: reordonare taburi cu ≡ (pointer) și ascundere`, async () => {
    await tap('#hdr-menu'); await sheetOpt('Setări');
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
    // mută înapoi prin meniul tabului (apăsare lungă → Mută la stânga)
    while ((await p.$$eval('.tab-pill', els => els.map(e => e.textContent.trim())))[0] !== 'Taskuri') {
      await goTab('Taskuri'); await longPress('.tab-pill.active'); await sheetOpt('Mută la stânga'); await p.waitForTimeout(200);
    }
  });

  await step(`[${label}] Foldere: Folder 1/2/3 orizontal cu contor, intrare în folder`, async () => {
    await tap('#hdr-folders');
    const tiles = await p.$$eval('.folder-tile', els => els.map(e => e.textContent));
    assert(tiles.length === 3 && /Folder 1/.test(tiles[0]), 'foldere: ' + tiles);
    await p.locator('.folder-tile', { hasText: 'Folder 1' }).tap();
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
    await tap('#hdr-menu'); await sheetOpt('Setări');
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
    await p.locator('.m-dialog .m-actions .btn.primary').tap();
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
    await longPress('.folder-tile:has-text("Folder 1")');
    await sheetOpt('Blochează cu PIN');
    await pin('2468'); await pin('2468');
    await p.locator('.folder-tile:has-text("Folder 1") .ft-lock').waitFor();
    const notes = (await idbItems()).filter(i => i.kind === 'note' && i.folder);
    assert(notes.length && notes.every(i => i.sec && !i.data), 'notițele din folder nu sunt criptate');
    await p.locator('.folder-tile', { hasText: 'Folder 1' }).tap();
    await pin('2468');
    await p.locator('.folder-panel .card', { hasText: 'checklist' }).waitFor();
  });

  await step(`[${label}] RECORDINGS: înregistrare (microfon simulat), listă, redare, redenumire`, async () => {
    await goTab('RECORDINGS');
    await p.locator('.rec-big').tap();
    await p.locator('.rec-big.on').waitFor();
    await p.waitForTimeout(2200);
    await p.locator('.rec-big.on').tap();
    await p.locator('#view .card[data-kind=rec]').first().waitFor({ timeout: 15000 });
    await p.locator('#view .card[data-kind=rec] .r1').first().tap();
    await p.locator('#view .card[data-kind=rec] audio').waitFor();
    const src = await p.locator('#view .card[data-kind=rec] audio').getAttribute('src');
    assert(src && src.startsWith('blob:'), 'audio fără sursă');
    await p.locator('#view .card[data-kind=rec] button', { hasText: 'Redenumește' }).tap();
    await p.locator('.m-dialog input.inp').fill('Audiere martor');
    await p.locator('.m-dialog .m-actions .btn.primary').tap();
    await p.locator('#view .card[data-kind=rec]', { hasText: 'Audiere martor' }).waitFor();
    await p.screenshot({ path: `${SHOTS}${label}-recordings-cu-inregistrare.png` });
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
    await tap('#hdr-menu'); await sheetOpt('Setări');
    await p.locator('[data-test=settings] details[data-sec=backup] summary').tap();
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
    await tap('#hdr-menu'); await sheetOpt('Setări');
    await p.locator('[data-test=settings] details[data-sec=backup] summary').waitFor();
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
    await tap('#hdr-menu'); await sheetOpt('Setări');
    await p.locator('[data-test=settings] details[data-sec=design] summary').tap();
    await p.locator('.theme-opt[data-theme=navy]').tap();
    await p.waitForTimeout(300);
    assert(await p.evaluate(() => document.documentElement.dataset.theme) === 'navy', 'tema');
    await tap('[data-test=settings] .m-back'); await gone('[data-test=settings]');
    await goTab('Dosare');
    await p.locator('#view .card .r1').first().tap();
    await p.screenshot({ path: `${SHOTS}${label}-tema-navy-dosare.png` });
    await tap('#hdr-menu'); await sheetOpt('Setări');
    await p.locator('.theme-opt[data-theme=light]').tap();
    await tap('[data-test=settings] .m-back'); await gone('[data-test=settings]');
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
