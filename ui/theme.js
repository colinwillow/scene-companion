// Picks the UI theme before first paint (plain script, not a module, so there is no flash).
// ?theme=warm|classic wins and is remembered; otherwise localStorage sc.theme; default warm.
// window.scTheme.set('classic') switches live; window.scTheme.get() reads it.
(function () {
  var THEMES = ['warm', 'classic'];
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
  function set(t) {
    if (THEMES.indexOf(t) < 0) t = 'warm';
    document.documentElement.dataset.theme = t;
    store('sc.theme', t);
    return t;
  }
  var q = null;
  try { q = new URLSearchParams(location.search).get('theme'); } catch (e) {}
  set(q || store('sc.theme') || 'warm');
  window.scTheme = { set: set, get: function () { return document.documentElement.dataset.theme; }, list: THEMES };
})();
