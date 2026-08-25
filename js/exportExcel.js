// ════════════════════════════════════════
// exportExcel.js — 匯出排課結果 Excel
// 對應 schedule_generator.py 的 write_assigned_workbook() 及其子函式
// （write_unfilled_sheet / write_skipped_sheet / write_teacher_schedule_sheet /
//  write_lock_warnings_sheet / normal_assignment_font）
//
// 純前端版用 state.js 快取的 S.scheduleFileBuffer（使用者上傳、還沒被 parseRequirements()
// 動過的原始需求表 ArrayBuffer）當作乾淨底稿，對應 Python 版每次都從磁碟重新複製一份檔案。
// ════════════════════════════════════════

const exportExcel = (function () {
  const U = (typeof scheduleUtils !== 'undefined') ? scheduleUtils : require('./scheduleUtils.js');

  const ROLE_FILL = {
    '講師': { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE4D6' } },
    '助教': { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } },
  };

  function styleHeaderRow(ws, headers, argb) {
    const fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
    for (let c = 1; c <= headers.length; c++) {
      const cell = ws.getCell(1, c);
      cell.font = { bold: true, color: { argb: 'FF000000' } };
      cell.fill = fill;
    }
  }

  function setColumnWidths(ws, widths) {
    widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  }

  function freezeAndFilter(ws, lastColLetter) {
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.autoFilter = `A1:${lastColLetter}${Math.max(ws.rowCount, 1)}`;
  }

  function recreateSheet(workbook, name) {
    const existing = workbook.getWorksheet(name);
    if (existing) workbook.removeWorksheet(existing.id);
    return workbook.addWorksheet(name);
  }

  // 對應 normal_assignment_font()：沿用原字型設定，但顏色改黑色、拿掉刪除線
  function applyNormalAssignmentFont(cell) {
    const f = cell.font || {};
    cell.font = { ...f, strike: false, color: { argb: 'FF000000' } };
  }

  // 對應 excel_io.py 新增的 write_all_classes_sheet()：列出所有課程（不分有沒有排到）
  function writeAllClassesSheet(workbook, requirementReport) {
    const ws = recreateSheet(workbook, '全部清單');
    const headers = ['週次', '校區', '課程', '預計人數'];
    ws.addRow(headers);
    styleHeaderRow(ws, headers, 'FFFFF2CC');

    const allClasses = requirementReport.all_classes || [];
    for (const item of allClasses) {
      ws.addRow([item.week, item.campus, item.course, item.expected_students]);
    }
    if (!allClasses.length) ws.addRow(['無', null, null, null]);

    setColumnWidths(ws, [18, 12, 18, 10]);
    freezeAndFilter(ws, 'D');
  }

  // 對應 write_unfilled_sheet()
  function writeUnfilledSheet(workbook, assignmentReport) {
    const ws = recreateSheet(workbook, '未排清單');
    const headers = ['週次', '校區', '課程', '預計人數', '缺少角色', '第幾位', '原因'];
    ws.addRow(headers);
    styleHeaderRow(ws, headers, 'FFD9EAF7');

    const unfilled = assignmentReport.unfilled || [];
    for (const item of unfilled) {
      ws.addRow([item.week, item.campus, item.course, item.expected_students, item.role, item.slot_index, item.reason]);
    }
    if (!unfilled.length) ws.addRow(['無缺口', null, null, null, null, null, null]);

    setColumnWidths(ws, [18, 12, 18, 10, 12, 10, 60]);
    freezeAndFilter(ws, 'G');

    for (let row = 2; row <= ws.rowCount; row++) {
      const fill = ROLE_FILL[ws.getCell(row, 5).value];
      if (fill) for (let c = 1; c <= headers.length; c++) ws.getCell(row, c).fill = fill;
    }
  }

  // 對應 write_skipped_sheet()
  function writeSkippedSheet(workbook, requirementReport) {
    const ws = recreateSheet(workbook, '暫不排課清單');
    const headers = ['週次', '校區', '課程', '預計人數', '原因'];
    ws.addRow(headers);
    styleHeaderRow(ws, headers, 'FFE2F0D9');

    const skipped = requirementReport.skipped_classes || [];
    for (const item of skipped) {
      ws.addRow([item.week, item.campus, item.course, item.expected_students, item.skip_reason]);
    }
    if (!skipped.length) ws.addRow(['無', null, null, null, null]);

    setColumnWidths(ws, [18, 12, 18, 10, 36]);
    freezeAndFilter(ws, 'E');
  }

  // 對應 write_teacher_schedule_sheet()
  function writeTeacherScheduleSheet(workbook, assignmentReport) {
    const ws = recreateSheet(workbook, '老師課表');
    const headers = ['老師', 'Priority', '安排週數', '安排人次', '講師人次', '助教人次', '週次', '校區', '課程', '角色', '預計人數', '格子', '鎖定'];
    ws.addRow(headers);
    styleHeaderRow(ws, headers, 'FFD9EAD3');

    const byName = new Map();
    for (const a of assignmentReport.assignments || []) {
      const n = a.assigned_name;
      if (!byName.has(n)) byName.set(n, []);
      byName.get(n).push(a);
    }

    const names = [...byName.keys()].sort((a, b) => U.cmpStr(a, b));
    for (const name of names) {
      const rows = [...byName.get(name)].sort((a, b) => U.compareKeys(
        [a.week || '', a.campus || '', a.course || '', a.role || '', a.slot_index || 0],
        [b.week || '', b.campus || '', b.course || '', b.role || '', b.slot_index || 0],
      ));
      const weeks = [...new Set(rows.map(r => r.week).filter(Boolean))];
      const instructorCount = rows.filter(r => r.role === '講師').length;
      const assistantCount = rows.filter(r => r.role === '助教').length;
      const priorityItem = rows.find(r => r.assigned_priority !== null && r.assigned_priority !== undefined);
      const priority = priorityItem ? priorityItem.assigned_priority : '';

      rows.forEach((item, index) => {
        ws.addRow([
          name,
          index === 0 ? priority : '',
          index === 0 ? weeks.length : '',
          index === 0 ? rows.length : '',
          index === 0 ? instructorCount : '',
          index === 0 ? assistantCount : '',
          item.week, item.campus, item.course, item.role, item.expected_students, item.target_cell,
          item.locked ? '是' : '',
        ]);
      });
    }
    if (byName.size === 0) ws.addRow(['無排課', null, null, null, null, null, null, null, null, null, null, null, null]);

    setColumnWidths(ws, [14, 10, 10, 10, 10, 10, 18, 12, 18, 10, 10, 10, 8]);
    freezeAndFilter(ws, 'M');

    for (let row = 2; row <= ws.rowCount; row++) {
      const fill = ROLE_FILL[ws.getCell(row, 10).value];
      if (fill) for (let c = 1; c <= headers.length; c++) ws.getCell(row, c).fill = fill;
    }
  }

  // 對應 write_lock_warnings_sheet()：沒有警告時不建立分頁
  function writeLockWarningsSheet(workbook, assignmentReport) {
    const warnings = assignmentReport.lock_warnings || [];
    if (!warnings.length) return;
    const ws = recreateSheet(workbook, '鎖定警告');
    const headers = ['格子', '姓名', '週次', '校區', '課程', '角色', '原因'];
    ws.addRow(headers);
    styleHeaderRow(ws, headers, 'FFF4CCCC');

    for (const item of warnings) {
      ws.addRow([item.target_cell, item.name, item.week, item.campus, item.course, item.role, item.reason]);
    }

    setColumnWidths(ws, [10, 12, 18, 12, 18, 10, 64]);
    freezeAndFilter(ws, 'G');
  }

  // 主表也是「先清空所有講師/助教格子，再依 assignments 填入姓名 + 摘要文字」這段共用邏輯
  function fillMainSheet(ws, requirementReport, assignmentReport) {
    const roleCells = new Set();
    for (const cls of requirementReport.classes || []) {
      for (const item of cls.source_cells?.role_assignment_cells || []) {
        if (item.cell) roleCells.add(item.cell);
      }
    }
    for (const cell of roleCells) ws.getCell(cell).value = null;

    for (const a of assignmentReport.assignments || []) {
      if (a.target_cell) {
        const cell = ws.getCell(a.target_cell);
        cell.value = a.assigned_name;
        applyNormalAssignmentFont(cell);
      }
    }

    ws.getCell('P1').value = '自動排課摘要';
    ws.getCell('P2').value = `已排 ${assignmentReport.summary.assigned_slots} / ${assignmentReport.summary.total_required_slots} 人次`;
    ws.getCell('P3').value = `講師缺口 ${assignmentReport.summary.unfilled_instructor_slots}；助教缺口 ${assignmentReport.summary.unfilled_assistant_slots}`;
    ws.getCell('P4').value = '詳細請見「老師課表」「未排清單」「暫不排課清單」分頁';
  }

  // 資料來源是 Google Sheet 時沒有原始 xlsx 檔案可以複製，改成純粹依照
  // requirementReport 裡每堂課記錄的 source_cells（週次列、課程格、預計人數格、
  // 講師/助教格的 A1 座標）從零建出一張對應的主表。這些座標本來就是這份 Google Sheet
  // 真實的儲存格位置（parseRequirementsFromValues 用同一套欄位配置算出來的），
  // 所以填完之後的排版跟原本的 Google Sheet 是一致的。
  // 校區底色（跟畫面上大致一致的淡色系；如果你原本 style.css 裡的校區配色有指定色碼，
  // 跟我說一聲，我可以改成完全一樣的色碼）
  const CAMPUS_FILL_ARGB = {
    '安和校': 'FFF4CCCC', // 淡紅/粉
    '延壽校': 'FFD9D9D9', // 淡灰
    '大直校': 'FFFCE5CD', // 淡橘/杏
    '板橋校': 'FFD4E6F1', // 淡藍
  };
  function campusFill(campus) {
    return { type: 'pattern', pattern: 'solid', fgColor: { argb: CAMPUS_FILL_ARGB[campus] || 'FFF2F2F2' } };
  }

  function rowNumOf(addr) { const m = /\d+/.exec(addr || ''); return m ? parseInt(m[0], 10) : null; }
  function colLetterFromAddr(addr) { const m = /^[A-Z]+/.exec(addr || ''); return m ? m[0] : null; }

  function buildMainSheetFromScratch(workbook, sheetName, requirementReport, assignmentReport) {
    const ws = recreateSheet(workbook, sheetName);
    const allClasses = [...(requirementReport.classes || []), ...(requirementReport.skipped_classes || [])];

    // 每個校區固定的欄位範圍，直接用 requirement_report.rules.campus_column_groups
    // （不用另外猜，跟解析時用的是同一份設定）
    const campusColRange = new Map();
    for (const [campus, colLetters] of Object.entries(requirementReport.rules?.campus_column_groups || {})) {
      const idxs = colLetters.map(l => U.columnIndexFromString(l));
      campusColRange.set(campus, { min: Math.min(...idxs), max: Math.max(...idxs) });
    }

    // 每個週次的列範圍（從課程列到該週最後一個角色列，例如「延時」那列），
    // 用來把整個週次區塊、依校區欄位整片塗色，效果才會跟畫面上一致（含空白格）。
    const weekRowRange = new Map();
    for (const cls of allClasses) {
      const courseAddr = cls.source_cells?.course;
      if (!courseAddr) continue;
      const weekRow = rowNumOf(courseAddr);
      let maxRow = weekRow;
      for (const rc of cls.source_cells?.role_assignment_cells || []) {
        const r = rowNumOf(rc.cell);
        if (r && r > maxRow) maxRow = r;
      }
      const range = weekRowRange.get(cls.week) || { min: weekRow, max: maxRow };
      range.min = Math.min(range.min, weekRow);
      range.max = Math.max(range.max, maxRow);
      weekRowRange.set(cls.week, range);
    }

    for (const rowRange of weekRowRange.values()) {
      for (const [campus, colRange] of campusColRange) {
        const fill = campusFill(campus);
        for (let r = rowRange.min; r <= rowRange.max; r++) {
          for (let c = colRange.min; c <= colRange.max; c++) {
            ws.getCell(r, c).fill = fill;
          }
        }
      }
    }

    const writtenWeekRows = new Set();
    for (const cls of allClasses) {
      const courseAddr = cls.source_cells?.course;
      const expectedAddr = cls.source_cells?.expected_students;
      if (!courseAddr || !expectedAddr) continue;

      const rowNum = rowNumOf(courseAddr);
      if (rowNum && !writtenWeekRows.has(rowNum)) {
        const weekCell = ws.getCell('A' + rowNum);
        weekCell.value = cls.week;
        weekCell.font = { bold: true };
        writtenWeekRows.add(rowNum);
      }

      const courseCell = ws.getCell(courseAddr);
      courseCell.value = cls.course;
      courseCell.font = { bold: true };
      ws.getCell(expectedAddr).value = cls.expected_students;

      for (const roleCell of cls.source_cells?.role_assignment_cells || []) {
        const roleRowNum = rowNumOf(roleCell.cell);
        if (roleRowNum) {
          ws.getCell('A' + roleRowNum).value = roleCell.role_label; // 講師/助教/延時 標籤（同列重複寫入沒關係）
        }
      }
    }

    ws.getColumn(1).width = 14;
    fillMainSheet(ws, requirementReport, assignmentReport);
    return ws;
  }

  // 對應 write_assigned_workbook()
  // - 如果有 scheduleFileBuffer（檔案上傳流程，或「繼續調整」上傳的排課結果檔）：
  //   複製那份檔案當底稿，只清空/填入講師助教格子，保留原本的其他分頁與格式。
  // - 如果沒有 scheduleFileBuffer（資料來自 Google Sheet，沒有實體 xlsx 可複製）：
  //   從零建立一張跟 requirementReport 座標一致的主表（見 buildMainSheetFromScratch()）。
  async function buildExportWorkbook({ scheduleFileBuffer, sheetName, requirementReport, assignmentReport }) {
    if (typeof ExcelJS === 'undefined') throw new Error('找不到 ExcelJS，請確認 index.html 有載入 ExcelJS CDN');
    const workbook = new ExcelJS.Workbook();

    if (scheduleFileBuffer) {
      await workbook.xlsx.load(scheduleFileBuffer);
      const ws = workbook.getWorksheet(sheetName);
      if (!ws) throw new Error(`找不到工作表：${sheetName}`);
      fillMainSheet(ws, requirementReport, assignmentReport);
    } else {
      buildMainSheetFromScratch(workbook, sheetName, requirementReport, assignmentReport);
    }

    writeAllClassesSheet(workbook, requirementReport);
    writeUnfilledSheet(workbook, assignmentReport);
    writeSkippedSheet(workbook, requirementReport);
    writeTeacherScheduleSheet(workbook, assignmentReport);
    writeLockWarningsSheet(workbook, assignmentReport);

    return workbook;
  }

  // 用瀏覽器 Blob 觸發下載（對應原本 app.py /api/export 回傳檔案下載）
  async function downloadWorkbook(workbook, filename = '排課結果.xlsx') {
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  return { buildExportWorkbook, downloadWorkbook };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = exportExcel;