// Scene Companion icon set (Stage 9): one rounded, chunky line style, drawn inline as SVG so it works on every page,
// offline and in the desktop app with no extra file. 24×24, 2.2px round strokes in currentColor.
// Colin's rule (from culture_war): every icon has ONE short word under it. Long-press shows what it does (ui/longpress.js).
//   icon('play')                       -> '<svg class="ic">…</svg>'
//   setIcon(btn, 'play', 'Play')       -> fills a button with the icon and its word (and aria-label)
//   iconize(root)                      -> every [data-icon] inside root gets its icon; the word is data-word or its text
const F = 'fill="currentColor" stroke="none"';
export const ICONS = {
  scenes:   '<rect x="3" y="9" width="18" height="11" rx="2"/><path d="M3.5 9 5 4.5h15.5L19 9M9.5 4.5 8 9M15 4.5 13.5 9"/>',
  list:     `<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1.5" ${F}/><circle cx="4.5" cy="12" r="1.5" ${F}/><circle cx="4.5" cy="18" r="1.5" ${F}/>`,
  library:  '<rect x="3.5" y="4" width="5" height="16" rx="1.2"/><rect x="9.5" y="4" width="5" height="16" rx="1.2"/><path d="m15.6 5.6 3.6-1 3.3 13.8-3.6 1z"/>',
  play:     `<path d="M7.5 5.2v13.6a.8.8 0 0 0 1.2.7l11-6.8a.8.8 0 0 0 0-1.4l-11-6.8a.8.8 0 0 0-1.2.7z" ${F}/>`,
  stop:     `<rect x="5.5" y="5.5" width="13" height="13" rx="2.5" ${F}/>`,
  pause:    `<rect x="6" y="5" width="4" height="14" rx="1.3" ${F}/><rect x="14" y="5" width="4" height="14" rx="1.3" ${F}/>`,
  move:     '<path d="M12 3v18M3 12h18M12 3 9.5 5.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5"/>',
  rotate:   '<path d="M20 12a8 8 0 1 1-2.4-5.7M20 3.5v4.5h-4.5"/>',
  scale:    '<rect x="3.5" y="11" width="9.5" height="9.5" rx="1.6"/><path d="M13 11l7.5-7.5M15 3.5h5.5V9"/>',
  brush:    '<path d="M19 3.4a2 2 0 0 1 2.8 2.8L13.5 14.5l-2.8-2.8z"/><path d="M9.3 13.4c-2.6-.3-4 1.4-4.1 3.5-.1 1.7-.9 2.7-2.2 3.1 2.7 1.3 7.4 1 8.2-2.9z"/>',
  erase:    '<path d="M8 20h12M4.8 15.2 13.6 6.4a1.6 1.6 0 0 1 2.3 0l3 3a1.6 1.6 0 0 1 0 2.3L10.5 20H8.2z"/><path d="m9 11 5 5"/>',
  snap:     '<rect x="3.5" y="3.5" width="17" height="17" rx="2.5"/><path d="M9.2 3.5v17M14.8 3.5v17M3.5 9.2h17M3.5 14.8h17"/>',
  add:      '<path d="M12 5v14M5 12h14"/>',
  undo:     '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo:     '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  copy:     '<rect x="8.5" y="8.5" width="12" height="12" rx="2.2"/><path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5"/>',
  save:     '<path d="M7 18.5a4.2 4.2 0 0 1-.6-8.4 6 6 0 0 1 11.5-1.4 4.6 4.6 0 0 1-.4 9.8"/><path d="M12 12.5V21M9 15.5l3-3 3 3"/>',
  star:     `<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" ${F}/>`,
  edit:     '<path d="M4 20h4L19.3 8.7a2 2 0 0 0 0-2.8l-1.2-1.2a2 2 0 0 0-2.8 0L4 16z"/><path d="m14 6 4 4"/>',
  close:    '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  sound:    '<path d="M4 9.5h3.5L12.5 5v14l-5-4.5H4z"/><path d="M16 9a4.5 4.5 0 0 1 0 6M18.8 6.2a8.5 8.5 0 0 1 0 11.6"/>',
  mute:     '<path d="M4 9.5h3.5L12.5 5v14l-5-4.5H4z"/><path d="m16.5 9.5 5 5M21.5 9.5l-5 5"/>',
  target:   '<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.5"/><path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4"/>',
  boxes:    '<path d="M12 3 20 7.5v9L12 21l-8-4.5v-9z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>',
  timeline: '<rect x="3" y="6" width="18" height="12" rx="2.2"/><path d="M7.5 6v12M16.5 6v12M3 10h4.5M3 14h4.5M16.5 10H21M16.5 14H21"/>',
  delete:   '<path d="M4 7h16M9.5 7V4.5h5V7M6 7l1 12.5a1.5 1.5 0 0 0 1.5 1.4h7a1.5 1.5 0 0 0 1.5-1.4L18 7M10 11v6M14 11v6"/>',
  send:     '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1.2 1.2 0 0 1-1.2 1.2H5.2A1.2 1.2 0 0 1 4 19V7.2A1.2 1.2 0 0 1 5.2 6H10"/>',
  receive:  '<path d="M11 7v6h6M20 4l-9 9"/><path d="M10 4H5.2A1.2 1.2 0 0 0 4 5.2v13.6A1.2 1.2 0 0 0 5.2 20h13.6a1.2 1.2 0 0 0 1.2-1.2V14"/>',
  forge:    '<path d="M13.5 4.5 19.5 10.5 17 13 11 7z"/><path d="M12.5 8.5 4 17a2 2 0 0 0 3 3l8.5-8.5"/>',
  look:     '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
  tier:     '<path d="M3.5 17.5a8.5 8.5 0 1 1 17 0"/><path d="m12 17.5 4.5-6"/><circle cx="12" cy="17.5" r="1.4" fill="currentColor"/>',
  theme:    `<path d="M12 3a9 9 0 0 0 0 18c1.6 0 2.2-1 2.2-2 0-1.4-1.3-2 0-3.1.9-.8 2.3-.6 3.6-.6A3.3 3.3 0 0 0 21 12c0-5-4-9-9-9z"/><circle cx="7.5" cy="11" r="1.3" ${F}/><circle cx="10" cy="7" r="1.3" ${F}/><circle cx="14.5" cy="7" r="1.3" ${F}/>`,
  more:     `<circle cx="5.5" cy="12" r="2" ${F}/><circle cx="12" cy="12" r="2" ${F}/><circle cx="18.5" cy="12" r="2" ${F}/>`,
  person:   '<circle cx="12" cy="7" r="3.5"/><path d="M5 20.5c.6-4.2 3.3-6.5 7-6.5s6.4 2.3 7 6.5"/>',
  package:  '<path d="M12 3 20 7.5v9L12 21l-8-4.5v-9z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9M8 5.3l8 4.5"/>',
  kit:      '<path d="M3.5 20.5h17M5.5 20.5V10l6.5-5 6.5 5v10.5"/><rect x="9.5" y="13.5" width="5" height="7" rx="1"/>',
  sparkle:  `<path d="M12 3.5c.7 4.2 1.8 5.3 6 6-4.2.7-5.3 1.8-6 6-.7-4.2-1.8-5.3-6-6 4.2-.7 5.3-1.8 6-6z"/><path d="M18.5 15.5c.3 1.6.8 2.1 2.4 2.4-1.6.3-2.1.8-2.4 2.4-.3-1.6-.8-2.1-2.4-2.4 1.6-.3 2.1-.8 2.4-2.4z" ${F}/>`,
  image:    '<rect x="3.5" y="4.5" width="17" height="15" rx="2.2"/><circle cx="9" cy="10" r="1.8"/><path d="m4 18 5.5-5 4 3.5 2.5-2 4 3.5"/>',
  puzzle:   '<path d="M5 8h3.5a2 2 0 1 1 4 0H16v3.5a2 2 0 1 1 0 4V19H5z"/>',
  vars:     '<path d="M8 4.5c-2.5 2-3.5 4.5-3.5 7.5s1 5.5 3.5 7.5M16 4.5c2.5 2 3.5 4.5 3.5 7.5s-1 5.5-3.5 7.5M9.5 9l5 6M14.5 9l-5 6"/>',
  heart:    `<path d="M12 20.5s-8-4.7-8-10.3A4.4 4.4 0 0 1 12 7.6a4.4 4.4 0 0 1 8 2.6c0 5.6-8 10.3-8 10.3z" ${F}/>`,
  coin:     '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v9M9.5 9.5h3.7a1.6 1.6 0 0 1 0 3.2h-2.4a1.6 1.6 0 0 0 0 3.2h3.7"/>',
  restart:  '<path d="M4 12a8 8 0 1 0 2.4-5.7M4 3.5V8h4.5"/>',
  check:    '<path d="m5 12.5 4.5 4.5L19 7"/>',
  loop:     '<path d="M17 3.5 20 6.5l-3 3"/><path d="M4 11.5V10a3.5 3.5 0 0 1 3.5-3.5H20M7 20.5 4 17.5l3-3"/><path d="M20 12.5V14a3.5 3.5 0 0 1-3.5 3.5H4"/>',
};

export function icon(name) {
  const body = ICONS[name];
  if (!body) return '';
  return `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Fill a button (or link) with an icon and its one word. `extra` is trusted HTML appended after the word (a status dot).
export function setIcon(el, name, word, extra = '') {
  if (!el) return el;
  el.classList.add('ib');
  el.dataset.icon = name;
  el.dataset.word = word;
  el.innerHTML = icon(name) + `<span class="iw">${esc(word)}</span>${extra}`;
  if (!el.getAttribute('aria-label') || el.dataset.autoLabel) { el.setAttribute('aria-label', word); el.dataset.autoLabel = '1'; }
  return el;
}

export function iconize(root = document) {
  for (const el of root.querySelectorAll('[data-icon]')) {
    if (el.querySelector('svg.ic')) continue;
    setIcon(el, el.dataset.icon, el.dataset.word || el.textContent.trim());
  }
}
