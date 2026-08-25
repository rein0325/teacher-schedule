// ════════════════════════════════════════
// theme.js — 主題切換
// ════════════════════════════════════════

const THEMES = {
  dark:     '暗黑（預設）',
  morning:  '清晨米白',
  lavender: '薰衣草',
  summer:   '夏日陽光',
};

let _curTheme = 'dark';

function setTheme(t) {
  document.documentElement.setAttribute('data-theme', t === 'dark' ? '' : t);
  _curTheme = t;
  Object.keys(THEMES).forEach(k => {
    const el = document.getElementById('topt-' + k);
    if (el) el.classList.toggle('on', k === t);
  });
  document.getElementById('theme-menu').classList.remove('open');
  try { localStorage.setItem('schedTheme', t); } catch (e) {}
}

function toggleThemeMenu(e) {
  e.stopPropagation();
  document.getElementById('theme-menu').classList.toggle('open');
}

// 點其他地方關閉選單
document.addEventListener('click', () => {
  document.getElementById('theme-menu').classList.remove('open');
});

// 啟動時讀取上次主題
(function () {
  try {
    const t = localStorage.getItem('schedTheme');
    if (t && THEMES[t]) setTheme(t);
  } catch (e) {}
}());
