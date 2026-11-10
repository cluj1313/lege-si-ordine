// Drag and drop comun (atingere): apăsare lungă, apoi tragi. Fără mișcare după apăsarea lungă = meniul elementului.
// Reordonare în container (axa x pentru rânduri de pastile/taburi, y pentru liste) cu derulare automată la margini,
// sau plasare pe o țintă [data-drop] (pastilă, folder, tab). În „modul mutare” tragerea pornește imediat (fără apăsare lungă).
const HOLD_MS = 420, SLOP = 9;
let active = null; // o singură tragere odată

export const isDragging = () => !!(active && active.dragging);

export function draggable(el, opts) {
  const o = { axis: 'y', holdMs: HOLD_MS, ...opts };
  const grip = o.handle || el;
  let st = null;
  const clear = () => { if (st) { clearTimeout(st.timer); clearInterval(st.scrollTimer); } };
  grip.addEventListener('pointerdown', e => {
    if (e.button > 0 || active) return;
    if (o.enabled && !o.enabled()) return;
    if (e.target.closest('input,textarea,select,audio,a[href]') && !o.handle) return;
    st = { sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, armed: false, dragging: false, pid: e.pointerId, moved: false };
    const arm = () => {
      if (!st) return;
      st.armed = true; el.classList.add('dnd-armed');
      // după armare ascultăm pe window: mutarea nodului în DOM pierde captura pointerului
      window.addEventListener('pointermove', onMove, true);
      window.addEventListener('pointerup', up, true);
      window.addEventListener('pointercancel', onCancel, true);
      if (navigator.vibrate) try { navigator.vibrate(12); } catch {}
    };
    if (o.immediate && o.immediate()) arm(); else st.timer = setTimeout(arm, o.holdMs);
  });
  const unlisten = () => {
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', up, true);
    window.removeEventListener('pointercancel', onCancel, true);
  };
  grip.addEventListener('pointermove', e => { if (st && !st.armed) onMove(e); });
  function onMove(e) {
    if (!st || e.pointerId !== st.pid) return;
    st.x = e.clientX; st.y = e.clientY;
    const far = Math.abs(st.x - st.sx) > SLOP || Math.abs(st.y - st.sy) > SLOP;
    if (!st.armed) { if (far) { clear(); st = null; } return; }
    if (!st.dragging) { if (!far) return; start(); }
    move();
  }
  // după armare, browserul nu mai are voie să deruleze (altfel ar trimite pointercancel)
  grip.addEventListener('touchmove', e => { if (st && st.armed) e.preventDefault(); }, { passive: false });
  grip.addEventListener('contextmenu', e => e.preventDefault());
  function up(e) {
    if (!st || (e && e.pointerId !== st.pid)) return;
    const s = st; clear(); unlisten();
    el.classList.remove('dnd-armed');
    if (s.dragging) { finish(true); suppress = true; }
    else if (s.armed) { suppress = true; st = null; if (o.onHold) o.onHold(); return; }
    st = null;
  }
  function onCancel(e) { if (!st || (e && e.pointerId !== st.pid)) return; clear(); unlisten(); el.classList.remove('dnd-armed'); if (st.dragging) finish(false); st = null; }
  grip.addEventListener('pointerup', e => { if (st && !st.armed) up(e); });
  grip.addEventListener('pointercancel', e => { if (st && !st.armed) onCancel(e); });
  let suppress = false;
  grip.addEventListener('click', e => { if (suppress) { e.stopPropagation(); e.preventDefault(); suppress = false; } }, true);

  function start() {
    st.dragging = true; active = st;
    const r = el.getBoundingClientRect();
    st.offX = st.sx - r.left; st.offY = st.sy - r.top;
    const g = el.cloneNode(true);
    g.classList.add('dnd-ghost'); g.classList.remove('dnd-armed');
    Object.assign(g.style, { position: 'fixed', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', margin: '0', zIndex: '95', pointerEvents: 'none' });
    document.body.append(g);
    st.ghost = g; st.startOrder = ids();
    el.classList.add('dnd-src');
    document.body.classList.add('dnd-on');
    st.scrollTimer = setInterval(autoScroll, 30);
  }
  const container = () => (typeof o.container === 'function' ? o.container() : o.container) || el.parentNode;
  const ids = () => [...container().querySelectorAll(o.selector)].map(x => x.dataset.id);
  function target() {
    if (!o.onDrop) return null;
    const hit = document.elementFromPoint(st.x, st.y);
    const tg = hit && hit.closest('[data-drop]');
    if (!tg || tg === el || el.contains(tg)) return null;
    return o.canDrop && !o.canDrop(tg) ? null : tg;
  }
  function move() {
    st.ghost.style.left = (st.x - st.offX) + 'px';
    st.ghost.style.top = (o.axis === 'x' && !o.onDrop ? st.ghost.style.top : (st.y - st.offY) + 'px');
    const tg = target();
    if (st.over && st.over !== tg) st.over.classList.remove('dnd-over');
    st.over = tg; if (tg) { tg.classList.add('dnd-over'); return; }
    if (!o.onReorder) return;
    // reordonare live: elementul tras se mută printre frați după poziția degetului
    const cont = container();
    const sibs = [...cont.querySelectorAll(o.selector)].filter(x => x !== el && x.parentNode === el.parentNode);
    if (!sibs.length) return;
    const pos = o.axis === 'x' ? st.x : st.y;
    const r0 = el.parentNode.getBoundingClientRect();
    if (o.axis === 'y' && (st.x < r0.left - 30 || st.x > r0.right + 30)) return;
    let before = null;
    for (const s of sibs) { const b = s.getBoundingClientRect(); const mid = o.axis === 'x' ? b.left + b.width / 2 : b.top + b.height / 2; if (pos < mid) { before = s; break; } }
    if (before) { if (el.nextSibling !== before) el.parentNode.insertBefore(el, before); }
    else { const last = sibs[sibs.length - 1]; if (last.nextSibling !== el) last.after(el); }
  }
  function autoScroll() {
    if (!st || !st.dragging) return;
    const sc = o.scroller ? (typeof o.scroller === 'function' ? o.scroller() : o.scroller) : null;
    const edge = 44, step = 14;
    if (sc && o.axis === 'x') {
      const b = sc.getBoundingClientRect();
      if (st.x < b.left + edge) sc.scrollLeft -= step; else if (st.x > b.right - edge) sc.scrollLeft += step; else return;
    } else {
      const top = (document.querySelector('.top')?.getBoundingClientRect().bottom || 0);
      if (st.y < top + edge) window.scrollBy(0, -step); else if (st.y > window.innerHeight - edge - 70) window.scrollBy(0, step); else return;
    }
    move();
  }
  function finish(commit) {
    const s = st;
    clearInterval(s.scrollTimer);
    if (s.ghost) s.ghost.remove();
    if (s.over) s.over.classList.remove('dnd-over');
    el.classList.remove('dnd-src');
    document.body.classList.remove('dnd-on');
    active = null;
    if (!commit) { o.onCancel && o.onCancel(); return; }
    const tg = s.over;
    if (tg && o.onDrop) { o.onDrop(tg); return; }
    const now = ids();
    if (o.onReorder && now.join('|') !== s.startOrder.join('|')) o.onReorder(now);
  }
}
