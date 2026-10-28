// Feel (Stage 9): tap feedback, toasts, optional haptics and UI click sounds, and a calm-motion switch.
// Plain script on every page. Settings live in localStorage `sc.feel` ({ haptics, clicks, motion }) and are switched
// from the editor's More sheet (data-feel toggles); the play page reads the same settings.
//   scToast('Saved', 'ok' | 'bad' | 'info')   -> a pill that pops up near the bottom and fades
//   scFeel.get() / scFeel.set({ clicks: true })
(function () {
  var DEF = { haptics: true, clicks: false, motion: true };
  function load() { try { return Object.assign({}, DEF, JSON.parse(localStorage.getItem('sc.feel') || '{}')); } catch (e) { return Object.assign({}, DEF); } }
  var S = load();
  function apply() { document.documentElement.classList.toggle('calm', !S.motion); }
  function set(o) { for (var k in o) S[k] = !!o[k]; try { localStorage.setItem('sc.feel', JSON.stringify(S)); } catch (e) {} apply(); sync(); }
  function sync() { var els = document.querySelectorAll('[data-feel]'); for (var i = 0; i < els.length; i++) els[i].checked = !!S[els[i].dataset.feel]; }
  apply();

  var ac = null;
  function click() {
    if (!S.clicks) return;
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      var t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
      o.type = 'triangle'; o.frequency.setValueAtTime(880, t); o.frequency.exponentialRampToValueAtTime(1320, t + 0.04);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.08, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
      o.connect(g).connect(ac.destination); o.start(t); o.stop(t + 0.08);
    } catch (e) {}
  }
  function buzz(ms) { if (S.haptics && navigator.vibrate) try { navigator.vibrate(ms); } catch (e) {} }
  addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('button, .ib, label.toggle, #sceneList a, #sceneCards button');
    if (!b || b.disabled) return;
    buzz(6); click();
  }, true);
  addEventListener('change', function (e) {
    var f = e.target.dataset && e.target.dataset.feel; if (!f) return;
    var o = {}; o[f] = e.target.checked; set(o);
  }, true);

  var box = null;
  function toast(text, kind) {
    if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
    var t = document.createElement('div'); t.className = 'toast ' + (kind || 'info'); t.textContent = text;
    box.appendChild(t);
    while (box.children.length > 3) box.removeChild(box.firstChild);
    if (kind === 'bad') buzz([10, 40, 10]);
    setTimeout(function () { t.classList.add('out'); setTimeout(function () { t.remove(); }, 300); }, kind === 'bad' ? 3800 : 1900);
  }
  window.scToast = toast;
  window.scFeel = { get: function () { return Object.assign({}, S); }, set: set, sync: sync };
  if (document.readyState !== 'loading') sync(); else addEventListener('DOMContentLoaded', sync);
})();
