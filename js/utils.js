// ════════════════════════════════════════
// utils.js — 共用工具函式
// ════════════════════════════════════════

function toast(m, t = '') {
  const e = document.getElementById('toast');
  e.textContent = m;
  e.className = 'show' + (t ? ' ' + t : '');
  clearTimeout(e._t);
  e._t = setTimeout(() => e.className = '', 3500);
}

function loading(s, t = '處理中...') {
  document.getElementById('loading').className = s ? 'show' : '';
  document.getElementById('lt').textContent = t;
}

function goStep(n) {
  if (n === 2 && !S.staffReport) return;
  if (n === 3 && !S.assignmentReport) return;
  [1, 2, 3].forEach(i => {
    const done = (i === 1 && S.staffReport && n >= 2) || (i === 2 && S.assignmentReport && n === 3);
    document.getElementById(['page-import', 'page-settings', 'page-editor'][i - 1])
      .className = 'page' + (i === n ? ' active' : '');
    document.getElementById('step' + i)
      .className = 'step' + (i === n ? ' active' : done ? ' done' : '');
  });
  document.getElementById('btn-exp').style.display = n === 3 ? '' : 'none';
  document.getElementById('btn-stats').style.display = n === 3 ? '' : 'none';
}

// ── 自訂 Confirm Modal（取代 window.confirm）──
let _confirmCb = null;

function showConfirm(title, msg, confirmLabel, confirmStyle, cb) {
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-msg').innerHTML = msg;
  const btn = document.getElementById('confirm-ok');
  btn.textContent = confirmLabel || '確認';
  btn.style.cssText = confirmStyle || '';
  _confirmCb = cb;
  document.getElementById('confirm-modal').classList.add('show');
}

function confirmOk() {
  document.getElementById('confirm-modal').classList.remove('show');
  if (_confirmCb) { _confirmCb(); _confirmCb = null; }
}

function confirmCancel() {
  document.getElementById('confirm-modal').classList.remove('show');
  _confirmCb = null;
}
