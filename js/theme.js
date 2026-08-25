// ════════════════════════════════════════
// theme.js — 主題切換
// 主題選項現在收在「⚙️ 設定」Modal 裡的「更多設定」分頁，不再有獨立的下拉選單。
// ════════════════════════════════════════

const THEMES = {
  dark:     '暗黑',
  morning:  '晴天（預設）',
  lavender: '薰衣草',
};

let _curTheme = 'morning';

function setTheme(t) {
  document.documentElement.setAttribute('data-theme', t === 'dark' ? '' : t);
  _curTheme = t;
  Object.keys(THEMES).forEach(k => {
    const el = document.getElementById('topt-' + k);
    if (el) el.classList.toggle('on', k === t);
  });
  try { localStorage.setItem('schedTheme', t); } catch (e) {}
}

// 啟動時讀取上次主題；沒存過的話預設用「清晨米白」
(function () {
  let t = 'morning';
  try {
    const saved = localStorage.getItem('schedTheme');
    if (saved && THEMES[saved]) t = saved;
  } catch (e) {}
  setTheme(t);
}());