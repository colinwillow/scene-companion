// Long-press any button, link or dropdown that has a title: a bubble says what it does (phones have no hover).
// The press that showed the bubble does not also click. Plain script; works on every page that loads it.
(function () {
  var HOLD = 480, SLOP = 10, tip = null, timer = 0, start = null, swallow = false;
  function hide() { if (tip) { tip.remove(); tip = null; } }
  function show(el) {
    var text = el.getAttribute('title') || el.dataset.tip; if (!text) return;
    hide();
    tip = document.createElement('div'); tip.className = 'lp-tip'; tip.textContent = text;
    document.body.appendChild(tip);
    var r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
    var x = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2));
    var y = r.bottom + 8 + h < innerHeight ? r.bottom + 8 : r.top - h - 8;
    tip.style.left = x + 'px'; tip.style.top = Math.max(8, y) + 'px';
    swallow = true;
    if (navigator.vibrate) try { navigator.vibrate(8); } catch (e) {}
  }
  addEventListener('pointerdown', function (e) {
    hide(); swallow = false; clearTimeout(timer);
    var el = e.target.closest && e.target.closest('button[title], a[title], select[title], [data-tip]');
    if (!el) return;
    start = { x: e.clientX, y: e.clientY };
    timer = setTimeout(function () { show(el); }, HOLD);
  }, true);
  addEventListener('pointermove', function (e) {
    if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > SLOP) { clearTimeout(timer); start = null; }
  }, true);
  function end() { clearTimeout(timer); start = null; if (tip) setTimeout(hide, 1600); }
  addEventListener('pointerup', end, true);
  addEventListener('pointercancel', end, true);
  addEventListener('click', function (e) { if (swallow) { swallow = false; e.preventDefault(); e.stopPropagation(); } }, true);
  addEventListener('contextmenu', function (e) { if (e.target.closest && e.target.closest('button, a[title]')) e.preventDefault(); }, true);
})();
