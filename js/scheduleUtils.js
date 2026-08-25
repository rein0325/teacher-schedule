// ════════════════════════════════════════
// scheduleUtils.js — 排課共用工具函式
// 對應 schedule_generator.py 開頭的 clean()/tri_bool()/yes()/split_list()/bracket_text()/
// ordered_union()/normalize_course()/display_course()/to_int()/clamp_priority()
//
// ⚠ 跟既有的 js/utils.js（toast/loading/goStep/showConfirm/confirmOk/confirmCancel）
//   完全是兩支不同檔案、互不影響，只是剛好都叫 utils 開頭，這支才特別取名 scheduleUtils.js。
// ════════════════════════════════════════

const scheduleUtils = (function () {

  // ── 基本值清理，對應 clean() ──
  function clean(value) {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) {
      // 對應 Python datetime.isoformat(sep=" ")："YYYY-MM-DD HH:MM:SS"
      const pad = n => String(n).padStart(2, '0');
      const y = value.getFullYear(), mo = pad(value.getMonth() + 1), d = pad(value.getDate());
      const h = pad(value.getHours()), mi = pad(value.getMinutes()), s = pad(value.getSeconds());
      return `${y}-${mo}-${d} ${h}:${mi}:${s}`;
    }
    // ExcelJS 的富文字 / 公式 / 超連結物件，統一攤平成字串
    if (typeof value === 'object') {
      if (Array.isArray(value.richText)) return clean(value.richText.map(rt => rt.text).join(''));
      if (value.result !== undefined) return clean(value.result);
      if (value.text !== undefined) return clean(value.text);
      if (value.hyperlink !== undefined) return clean(value.text ?? value.hyperlink);
    }
    const text = String(value).trim();
    return text ? text : null;
  }

  // 對應 tri_bool()：儲存格文字是「是」/「否」才回傳 true/false，其餘一律 null
  function triBool(value) {
    const text = clean(value);
    if (text === '是') return true;
    if (text === '否') return false;
    return null;
  }

  // 對應 yes()
  function yes(value) {
    return triBool(value) === true;
  }

  // 對應 split_list()：用中英文逗號、頓號、斜線切開
  function splitList(value) {
    const text = clean(value);
    if (!text) return [];
    return text.split(/[,，、/]+/).map(s => s.trim()).filter(Boolean);
  }

  // 對應 bracket_text()：抓表頭裡 [] 內的文字，抓不到就回傳原字串
  function bracketText(header) {
    const m = /\[(.*?)\]/.exec(header || '');
    return m ? m[1].trim() : header;
  }

  // 對應 ordered_union()：先照 preferredOrder 出現順序排，其餘依原始出現順序補上，去重
  function orderedUnion(values, preferredOrder) {
    const seen = new Set();
    const result = [];
    if (preferredOrder) {
      const valueSet = new Set(values);
      for (const item of preferredOrder) {
        if (valueSet.has(item) && !seen.has(item)) { result.push(item); seen.add(item); }
      }
    }
    for (const item of values) {
      if (!seen.has(item)) { result.push(item); seen.add(item); }
    }
    return result;
  }

  // 對應 normalize_course()
  function normalizeCourse(value) {
    if (!value) return '';
    const text = String(value).trim().toLowerCase();
    if (text.startsWith('minecraft')) return 'minecraft';
    if (text === 'lego' || text === '樂高') return 'lego';
    if (text === 'micro:bit' || text === 'microbit') return 'micro:bit';
    if (text === 'micropython' || text === 'micro python') return 'micropython';
    if (text === 'scratch jr' || text === 'scratchjr') return 'scratch jr';
    return text;
  }

  // 對應 display_course()
  function displayCourse(value) {
    const text = clean(value);
    if (!text) return null;
    const mapping = { 'LEGO': 'Lego', 'micro:bit': 'Micro:bit', 'micropython': 'MicroPython' };
    return mapping[text] || text;
  }

  // 對應 to_int()
  function toInt(value) {
    if (value === null || value === undefined || value === '') return 0;
    const n = parseFloat(value);
    return Number.isFinite(n) ? Math.trunc(n) : 0;
  }

  // 對應 clamp_priority()：夾在 0~5 之間
  function clampPriority(value) {
    if (value === null || value === undefined || value === '') return 0;
    const n = parseFloat(value);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(5, Math.trunc(n)));
  }

  // ── 中文字串排序：比照 Python sorted() 的 code point 排序，「不能用 localeCompare」──
  // JS 預設的 < / > 運算子對字串就是逐字元 UTF-16 code unit 比較，跟 Python 的 code point
  // 排序在中文（BMP 字元）的情況下結果一致，localeCompare 則會套用語系排序規則，兩者不同。
  function cmpStr(a, b) {
    a = a || ''; b = b || '';
    return a < b ? -1 : a > b ? 1 : 0;
  }

  // 比較「排序鍵陣列」（tuple 風格），元素可能是數字或字串，逐一比較到第一個不同為止
  function compareKeys(a, b) {
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
      const x = a[i], y = b[i];
      if (x === y) continue;
      if (typeof x === 'number' && typeof y === 'number') {
        if (x !== y) return x - y;
      } else {
        const sx = x === undefined || x === null ? '' : String(x);
        const sy = y === undefined || y === null ? '' : String(y);
        const c = cmpStr(sx, sy);
        if (c !== 0) return c;
      }
    }
    return 0;
  }

  // ── Excel 欄位英文字母 <-> 數字（1-based），比照 openpyxl 的 column_index_from_string / get_column_letter ──
  function columnIndexFromString(col) {
    let n = 0;
    for (const ch of String(col).toUpperCase()) {
      n = n * 26 + (ch.charCodeAt(0) - 64);
    }
    return n;
  }

  function getColumnLetter(index) {
    let n = index, s = '';
    while (n > 0) {
      const rem = (n - 1) % 26;
      s = String.fromCharCode(65 + rem) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  return {
    clean, triBool, yes, splitList, bracketText, orderedUnion,
    normalizeCourse, displayCourse, toInt, clampPriority,
    cmpStr, compareKeys, columnIndexFromString, getColumnLetter,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = scheduleUtils;
