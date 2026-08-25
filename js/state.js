// ════════════════════════════════════════
// state.js — 全域狀態與常數
// ════════════════════════════════════════
//
// 純前端版修改說明：
// 原本這裡有 `const API = 'http://localhost:5000';`，是後端 Flask 伺服器的網址，
// page1/2/3.js 會用 fetch(API + '/api/xxx') 呼叫後端。
// 純前端版沒有後端伺服器了，所有邏輯改成呼叫本地 JS 函式（dataFetch.js / scheduler.js /
// candidates.js / exportExcel.js），所以這個常數直接刪掉。
//
// 如果 page1/2/3.js 還沒改完、裡面還留著 fetch(API + ...) 的寫法，
// 會因為找不到 API 這個變數直接噴錯，這是預期中的事，代表提醒你那幾支還沒改到。

const S = {
  mode: 'new',                  // 'new' | 'resume'
  staffFile: null,
  scheduleFile: null,           // 全新排班用
  staffFileR: null,
  resultFile: null,             // 繼續調整用
  staffReport: null,
  requirements: null,
  settingsSummary: null,
  rookieWeeks: {},
  roleOverride: {},
  assignmentReport: null,
  selCell: null,
  selSlot: null,
  amap: {},   // cell → assignment
  ubw: {},    // week → Set(names) 已排名單
  acnt: {},   // name → 排課次數

  // ── 以下是純前端版新增的欄位 ──
  // exportExcel.js 匯出結果時，需要一份「還沒被 parseRequirements() 動過」的
  // 乾淨需求表 workbook（原本 Python/Flask 版是每次都重新從磁碟複製一份檔案）。
  // 這裡快取「使用者上傳的需求表檔案」對應的 ArrayBuffer，之後匯出時可以直接
  // 用它 new 一個全新的 ExcelJS.Workbook() 來讀，不會被先前解析用過的 workbook 物件
  // 裡殘留的變動污染。實際填值/讀取的地方在改寫 page1.js（讀檔時存進來）跟
  // page3.js（匯出時讀出來）的時候處理。
  scheduleFileBuffer: null,
};

// 校區固定顯示順序
const DISPLAY_CAMPUS_ORDER = ['安和校', '延壽校', '大直校', '板橋校'];

function campusColorIdx(campus) {
  const i = DISPLAY_CAMPUS_ORDER.indexOf(campus);
  return i >= 0 ? i : 3;
}

// ════════════════════════════════════════
// Google Sheet 設定（API Key、師資表/需求表的網址或 ID、分頁名稱）
//
// 原則上固定不變（同一批營隊都是同一份表），但使用者可能要換一批表，
// 所以存在瀏覽器的 localStorage，透過右上角「⚙️ 設定」修改，不用改程式碼。
// ⚠ 這是一般網站（不是 Claude Artifact），localStorage 在這裡是正常可用的持久化方式。
// ════════════════════════════════════════

const SHEETS_CONFIG_STORAGE_KEY = 'campScheduler.sheetsConfig.v1';

const DEFAULT_SHEETS_CONFIG = {
  apiKey: '',
  staffSheetId: '',
  staffSheetName: '2026夏令營',
  scheduleSheetId: '',
  scheduleSheetName: '2026 夏令營',
};

function loadSheetsConfig() {
  try {
    const raw = localStorage.getItem(SHEETS_CONFIG_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SHEETS_CONFIG };
    return { ...DEFAULT_SHEETS_CONFIG, ...JSON.parse(raw) };
  } catch (e) {
    return { ...DEFAULT_SHEETS_CONFIG };
  }
}

function saveSheetsConfig(cfg) {
  try { localStorage.setItem(SHEETS_CONFIG_STORAGE_KEY, JSON.stringify(cfg)); } catch (e) { /* 無痕模式等情況存不進去就算了 */ }
}

S.sheetsConfig = loadSheetsConfig();
