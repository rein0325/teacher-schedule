// ════════════════════════════════════════
// googleSheets.js — 用 Google Sheets API v4 讀取公開分享的 Google Sheet
//
// 前提：目標 Google Sheet 要設成「知道連結的使用者皆可檢視」，並且要有一組
// 啟用了 Google Sheets API 的 API Key（建議在 Google Cloud Console 把這組 Key
// 限制成只能用在 Sheets API、只能從你的網域呼叫，降低被盜用的風險）。
//
// 這支只負責「抓資料」，回傳跟 openpyxl/ExcelJS 同樣概念的 2D 陣列（values），
// 實際解析邏輯在 dataFetch.js 的 parseStaffFromValues()/parseRequirementsFromValues()。
// ════════════════════════════════════════

const googleSheets = (function () {

  // 使用者可能貼「完整網址」或直接貼「純 ID」，這裡統一轉成 ID
  // 完整網址範例：https://docs.google.com/spreadsheets/d/1AbCdEfG.../edit#gid=0
  function parseSheetIdFromUrlOrId(input) {
    if (!input) return '';
    const s = String(input).trim();
    const m = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/.exec(s);
    return m ? m[1] : s;
  }

  // 讀取一個分頁的資料，回傳 2D 陣列（跟 Sheets API 原始格式一致：values[row][col]，0-based）
  // range 預設抓一個夠大的範圍，涵蓋師資表可能很多欄位、需求表可能很多列的情況
  async function fetchValues(sheetIdOrUrl, sheetName, apiKey, range = 'A1:CZ3000') {
    const sheetId = parseSheetIdFromUrlOrId(sheetIdOrUrl);
    if (!sheetId) throw new Error('請先在「⚙️ 設定」裡填入 Google Sheet 網址或 ID');
    if (!apiKey) throw new Error('請先在「⚙️ 設定」裡填入 Google API Key');
    if (!sheetName) throw new Error('請先在「⚙️ 設定」裡填入分頁名稱');

    const encodedRange = encodeURIComponent(`'${sheetName}'!${range}`);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodedRange}`
      + `?key=${encodeURIComponent(apiKey)}&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`;

    let res;
    try {
      res = await fetch(url);
    } catch (e) {
      throw new Error(`連不到 Google Sheets API（可能是網路問題）：${e.message}`);
    }

    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        if (body?.error?.message) msg = body.error.message;
      } catch (e) { /* 忽略 JSON 解析失敗，用預設訊息 */ }

      if (res.status === 403) {
        throw new Error(`讀取「${sheetName}」被拒絕（403）：請確認 Sheet 分享設定是「知道連結者可檢視」，以及 API Key 是否正確、有沒有限制成別的網域。原始訊息：${msg}`);
      }
      if (res.status === 400) {
        throw new Error(`讀取「${sheetName}」失敗（400）：請確認分頁名稱是否打對（區分大小寫、含空白）。原始訊息：${msg}`);
      }
      throw new Error(`讀取「${sheetName}」失敗：${msg}`);
    }

    const data = await res.json();
    return data.values || [];
  }

  return { fetchValues, parseSheetIdFromUrlOrId };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = googleSheets;
