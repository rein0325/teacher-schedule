// ════════════════════════════════════════
// page1.js — 匯入資料（P1）
//
// 純前端 + Google Sheet 版：
// - 「全新排班」：不用上傳檔案了，直接從設定好的 Google Sheet 抓師資表 + 需求表
// - 「繼續調整」：師資表一樣從 Google Sheet 抓，只有「排課結果.xlsx」還是要上傳
//   （因為那份是使用者自己下載保存的既有檔案，沒有對應的 Google Sheet 本體）
// - 右上角「⚙️ 設定」：填 Google API Key + 兩份表的網址/ID + 分頁名稱，存在瀏覽器本機
// ════════════════════════════════════════

function switchTab(t) {
  document.getElementById('tab-new').classList.toggle('on', t === 'new');
  document.getElementById('tab-resume').classList.toggle('on', t === 'resume');
  document.getElementById('pane-new').style.display = t === 'new' ? '' : 'none';
  document.getElementById('pane-resume').style.display = t === 'resume' ? '' : 'none';
}

// 拖放（「繼續調整」上傳「排課結果.xlsx」還在用）
function dg(e, t, on) {
  e.preventDefault();
  document.getElementById('zone-' + t).classList.toggle('dv', !!on);
}
function dp(e, t) {
  e.preventDefault();
  dg(e, t, 0);
  const f = e.dataTransfer.files[0];
  if (f) sf(t, f);
}
function fs(e, t) {
  const f = e.target.files[0];
  if (f) sf(t, f);
}

function sf(t, f) {
  const zoneMap = {
    'result': { key: 'resultFile', fn: 'fn-result', zone: 'zone-result' },
  };
  const m = zoneMap[t]; if (!m) return;
  S[m.key] = f;
  document.getElementById(m.fn).textContent = '✓ ' + f.name;
  document.getElementById(m.zone).classList.add('hf');
  document.getElementById('btn-resume').disabled = !S.resultFile;
}

// ── 「全新排班」：直接從 Google Sheet 抓資料 ──
async function runParseFromSheets() {
  loading(true, '從 Google Sheet 讀取資料中...');
  try {
    const cfg = S.sheetsConfig;
    const [staffValues, scheduleValues] = await Promise.all([
      googleSheets.fetchValues(cfg.staffSheetId, cfg.staffSheetName, cfg.apiKey, 'A1:CZ3000'),
      googleSheets.fetchValues(cfg.scheduleSheetId, cfg.scheduleSheetName, cfg.apiKey, 'A1:N3000'),
    ]);

    const settings = dataFetch.getDefaultSettings();
    const staffReport = dataFetch.parseStaffFromValues(
      staffValues, settings.campus_priority, settings.priority_courses, `GoogleSheet:${cfg.staffSheetId}`
    );
    const requirements = dataFetch.parseRequirementsFromValues(
      scheduleValues, settings.assistant_formula, settings, `GoogleSheet:${cfg.scheduleSheetId}`
    );

    S.staffReport = staffReport;
    S.requirements = requirements;
    S.settingsSummary = settings;
    S.scheduleFileBuffer = null; // 資料來自 Google Sheet，沒有實體檔案，匯出時改用「從零建立」
    S.scheduleFile = null;
    S.rookieWeeks = {}; S.roleOverride = {}; S.mode = 'new';
    document.getElementById('btn-p2-next').textContent = '執行排班 →';
    showExportButton();
    buildP2(); goStep(2);
    toast('讀取完成！共 ' + staffReport.people.length + ' 位老師', 'ok');
  } catch (e) {
    toast('錯誤：' + e.message, 'err');
  } finally {
    loading(false);
  }
}

// ── 「繼續調整」：兩種資料來源可選 ──
let resumeSource = 'sheet'; // 'sheet' | 'file'

function switchResumeSource(mode) {
  resumeSource = mode;
  document.getElementById('resume-src-sheet').classList.toggle('on', mode === 'sheet');
  document.getElementById('resume-src-file').classList.toggle('on', mode === 'file');
  document.getElementById('resume-sheet-pane').style.display = mode === 'sheet' ? '' : 'none';
  document.getElementById('resume-file-pane').style.display = mode === 'file' ? '' : 'none';
}

// 子選項 A：需求表直接從 Google Sheet 抓「目前即時內容」——如果有人已經直接在
// Google Sheet 上手動填了講師/助教名字，這裡會把那些名字當成起始的已排課狀態。
async function runResumeFromSheet() {
  loading(true, '從 Google Sheet 讀取師資與需求資料中...');
  try {
    const cfg = S.sheetsConfig;
    const [staffValues, scheduleValues] = await Promise.all([
      googleSheets.fetchValues(cfg.staffSheetId, cfg.staffSheetName, cfg.apiKey, 'A1:CZ3000'),
      googleSheets.fetchValues(cfg.scheduleSheetId, cfg.scheduleSheetName, cfg.apiKey, 'A1:N3000'),
    ]);

    const settings = dataFetch.getDefaultSettings();
    const staffReport = dataFetch.parseStaffFromValues(
      staffValues, settings.campus_priority, settings.priority_courses, `GoogleSheet:${cfg.staffSheetId}`
    );
    const { requirementReport, assignmentReport } = dataFetch.parseResultFromValues(
      scheduleValues, cfg.scheduleSheetName, settings.assistant_formula, settings, `GoogleSheet:${cfg.scheduleSheetId}`
    );

    S.staffReport = staffReport;
    S.requirements = requirementReport;
    S.settingsSummary = settings;
    S.assignmentReport = assignmentReport;
    S.scheduleFile = null;
    S.scheduleFileBuffer = null; // 來源是 Google Sheet，匯出時改用「從零建立」
    S.rookieWeeks = {}; S.roleOverride = {}; S.mode = 'resume';
    document.getElementById('btn-p2-next').textContent = '繼續調整 →';
    showExportButton();
    buildP2(); goStep(2);
    const s = assignmentReport.summary;
    toast(`讀取完成！共 ${staffReport.people.length} 位老師，目前已有 ${s.assigned_slots} 筆排課`, 'ok');
  } catch (e) {
    toast('錯誤：' + e.message, 'err');
  } finally {
    loading(false);
  }
}

// 子選項 B：師資表從 Google Sheet 抓，排課結果從上傳的「排課結果.xlsx」還原
async function runResumeFromFile() {
  loading(true, '讀取 Google Sheet 師資資料 + 排課結果 Excel 中...');
  try {
    const cfg = S.sheetsConfig;
    const staffValues = await googleSheets.fetchValues(cfg.staffSheetId, cfg.staffSheetName, cfg.apiKey, 'A1:CZ3000');

    const resultBuf = await S.resultFile.arrayBuffer();
    const resultWb = new ExcelJS.Workbook();
    await resultWb.xlsx.load(resultBuf);

    const settings = dataFetch.getDefaultSettings();
    const staffReport = dataFetch.parseStaffFromValues(
      staffValues, settings.campus_priority, settings.priority_courses, `GoogleSheet:${cfg.staffSheetId}`
    );
    const { requirementReport, assignmentReport } = dataFetch.parseResultWorkbook(
      resultWb, cfg.scheduleSheetName, settings.assistant_formula, settings, S.resultFile.name
    );

    S.staffReport = staffReport;
    S.requirements = requirementReport;
    S.settingsSummary = settings;
    S.assignmentReport = assignmentReport;
    S.scheduleFile = S.resultFile;
    S.scheduleFileBuffer = resultBuf; // 這份是真實檔案，匯出時可以複製這份當底稿
    S.rookieWeeks = {}; S.roleOverride = {}; S.mode = 'resume';
    document.getElementById('btn-p2-next').textContent = '繼續調整 →';
    showExportButton();
    buildP2(); goStep(2);
    toast('載入完成！共 ' + staffReport.people.length + ' 位老師，請確認設定後繼續', 'ok');
  } catch (e) {
    toast('錯誤：' + e.message, 'err');
  } finally {
    loading(false);
  }
}

// ── ⚙️ 設定：Google API Key + 兩份表的網址/ID + 分頁名稱 ──
function openSettings() {
  const cfg = S.sheetsConfig;
  document.getElementById('cfg-api-key').value = cfg.apiKey || '';
  document.getElementById('cfg-staff-id').value = cfg.staffSheetId || '';
  document.getElementById('cfg-staff-sheet').value = cfg.staffSheetName || '';
  document.getElementById('cfg-schedule-id').value = cfg.scheduleSheetId || '';
  document.getElementById('cfg-schedule-sheet').value = cfg.scheduleSheetName || '';
  switchSettingsTab('sheet');
  document.getElementById('settings-modal').classList.add('open');
}

function switchSettingsTab(tab) {
  document.getElementById('settings-pane-sheet').style.display = tab === 'sheet' ? '' : 'none';
  document.getElementById('settings-pane-more').style.display = tab === 'more' ? '' : 'none';
  document.getElementById('stab-sheet').classList.toggle('active', tab === 'sheet');
  document.getElementById('stab-more').classList.toggle('active', tab === 'more');
}

function closeSettings() {
  document.getElementById('settings-modal').classList.remove('open');
}

function saveSettings() {
  const cfg = {
    apiKey: document.getElementById('cfg-api-key').value.trim(),
    staffSheetId: googleSheets.parseSheetIdFromUrlOrId(document.getElementById('cfg-staff-id').value.trim()),
    staffSheetName: document.getElementById('cfg-staff-sheet').value.trim() || '2026夏令營',
    scheduleSheetId: googleSheets.parseSheetIdFromUrlOrId(document.getElementById('cfg-schedule-id').value.trim()),
    scheduleSheetName: document.getElementById('cfg-schedule-sheet').value.trim() || '2026 夏令營',
  };
  S.sheetsConfig = cfg;
  saveSheetsConfig(cfg);
  closeSettings();
  refreshP1SheetInfo();
  toast('設定已儲存', 'ok');
}

// 只要資料載入完成，不管有沒有排過班都可以匯出，所以提前顯示匯出按鈕
function showExportButton() {
  const btn = document.getElementById('btn-exp');
  if (btn) btn.style.display = '';
}

// 把目前設定顯示在頁面一，並依設定是否齊全決定「抓資料」按鈕能不能按
function refreshP1SheetInfo() {
  const cfg = S.sheetsConfig;
  const staffEl = document.getElementById('gs-staff-label');
  const schedEl = document.getElementById('gs-schedule-label');
  const shortId = id => (id ? id.slice(0, 10) + '…' : '');
  if (staffEl) {
    staffEl.textContent = cfg.staffSheetId
      ? `${cfg.staffSheetName}（${shortId(cfg.staffSheetId)}）`
      : '尚未設定，請點下方「⚙️ 修改設定」';
  }
  if (schedEl) {
    schedEl.textContent = cfg.scheduleSheetId
      ? `${cfg.scheduleSheetName}（${shortId(cfg.scheduleSheetId)}）`
      : '尚未設定，請點下方「⚙️ 修改設定」';
  }
  const ready = !!(cfg.apiKey && cfg.staffSheetId && cfg.scheduleSheetId);
  const btnParse = document.getElementById('btn-parse');
  if (btnParse) btnParse.disabled = !ready;
  const btnResumeSheet = document.getElementById('btn-resume-sheet');
  if (btnResumeSheet) btnResumeSheet.disabled = !ready;
  const hint = document.getElementById('gs-not-ready-hint');
  if (hint) hint.style.display = ready ? 'none' : '';
}

// ⚠ 這支 script 是放在 </body> 前面載入的，執行時 DOMContentLoaded 早就已經觸發過了，
// 用 addEventListener('DOMContentLoaded', ...) 監聽會永遠等不到事件、永遠不會執行。
// 這裡的 DOM 元素這時候已經存在了，直接呼叫就好。
refreshP1SheetInfo();