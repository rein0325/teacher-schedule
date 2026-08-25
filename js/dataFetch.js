// ════════════════════════════════════════
// dataFetch.js — 讀取資料 → staff_report / requirement_report / assignment_report
// 對應 schedule_generator.py 的 DEFAULT_SETTINGS / load_settings() / parse_staff() /
// parse_requirements() / parse_result_workbook()
//
// ⚠ ExcelJS 讀取範圍一定要用 worksheet.rowCount / worksheet.columnCount，
//   不能用 actualRowCount / actualColumnCount（那兩個會漏掉中間的空白列/欄）。
//
// ── 資料來源抽象層（grid）──
// parseStaff()/parseRequirements() 內部的實際解析邏輯都寫成「吃一個通用 grid 物件」
// （{ rowCount, columnCount, cellAt(r,c), address(r,c) }），上面再包兩層轉接器：
//   - gridFromWorksheet(ws)：包 ExcelJS 的 Worksheet（給檔案上傳流程用）
//   - gridFromValues(values)：包 Google Sheets API 回傳的 2D 陣列（給 Google Sheet 流程用）
// 這樣「檔案上傳」跟「Google Sheet 抓取」可以共用同一份解析邏輯，不必維護兩份。
// ════════════════════════════════════════

const dataFetch = (function () {
  const U = (typeof scheduleUtils !== 'undefined') ? scheduleUtils : require('./scheduleUtils.js');

  const DEFAULT_CAMPUS_PRIORITY = ['大直校', '板橋校', '延壽校', '安和校'];
  const DEFAULT_PRIORITY_COURSES = ['Roblox', 'MicroPython', 'AI'];
  const DEFAULT_SETTINGS_RAW = {
    skip_expected_students_lte: 3,
    assistant_divisor: 8,
    assistant_formula: 'ceil_divisor_minus_1',
    campus_priority: DEFAULT_CAMPUS_PRIORITY,
    priority_courses: DEFAULT_PRIORITY_COURSES,
    campus_groups: [
      { campus: '安和校', cols: ['B', 'C', 'D', 'E'] },
      { campus: '延壽校', cols: ['F', 'G', 'H'] },
      { campus: '大直校', cols: ['I', 'J', 'K'] },
      { campus: '板橋校', cols: ['L', 'M', 'N'] },
    ],
  };

  // 對應 load_settings()：純前端版沒有 settings.json，一律用預設值
  function getDefaultSettings() {
    const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS_RAW));
    settings.campus_groups = settings.campus_groups.map(g => ({
      campus: g.campus,
      cols: g.cols.map(c => (typeof c === 'string' ? U.columnIndexFromString(c) : c)),
    }));
    return settings;
  }

  // ── 讀取 ExcelJS cell 值，攤平富文字/公式/超連結/日期物件 ──
  function cellValue(cell) {
    if (!cell) return null;
    const v = cell.value;
    if (v === null || v === undefined) return null;
    if (v instanceof Date) return v;
    if (typeof v === 'object') {
      if (Array.isArray(v.richText)) return v.richText.map(rt => rt.text).join('');
      if (v.result !== undefined) return v.result;
      if (v.text !== undefined) return v.text;
      if (v.hyperlink !== undefined) return v.text ?? v.hyperlink;
    }
    return v;
  }

  function getSheet(workbook, sheetName) {
    const ws = workbook.getWorksheet(sheetName);
    if (!ws) throw new Error(`找不到工作表：${sheetName}`);
    return ws;
  }

  // ── grid 轉接器 1：包 ExcelJS Worksheet ──
  function gridFromWorksheet(ws) {
    return {
      rowCount: ws.rowCount,       // ⚠ 一定用 rowCount，不能用 actualRowCount
      columnCount: ws.columnCount, // ⚠ 同理，不能用 actualColumnCount
      cellAt(r, c) { return cellValue(ws.getRow(r).getCell(c)); },
      address(r, c) { return ws.getRow(r).getCell(c).address; },
    };
  }

  // ── grid 轉接器 2：包 Google Sheets API values.get 回傳的 2D 陣列 ──
  // （values[r-1][c-1]，1-based 轉 0-based；缺值一律當 null，中間的空白列會保留位置）
  function gridFromValues(values) {
    const rows = values || [];
    const rowCount = rows.length;
    let columnCount = 0;
    for (const row of rows) columnCount = Math.max(columnCount, (row || []).length);
    return {
      rowCount, columnCount,
      cellAt(r, c) {
        const row = rows[r - 1];
        if (!row) return null;
        const v = row[c - 1];
        return (v === undefined || v === '') ? null : v;
      },
      // Google Sheet 的實際欄位跟這裡算出來的 A1 記號是一致的（因為欄位配置本來就是同一份表）
      address(r, c) { return U.getColumnLetter(c) + r; },
    };
  }

  function readGridRow(grid, rowNumber, colCount) {
    const values = [];
    for (let c = 1; c <= colCount; c++) values.push(grid.cellAt(rowNumber, c));
    return values;
  }

  // 對應 core.py 最新版 parse_requirements() 裡的 required_assistants()：
  // ⚠ 這不是寫死的階梯式規則，是可設定公式，預設 settings 會走 ceil_divisor_minus_1：
  //    max(0, ceil(預計人數 / assistant_divisor) - 1)
  // assistant_rule 只是舊版遺留的 fallback 名稱（assistant_formula 沒設定時才會用到）。
  function requiredAssistants(expectedStudents, assistantFormula, assistantDivisor, assistantRule) {
    if (expectedStudents <= 0) return 0;
    if (assistantFormula === 'ceil_divisor_minus_1') return Math.max(0, Math.ceil(expectedStudents / assistantDivisor) - 1);
    if (assistantFormula === 'floor_divisor') return Math.floor(expectedStudents / assistantDivisor);
    if (assistantFormula === 'ceil_divisor') return Math.ceil(expectedStudents / assistantDivisor);
    if (assistantRule === 'ceil_per_8_minus_1') return Math.max(0, Math.ceil(expectedStudents / 8) - 1);
    if (assistantRule === 'floor_per_8') return Math.floor(expectedStudents / 8);
    if (assistantRule === 'ceil_per_8') return Math.ceil(expectedStudents / 8);
    throw new Error(`Unsupported assistant formula: ${assistantFormula}`);
  }

  // ══════════════════════════════════════
  // parseStaff：對應 parse_staff()
  // ══════════════════════════════════════
  function parseStaffFromGrid(grid, sheetLabel, campusPriority, priorityCourses, sourceFileName) {
    const rowCount = grid.rowCount;
    const colCount = grid.columnCount;

    const headers = readGridRow(grid, 1, colCount).map(h => (h !== null && h !== undefined ? String(h).trim() : ''));
    const idx = {};
    headers.forEach((h, i) => { idx[h] = i; }); // 同名欄位以後面為準，比照 Python dict comprehension

    const priorityColIdx = Object.prototype.hasOwnProperty.call(idx, 'Priority') ? idx['Priority'] : undefined;

    const timeCols = [];
    const courseCols = [];
    headers.forEach((h, i) => {
      if (h.startsWith('可授課時段')) timeCols.push([i, U.bracketText(h)]);
      if (h.startsWith('可教授課程')) courseCols.push([i, U.bracketText(h)]);
    });
    const priorityCourseKey = new Set(priorityCourses.map(c => c.toLowerCase()));

    const rawPeople = [];
    for (let rowNo = 2; rowNo <= rowCount; rowNo++) {
      const row = readGridRow(grid, rowNo, colCount);
      if (!row.some(v => v !== null && v !== undefined)) continue;

      const name = U.clean(row[idx['姓名']]);
      const canInstructor = ('可擔任講師' in idx) ? U.triBool(row[idx['可擔任講師']]) : null;
      const canAssistant = ('可擔任助教' in idx) ? U.triBool(row[idx['可擔任助教']]) : null;

      const roles = [];
      if (canInstructor) roles.push('講師');
      if (canAssistant) roles.push('助教');

      rawPeople.push({
        name,
        source_row: rowNo,
        timestamp: ('時間戳記' in idx) ? U.clean(row[idx['時間戳記']]) : null,
        willing_2026_summer: U.yes(row[idx['是否有意願教授2026夏令營課程(7/1~8/28任一周)']]),
        eligible_roles: roles,
        role_flags: { can_be_instructor: canInstructor, can_be_assistant: canAssistant },
        teachable_courses: courseCols.filter(([i]) => i < row.length && U.yes(row[i])).map(([, c]) => c),
        available_time_slots: timeCols.filter(([i]) => i < row.length && U.yes(row[i])).map(([, c]) => c),
        available_campuses: ('可授課校區' in idx) ? U.splitList(row[idx['可授課校區']]) : [],
        priority: (priorityColIdx !== undefined && priorityColIdx < row.length) ? U.clampPriority(row[priorityColIdx]) : 0,
      });
    }

    const byName = new Map();
    for (const person of rawPeople) {
      if (!byName.has(person.name)) byName.set(person.name, []);
      byName.get(person.name).push(person);
    }

    const people = [];
    for (const [name, records] of byName) {
      const allRoles = [], allCourses = [], allSlots = [], allCampuses = [], priorities = [];
      for (const record of records) {
        allRoles.push(...record.eligible_roles);
        allCourses.push(...record.teachable_courses);
        allSlots.push(...record.available_time_slots);
        allCampuses.push(...record.available_campuses);
        priorities.push(record.priority || 0);
      }
      const courses = U.orderedUnion(allCourses, courseCols.map(([, c]) => c));
      const priorityCoursesMatched = courses.filter(c => priorityCourseKey.has(c.toLowerCase()));
      const campuses = U.orderedUnion(allCampuses);

      const timestamps = records.map(r => r.timestamp || '');
      let latestTimestamp = null;
      if (timestamps.length) {
        latestTimestamp = timestamps.reduce((a, b) => (U.cmpStr(a, b) >= 0 ? a : b));
        if (latestTimestamp === '') latestTimestamp = null;
      }

      people.push({
        name,
        source_rows: records.map(r => r.source_row),
        response_count: records.length,
        latest_timestamp: latestTimestamp,
        priority: priorities.length ? Math.max(...priorities) : 0,
        willing_2026_summer: records.some(r => r.willing_2026_summer),
        scheduling_candidate: records.some(r => r.willing_2026_summer) && allRoles.length > 0,
        eligible_roles: U.orderedUnion(allRoles, ['講師', '助教']),
        role_flags: {
          can_be_instructor: records.some(r => r.role_flags.can_be_instructor === true),
          can_be_assistant: records.some(r => r.role_flags.can_be_assistant === true),
        },
        teachable_courses: courses,
        priority_courses_matched: priorityCoursesMatched,
        has_priority_course: priorityCoursesMatched.length > 0,
        available_time_slots: U.orderedUnion(allSlots, timeCols.map(([, c]) => c)),
        available_time_slot_count: new Set(allSlots).size,
        available_campuses: campuses,
        campus_priority_order: campusPriority.filter(c => campuses.includes(c)),
      });
    }

    const duplicateNames = [...byName.entries()].filter(([, records]) => records.length > 1).map(([name]) => name);
    people.sort((a, b) => U.cmpStr(a.name, b.name));

    return {
      source_file: sourceFileName || '',
      sheet: sheetLabel,
      generated_at: new Date().toISOString(),
      merge_policy: '以姓名合併重複回覆；角色、課程、時段、校區皆採聯集。',
      warnings: duplicateNames.length ? ['偵測到重複姓名回覆，已依姓名合併：' + duplicateNames.join(', ')] : [],
      people,
    };
  }

  // 檔案上傳版：包 ExcelJS Workbook
  function parseStaff(workbook, sheetName, campusPriority, priorityCourses, sourceFileName) {
    const ws = getSheet(workbook, sheetName);
    return parseStaffFromGrid(gridFromWorksheet(ws), sheetName, campusPriority, priorityCourses, sourceFileName);
  }

  // Google Sheet 版：直接吃 Sheets API 回傳的 2D 陣列（values）
  function parseStaffFromValues(values, campusPriority, priorityCourses, sourceLabel) {
    return parseStaffFromGrid(gridFromValues(values), sourceLabel || 'GoogleSheet', campusPriority, priorityCourses, sourceLabel);
  }

  // ══════════════════════════════════════
  // parseRequirements：對應 parse_requirements()
  // ══════════════════════════════════════
  function parseRequirementsFromGrid(grid, sheetLabel, assistantRule, settings, sourceFileName) {
    const campusGroups = settings.campus_groups;
    const skipExpectedStudentsLte = parseInt(settings.skip_expected_students_lte ?? 3, 10);
    const assistantDivisor = parseInt(settings.assistant_divisor ?? 8, 10);
    const assistantFormula = settings.assistant_formula || assistantRule;

    const rowCount = grid.rowCount;

    const weekRows = [];
    for (let row = 1; row <= rowCount; row++) {
      const value = U.clean(grid.cellAt(row, 1));
      // ⚠ 需要「M/D~M/D」的週次區間格式，跟 parseResultWorkbook 的判斷不同
      if (value && /^\d{1,2}\/\d{1,2}~\d{1,2}\/\d{1,2}/.test(value)) weekRows.push(row);
    }

    const classes = [], skippedClasses = [], allClasses = [];
    weekRows.forEach((weekRow, idx) => {
      const week = U.clean(grid.cellAt(weekRow, 1));
      const expectedRow = weekRow + 1;
      const nextWeekRow = idx + 1 < weekRows.length ? weekRows[idx + 1] : rowCount + 1;
      const roleRows = [];
      for (let row = weekRow + 2; row < nextWeekRow; row++) {
        const label = U.clean(grid.cellAt(row, 1));
        if (label === '講師' || label === '助教' || label === '延時') roleRows.push({ row, label });
      }

      for (const group of campusGroups) {
        for (const col of group.cols) {
          const course = U.displayCourse(grid.cellAt(weekRow, col));
          if (!course) continue;

          const expectedStudents = U.toInt(grid.cellAt(expectedRow, col));
          const roleCells = roleRows.map(role => ({
            role_label: role.label,
            cell: grid.address(role.row, col),
            current_value: U.clean(grid.cellAt(role.row, col)),
          }));

          const courseAddr = grid.address(weekRow, col);
          const item = {
            class_id: `${week}|${group.campus}|${courseAddr}`,
            week, campus: group.campus, course, expected_students: expectedStudents,
            source_cells: {
              course: courseAddr,
              expected_students: grid.address(expectedRow, col),
              role_assignment_cells: roleCells,
            },
          };

          allClasses.push({ week, campus: group.campus, course, expected_students: expectedStudents });

          if (expectedStudents <= skipExpectedStudentsLte) {
            skippedClasses.push({
              ...item, required_instructor_count: 0, required_assistant_count: 0,
              skip_reason: `預計人數 <= ${skipExpectedStudentsLte}，暫不考慮排課。`,
            });
          } else {
            classes.push({
              ...item, required_instructor_count: 1,
              required_assistant_count: requiredAssistants(expectedStudents, assistantFormula, assistantDivisor, assistantRule),
            });
          }
        }
      }
    });

    return {
      source_file: sourceFileName || '',
      sheet: sheetLabel,
      generated_at: new Date().toISOString(),
      rules: {
        required_instructor_count_per_class: 1,
        assistant_count_rule: assistantFormula,
        assistant_divisor: assistantDivisor,
        skip_rule: `預計人數 <= ${skipExpectedStudentsLte} 的課程暫不考慮排課。`,
        campus_column_groups: Object.fromEntries(campusGroups.map(g => [g.campus, g.cols.map(U.getColumnLetter)])),
      },
      classes,
      skipped_classes: skippedClasses,
      all_classes: allClasses,
    };
  }

  // 檔案上傳版
  function parseRequirements(workbook, sheetName, assistantRule, settings, sourceFileName) {
    const ws = getSheet(workbook, sheetName);
    return parseRequirementsFromGrid(gridFromWorksheet(ws), sheetName, assistantRule, settings, sourceFileName);
  }

  // Google Sheet 版
  function parseRequirementsFromValues(values, assistantRule, settings, sourceLabel) {
    return parseRequirementsFromGrid(gridFromValues(values), sourceLabel || 'GoogleSheet', assistantRule, settings, sourceLabel);
  }

  // ══════════════════════════════════════
  // parseResultWorkbook / parseResultFromValues：對應（已不存在於目前 core.py 的）
  // parse_result_workbook() 概念——這是我們網頁版自己額外做的「繼續調整」功能，
  // 目前的 Streamlit 版本沒有這個功能，是我們獨立維護的邏輯，沿用一樣的
  // 「週次不用 ~、課程名稱取換行前第一行」規則即可。
  //
  // - parseResultWorkbook(workbook, ...)：讀「上傳的排課結果.xlsx」
  // - parseResultFromValues(values, ...)：讀 Google Sheet 目前的即時內容
  //   （如果需求表被人直接在 Google Sheet 上手動填了名字，這個可以把那些名字
  //   當作「已排課」的起始狀態）
  // ══════════════════════════════════════
  function parseResultFromGrid(grid, sheetLabel, assistantRule, settings, sourceFileName) {
    const campusGroups = settings.campus_groups;
    const skipExpectedStudentsLte = parseInt(settings.skip_expected_students_lte ?? 3, 10);
    const assistantDivisor = parseInt(settings.assistant_divisor ?? 8, 10);
    const assistantFormula = settings.assistant_formula || assistantRule;

    const rowCount = grid.rowCount;
    const weekRows = [];
    for (let row = 1; row <= rowCount; row++) {
      const value = U.clean(grid.cellAt(row, 1));
      // ⚠ 這裡只要求「M/D」開頭即可，不需要「~」區間（跟 parseRequirements 不同，已知眉角）
      if (value && /^\d{1,2}\/\d{1,2}/.test(value)) weekRows.push(row);
    }

    const classes = [], skippedClasses = [], assignments = [], allClasses = [];

    weekRows.forEach((weekRow, idx) => {
      const week = U.clean(grid.cellAt(weekRow, 1));
      const expectedRow = weekRow + 1;
      const nextWeekRow = idx + 1 < weekRows.length ? weekRows[idx + 1] : rowCount + 1;
      const roleRows = [];
      for (let row = weekRow + 2; row < nextWeekRow; row++) {
        const label = U.clean(grid.cellAt(row, 1));
        if (label === '講師' || label === '助教' || label === '延時') roleRows.push({ row, label });
      }

      for (const group of campusGroups) {
        for (const col of group.cols) {
          let rawCourse = grid.cellAt(weekRow, col);
          // ⚠ 已知眉角：跟 parseRequirements 不同，這裡要先取換行前的第一行
          if (rawCourse) rawCourse = String(rawCourse).split('\n')[0].trim();
          const course = U.displayCourse(rawCourse);
          if (!course) continue;

          const expectedStudents = U.toInt(grid.cellAt(expectedRow, col));
          const roleCells = [];
          for (const role of roleRows) {
            const cellCoord = grid.address(role.row, col);
            const assignedName = U.clean(grid.cellAt(role.row, col));
            roleCells.push({ role_label: role.label, cell: cellCoord, current_value: assignedName });

            if (assignedName && (role.label === '講師' || role.label === '助教')) {
              assignments.push({
                target_cell: cellCoord, assigned_name: assignedName, assigned_priority: 0,
                week, campus: group.campus, course, role: role.label,
                expected_students: expectedStudents, locked: false, slot_index: null,
              });
            }
          }

          const item = {
            class_id: `${week}|${group.campus}|${grid.address(weekRow, col)}`,
            week, campus: group.campus, course, expected_students: expectedStudents,
            source_cells: {
              course: grid.address(weekRow, col),
              expected_students: grid.address(expectedRow, col),
              role_assignment_cells: roleCells,
            },
          };

          allClasses.push({ week, campus: group.campus, course, expected_students: expectedStudents });

          if (expectedStudents <= skipExpectedStudentsLte) {
            skippedClasses.push({
              ...item, required_instructor_count: 0, required_assistant_count: 0,
              skip_reason: `預計人數 <= ${skipExpectedStudentsLte}，暫不考慮排課。`,
            });
          } else {
            classes.push({
              ...item, required_instructor_count: 1,
              required_assistant_count: requiredAssistants(expectedStudents, assistantFormula, assistantDivisor, assistantRule),
            });
          }
        }
      }
    });

    const requirementReport = {
      source_file: sourceFileName || '',
      sheet: sheetLabel,
      generated_at: new Date().toISOString(),
      restored_from_result: true,
      rules: {
        required_instructor_count_per_class: 1,
        assistant_count_rule: assistantFormula,
        assistant_divisor: assistantDivisor,
        skip_rule: `預計人數 <= ${skipExpectedStudentsLte} 的課程暫不考慮排課。`,
        campus_column_groups: Object.fromEntries(campusGroups.map(g => [g.campus, g.cols.map(U.getColumnLetter)])),
      },
      classes, skipped_classes: skippedClasses, all_classes: allClasses,
    };

    const totalReq = classes.reduce((s, c) => s + c.required_instructor_count + c.required_assistant_count, 0);
    const assignedCount = assignments.length;
    const instructorCount = assignments.filter(a => a.role === '講師').length;
    const assistantCount = assignments.filter(a => a.role === '助教').length;

    const assignmentReport = {
      source_file: sourceFileName || '',
      generated_at: new Date().toISOString(),
      restored_from_excel: true,
      assignments,
      summary: {
        assigned_slots: assignedCount,
        total_required_slots: totalReq,
        unfilled_slots: Math.max(0, totalReq - assignedCount),
        unfilled_instructor_slots: 0,
        unfilled_assistant_slots: 0,
        instructor_assigned: instructorCount,
        assistant_assigned: assistantCount,
      },
      lock_warnings: [],
    };

    return { requirementReport, assignmentReport };
  }

  // 檔案上傳版（上傳「排課結果.xlsx」）
  function parseResultWorkbook(workbook, sheetName, assistantRule, settings, sourceFileName) {
    let actualSheetName = sheetName;
    if (!workbook.getWorksheet(actualSheetName)) {
      actualSheetName = workbook.worksheets[0].name;
    }
    const ws = getSheet(workbook, actualSheetName);
    return parseResultFromGrid(gridFromWorksheet(ws), actualSheetName, assistantRule, settings, sourceFileName);
  }

  // Google Sheet 版（讀取需求表目前即時內容，把已經手動填的名字當成起始排課狀態）
  function parseResultFromValues(values, sheetLabel, assistantRule, settings, sourceFileName) {
    return parseResultFromGrid(gridFromValues(values), sheetLabel || 'GoogleSheet', assistantRule, settings, sourceFileName);
  }

  return {
    getDefaultSettings,
    parseStaff, parseStaffFromValues,
    parseRequirements, parseRequirementsFromValues,
    parseResultWorkbook, parseResultFromValues,
    gridFromWorksheet, gridFromValues,
    cellValue, getSheet,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = dataFetch;
