// ════════════════════════════════════════
// page3.js — 排班結果（P3）+ 老師統計
// ════════════════════════════════════════

// ── amap 建立 ──
function buildAmap() {
  S.amap = {}; S.ubw = {}; S.acnt = {};
  for (const a of (S.assignmentReport.assignments || [])) {
    if (a.target_cell) S.amap[a.target_cell] = a;
    const nm = a.assigned_name;
    if (nm) {
      if (!S.ubw[a.week]) S.ubw[a.week] = new Set();
      S.ubw[a.week].add(nm);
      S.acnt[nm] = (S.acnt[nm] || 0) + 1;
    }
  }
}

// ── 排班表格 ──
function buildP3() {
  buildAmap();
  const all = [...(S.requirements.classes || []), ...(S.requirements.skipped_classes || [])];

  // 欄定義
  const colDefs = []; const seen = new Set();
  for (const cls of all) {
    const coord = cls.source_cells?.course; if (!coord) continue;
    const col = coord.replace(/[0-9]/g, '');
    const key = cls.campus + '|' + col;
    if (!seen.has(key)) { seen.add(key); colDefs.push({ campus: cls.campus, col, key }); }
  }
  colDefs.sort((a, b) => {
    const ai = DISPLAY_CAMPUS_ORDER.indexOf(a.campus) < 0 ? 99 : DISPLAY_CAMPUS_ORDER.indexOf(a.campus);
    const bi = DISPLAY_CAMPUS_ORDER.indexOf(b.campus) < 0 ? 99 : DISPLAY_CAMPUS_ORDER.indexOf(b.campus);
    return ai !== bi ? ai - bi : (a.col < b.col ? -1 : a.col > b.col ? 1 : 0);
  });

  // class lookup
  const cmap = {};
  for (const cls of all) {
    const coord = cls.source_cells?.course; if (!coord) continue;
    const col = coord.replace(/[0-9]/g, '');
    cmap[cls.week + '|' + cls.campus + '|' + col] = cls;
  }

  const weeks = getWeeks();
  const s = S.assignmentReport.summary;
  document.getElementById('pills').innerHTML =
    `<span class="pill pg">已排 ${s.assigned_slots}/${s.total_required_slots}</span>` +
    (s.unfilled_instructor_slots ? `<span class="pill po">講師缺 ${s.unfilled_instructor_slots}</span>` : '') +
    (s.unfilled_assistant_slots ? `<span class="pill pr">助教缺 ${s.unfilled_assistant_slots}</span>` : '');

  const cg = {}; for (const c of colDefs) { if (!cg[c.campus]) cg[c.campus] = []; cg[c.campus].push(c); }
  const co = [...new Set(colDefs.map(c => c.campus))];
  const colCampusIdx = {}; colDefs.forEach(c => { colCampusIdx[c.key] = campusColorIdx(c.campus); });
  const campusFirstCol = new Set(); co.forEach(campus => { if (cg[campus]?.length) campusFirstCol.add(cg[campus][0].key); });

  // thead
  let r1 = `<th class="rh" rowspan="2">週次</th>`;
  let r2 = '';
  co.forEach(campus => {
    const cols = cg[campus];
    const ci = campusColorIdx(campus);
    const isFirst = co.indexOf(campus) > 0;
    r1 += `<th colspan="${cols.length}" class="ch ch-c${ci}${isFirst ? ' campus-sep' : ''}">${campus}</th>`;
    cols.forEach((c, i) => {
      const sep = (i === 0 && isFirst) ? ' campus-sep' : '';
      r2 += `<th class="col-c${ci}${sep}" style="top:33px;font-size:10px">${c.col}</th>`;
    });
  });
  document.getElementById('sct-head').innerHTML = `<tr>${r1}</tr><tr>${r2}</tr>`;

  // tbody
  const tb = document.getElementById('sct-body'); tb.innerHTML = '';
  for (const wk of weeks) {
    let row = `<tr><td class="wl">${wk}</td>`;
    for (const cd of colDefs) {
      const ci = colCampusIdx[cd.key];
      const sep = campusFirstCol.has(cd.key) ? ' campus-sep' : '';
      const cls = cmap[wk + '|' + cd.campus + '|' + cd.col];
      if (!cls) { row += `<td class="etd col-c${ci}${sep}"><div class="etd-i">—</div></td>`; continue; }
      row += buildCell(cls, ci, sep);
    }
    row += '</tr>'; tb.innerHTML += row;
  }

  // click + 高亮
  tb.querySelectorAll('.cc').forEach(el => {
    el.addEventListener('click', () => {
      tb.querySelectorAll('.cc').forEach(c => c.classList.remove('sel', 'hl-teacher', 'hl-cand'));
      el.classList.add('sel');
      let cls; try { cls = JSON.parse(el.dataset.cls); } catch { return; }
      S.selCell = cls; S.selSlot = null; renderPanel(cls);
    });
  });
  clearPanel();
}

function buildCell(cls, ci = 0, sep = '') {
  const skipN = S.settingsSummary?.skip_expected_students_lte ?? 3;
  const isSmall = cls.expected_students <= skipN;
  const slots = cls.source_cells?.role_assignment_cells || [];
  const enc = JSON.stringify(cls).replace(/'/g, '&#39;');

  // 計算應配置人數
  function requiredCounts(n) {
    if (n <= 8)  return { instructor: 1, assistant: 0 };
    if (n <= 17) return { instructor: 1, assistant: 1 };
    return           { instructor: 1, assistant: 2 };
  }

  // 實際已排人數
  const assignedInstructor = slots.filter(s => s.role_label === '講師' && S.amap[s.cell]?.assigned_name).length;
  const assignedAssistant  = slots.filter(s => s.role_label === '助教' && S.amap[s.cell]?.assigned_name).length;
  const anyAssigned = assignedInstructor + assignedAssistant > 0;

  // 警示判斷
  let warn = false;
  if (isSmall) {
    warn = !anyAssigned; // 小班：有排就不警示
  } else {
    const req = requiredCounts(cls.expected_students);
    warn = assignedInstructor < req.instructor || assignedAssistant < req.assistant;
  }

  // 格子內容
  let body = '';
  if (isSmall && !anyAssigned) {
    body = `<div class="smh">小班，點選手動指派</div>`;
  } else {
    body = slots.map(s => {
      const a = S.amap[s.cell];
      const nm = a?.assigned_name || '';
      const rc = s.role_label === '講師' ? 't' : 'a';
      // 小班只顯示已排的人，大班顯示全部（含待排）
      if (isSmall && !nm) return '';
      return `<div class="sr"><span class="rt ${rc}">${s.role_label === '講師' ? '師' : '助'}</span><span class="sn ${nm ? '' : 'e'}">${nm || '待排'}</span></div>`;
    }).join('');
  }

  return `<td class="col-c${ci}${sep}"><div class="cc ${isSmall ? 'sm' : ''}" data-cls='${enc}'>
    <div class="crs">${cls.course}</div>
    <div class="stu ${isSmall ? 'sm' : ''}">${cls.expected_students}人${warn ? ' ⚠' : ''}</div>
    ${body}
  </div></td>`;
}

// ── Panel ──
function renderPanel(cls) {
  document.getElementById('ep').style.display = '';
  document.getElementById('p-empty').style.display = 'none';
  const pb = document.getElementById('p-body'); pb.style.display = 'block';
  const skipN = S.settingsSummary?.skip_expected_students_lte ?? 3;
  const isSmall = cls.expected_students <= skipN;
  const slots = cls.source_cells?.role_assignment_cells || [];

  let h = `<div class="pst">課程資訊</div>
    <div class="ir"><span class="il">週次</span><span class="iv">${cls.week}</span></div>
    <div class="ir"><span class="il">校區</span><span class="iv">${cls.campus}</span></div>
    <div class="ir"><span class="il">課程</span><span class="iv">${cls.course}</span></div>
    <div class="ir"><span class="il">預計人數</span><span class="iv" style="${isSmall ? 'color:var(--sm)' : ''}">${cls.expected_students}人${isSmall ? ' (小班)' : ''}</span></div>`;

  if (slots.length) {
    h += `<div class="pst" style="margin-top:14px">目前排課（點選後可換人）</div>`;
    slots.forEach((slot, i) => {
      const a = S.amap[slot.cell];
      const nm = a?.assigned_name || '';
      const rc = slot.role_label === '講師' ? 't' : 'a';
      const isSel = S.selSlot === i;
      h += `<div class="cs ${isSel ? 'sel' : ''}" onclick="selSlotFn(${i})">
        <span class="cs-role rt ${rc}">${slot.role_label === '講師' ? '師' : '助'}</span>
        <span class="cs-name ${nm ? '' : 'e'}">${nm || '尚未排課'}</span>
        ${nm ? `<button class="btn btn-xs btn-g" onclick="clearSlot('${slot.cell}',event)" style="flex-shrink:0">清空</button>` : ''}
      </div>`;
    });
  }
  h += `<div id="cands"></div>`;
  pb.innerHTML = h;

  if (S.selSlot !== null) loadCands(cls, S.selSlot);
  else if (slots.length) {
    document.getElementById('cands').innerHTML =
      `<div class="pst" style="margin-top:14px">候選人</div><div style="font-size:12px;color:var(--text3)">點選上方欄位查看候選人</div>`;
  }
}

function highlightTeacher(nm) {
  document.getElementById('sct-body').querySelectorAll('.cc').forEach(el => {
    el.classList.remove('hl-teacher');
    if (!nm) return;
    let cls; try { cls = JSON.parse(el.dataset.cls); } catch { return; }
    const slots = cls.source_cells?.role_assignment_cells || [];
    if (slots.some(s => S.amap[s.cell]?.assigned_name === nm)) el.classList.add('hl-teacher');
  });
}

function highlightCand(nm, on) {
  document.getElementById('sct-body').querySelectorAll('.cc').forEach(el => {
    if (!on) { el.classList.remove('hl-cand'); return; }
    let cls; try { cls = JSON.parse(el.dataset.cls); } catch { return; }
    const slots = cls.source_cells?.role_assignment_cells || [];
    if (slots.some(s => S.amap[s.cell]?.assigned_name === nm)) el.classList.add('hl-cand');
    else el.classList.remove('hl-cand');
  });
}

function selSlotFn(i) {
  S.selSlot = i;
  renderPanel(S.selCell);
  loadCands(S.selCell, i);
  const slots = S.selCell?.source_cells?.role_assignment_cells || [];
  const nm = slots[i] ? S.amap[slots[i].cell]?.assigned_name : null;
  highlightTeacher(nm || null);
}

function loadCands(cls, idx) {
  const slots = cls.source_cells?.role_assignment_cells || [];
  if (idx >= slots.length) return;
  const slot = slots[idx];
  try {
    const curNm = S.amap[slot.cell]?.assigned_name;
    const used = [...(S.ubw[cls.week] || [])].filter(n => n !== curNm);
    const result = candidates.getCandidates({
      staff: S.staffReport, week: cls.week, campus: cls.campus, course: cls.course,
      role: slot.role_label, used_names: used, assignment_counts: S.acnt,
    });
    renderCands(result, slot.cell, cls.week);
  } catch (e) {
    document.getElementById('cands').innerHTML =
      `<div class="pst" style="margin-top:14px">候選人</div><div style="color:var(--red);font-size:12px">${e.message}</div>`;
  }
}

function renderCands({ candidates, conflict_candidates }, cell, week) {
  let h = `<div class="pst" style="margin-top:14px">候選人（${candidates.length}）</div>`;
  if (!candidates.length && !conflict_candidates.length)
    h += `<div style="font-size:12px;color:var(--text3)">無符合條件的候選人</div>`;

  for (const c of candidates)
    h += `<div class="ci"
      onclick="assign('${cell}','${c.name}','${week}')"
      onmouseenter="highlightCand('${c.name}',true)"
      onmouseleave="highlightCand('${c.name}',false)">
      <span class="cn">${c.name}</span>
      ${c.priority > 0 ? `<span class="cb cbp">P${c.priority}</span>` : ''}
      <span class="cb cbc">${c.assignment_count}次</span>
    </div>`;

  if (conflict_candidates.length) {
    h += `<div style="font-size:11px;color:var(--text3);margin:8px 0 4px">同週已排課（衝突）</div>`;
    for (const c of conflict_candidates)
      h += `<div class="ci cf"
        onmouseenter="highlightCand('${c.name}',true)"
        onmouseleave="highlightCand('${c.name}',false)">
        <span class="cn">${c.name}</span>
        <span style="font-size:10px;color:var(--red)">衝突</span>
      </div>`;
  }

  // 強制指派
  const cls = S.selCell;
  if (cls) {
    const usedThisWeek = S.ubw[week] || new Set();
    const forceable = (S.staffReport?.people || []).filter(p => {
      if (!p.scheduling_candidate) return false;
      if (usedThisWeek.has(p.name)) return false;
      if (candidates.some(c => c.name === p.name)) return false;
      if (conflict_candidates.some(c => c.name === p.name)) return false;
      return p.available_time_slots?.includes(week);
    });
    if (forceable.length) {
      h += `<div style="margin-top:12px">
        <button class="btn btn-g btn-sm" style="width:100%;justify-content:center;border-color:var(--orange);color:var(--orange)"
          onclick="toggleForceList(this,'${cell}','${week}','${cls.course.replace(/'/g, "\\'")}')" data-open="0">
          ⚡ 強制指派（${forceable.length} 人可選）
        </button>
        <div id="force-list" style="display:none;margin-top:6px"></div>
      </div>`;
      window._forceablePeople = forceable;
    }
  }
  document.getElementById('cands').innerHTML = h;
}

function toggleForceList(btn, cell, week, course) {
  const open = btn.dataset.open === '1';
  const list = document.getElementById('force-list');
  if (open) {
    list.style.display = 'none';
    btn.dataset.open = '0';
    btn.textContent = `⚡ 強制指派（${(window._forceablePeople || []).length} 人可選）`;
    return;
  }
  btn.dataset.open = '1';
  btn.textContent = '▲ 收起強制指派';
  let h = `<div style="font-size:11px;color:var(--text2);margin-bottom:6px">以下老師這週有空但未勾選此課程意願</div>`;
  for (const p of (window._forceablePeople || []))
    h += `<div class="ci force"
      onclick="forceAssign('${cell}','${p.name}','${week}','${course}')"
      onmouseenter="highlightCand('${p.name}',true)"
      onmouseleave="highlightCand('${p.name}',false)">
      <span class="cn">${p.name}</span>
      <span class="cb cbc">${S.acnt[p.name] || 0}次</span>
    </div>`;
  list.innerHTML = h;
  list.style.display = '';
}

// 強制指派 modal
let _forceArgs = null;
function forceAssign(cell, nm, week, course) {
  _forceArgs = { cell, nm, week };
  document.getElementById('force-msg').innerHTML =
    `確定要強制指派 <strong>${nm}</strong> 到 <strong>${week} ${course}</strong>？<br><br>此老師未勾選此課程的授課意願，請確認後再指派。`;
  document.getElementById('force-modal').classList.add('show');
}
function forceConfirm() {
  if (!_forceArgs) return;
  const { cell, nm, week } = _forceArgs;
  _forceArgs = null;
  document.getElementById('force-modal').classList.remove('show');
  assign(cell, nm, week);
}
function forceCancel() {
  _forceArgs = null;
  document.getElementById('force-modal').classList.remove('show');
}

// ── 指派 / 清空 ──
function assign(cell, nm, week) {
  const old = S.amap[cell];
  if (old?.assigned_name) {
    S.ubw[old.week]?.delete(old.assigned_name);
    S.acnt[old.assigned_name] = Math.max(0, (S.acnt[old.assigned_name] || 1) - 1);
  }
  if (!S.amap[cell]) S.amap[cell] = { target_cell: cell, week };
  S.amap[cell].assigned_name = nm;
  if (!S.ubw[week]) S.ubw[week] = new Set();
  S.ubw[week].add(nm);
  S.acnt[nm] = (S.acnt[nm] || 0) + 1;
  syncRpt(); rebuild(); toast('已指派 ' + nm, 'ok');
}

function clearSlot(cell, ev) {
  ev.stopPropagation();
  const a = S.amap[cell]; if (!a?.assigned_name) return;
  S.ubw[a.week]?.delete(a.assigned_name);
  S.acnt[a.assigned_name] = Math.max(0, (S.acnt[a.assigned_name] || 1) - 1);
  delete S.amap[cell].assigned_name;
  syncRpt(); rebuild(); toast('已清空');
}

function syncRpt() {
  S.assignmentReport.assignments = Object.values(S.amap).filter(a => a.assigned_name);
}

function rebuild() {
  const sc = S.selCell, si = S.selSlot;
  buildP3();
  if (!sc) return;
  document.getElementById('sct-body').querySelectorAll('.cc').forEach(el => {
    let d; try { d = JSON.parse(el.dataset.cls); } catch { return; }
    if (d.week === sc.week && d.campus === sc.campus && d.course === sc.course) {
      el.classList.add('sel');
      S.selCell = sc; S.selSlot = si;
      renderPanel(sc);
      if (si !== null) loadCands(sc, si);
    }
  });
}

// ── Panel 開關 ──
function togglePanel() {
  const ep = document.getElementById('ep');
  if (ep.style.display === 'none' || ep.style.display === '') {
    ep.style.display = '';
    document.getElementById('btn-panel').textContent = '📋 課程資訊';
    if (S.selCell) renderPanel(S.selCell);
  } else {
    closePanel();
  }
}
function closePanel() {
  document.getElementById('ep').style.display = 'none';
  S.selCell = null; S.selSlot = null;
}
function clearPanel() {
  document.getElementById('p-empty').style.display = '';
  document.getElementById('p-body').style.display = 'none';
  S.selCell = null; S.selSlot = null;
}

// ── 重新排班 ──
async function rerunAll() {
  showConfirm(
    '⚠️ 全部重新排班',
    '全部重新排班會<strong>覆蓋目前所有手動修改</strong>，確定繼續？',
    '確認重新排班',
    'background:var(--red)',
    () => runSchedule()
  );
}

async function rerunFill() {
  loading(true, '補排缺額中...');
  try {
    // 當場從目前畫面上的排課結果（S.amap）現組一份 locked_cells，代表「這些已經排好的
    // 格子這次不要動，只補空的」——這份鎖定資訊只存在於這次請求裡（見規劃文件「五、」）。
    const locks = {};
    const allCls = [
      ...(S.requirements.classes || []),
      ...(S.requirements.skipped_classes || [])
    ];
    for (const cls of allCls) {
      const slots = cls.source_cells?.role_assignment_cells || [];
      for (const slot of slots) {
        const a = S.amap[slot.cell];
        if (a?.assigned_name) locks[slot.cell] = a.assigned_name;
      }
    }
    const settings = S.settingsSummary || dataFetch.getDefaultSettings();
    const assignmentReport = await scheduler.runInWorker({
      staffReport: S.staffReport,
      requirementReport: S.requirements,
      campusPriority: settings.campus_priority,
      priorityCourses: settings.priority_courses,
      lockedCells: locks,
      onProgress: (p) => loading(true, `補排缺額中... 已完成 ${p.doneWeeks}/${p.totalWeeks} 週，請耐心等候`),
    });
    S.assignmentReport = assignmentReport;
    buildP3(); goStep(3);
    const s = S.assignmentReport.summary;
    const filled = s.assigned_slots - Object.keys(locks).length;
    toast(`補排完成！新增 ${filled} 筆排課，共 ${s.assigned_slots}/${s.total_required_slots}`, 'ok');
  } catch (e) {
    toast('錯誤：' + e.message, 'err');
  } finally {
    loading(false);
  }
}

// ── 匯出（原名 exportExcel()，改名 runExport() 避免跟檔名 exportExcel.js 撞名）──
// 不管有沒有執行過排班都可以匯出：沒排過就匯出「全部未排」的版本，
// 排過就匯出目前畫面上的排課結果（含手動調整過的部分）。
async function runExport() {
  if (!S.requirements) { toast('請先匯入資料', 'err'); return; }
  loading(true, '產生 Excel 中...');
  try {
    const assignmentReport = S.assignmentReport || scheduler.emptyAssignmentReport(S.requirements);
    const sheetName = S.requirements.sheet || SCHEDULE_SHEET_NAME;
    const workbook = await exportExcel.buildExportWorkbook({
      scheduleFileBuffer: S.scheduleFileBuffer || null,
      sheetName,
      requirementReport: S.requirements,
      assignmentReport,
    });
    await exportExcel.downloadWorkbook(workbook, 'schedule_assigned_2026_summer.xlsx');
    toast('Excel 下載完成！', 'ok');
  } catch (e) {
    toast('錯誤：' + e.message, 'err');
  } finally {
    loading(false);
  }
}

// ── 老師統計（含展開明細）──
function openStats() {
  if (!S.assignmentReport) { toast('請先完成排班', 'err'); return; }

  // 統計每位老師：講師次數、助教次數、每筆明細（週次+角色）
  const cnt = {};
  (S.assignmentReport.assignments || []).forEach(a => {
    if (!a.assigned_name) return;
    const n = a.assigned_name;
    if (!cnt[n]) cnt[n] = { t: 0, a: 0, detail: [] };
    if (a.role === '講師') cnt[n].t++;
    else cnt[n].a++;
    cnt[n].detail.push({ week: a.week, role: a.role });
  });
  // 補 0 排課老師
  (S.staffReport?.people || []).filter(p => p.scheduling_candidate).forEach(p => {
    if (!cnt[p.name]) cnt[p.name] = { t: 0, a: 0, detail: [] };
  });

  const rows = Object.entries(cnt).map(([n, v]) => ({ n, t: v.t, a: v.a, tot: v.t + v.a, detail: v.detail }));
  rows.sort((a, b) => b.tot - a.tot || a.n.localeCompare(b.n, 'zh-TW'));

  const html = `<div class="stats-row hd">
    <div>老師姓名</div>
    <div class="stats-num sn-t">講師</div>
    <div class="stats-num sn-a">助教</div>
    <div class="stats-num sn-tot">合計</div>
    <div></div>
  </div>` + rows.map((r, idx) => {
    // 按週次排序明細
    const sorted = [...r.detail].sort((a, b) => {
      const ws = w => { const m = w.match(/(\d+)\/(\d+)/); return m ? parseInt(m[1]) * 100 + parseInt(m[2]) : 9999; };
      return ws(a.week) - ws(b.week);
    });
    const tags = sorted.map(d => {
      // 找到這位老師在這週的課程名稱（用來定位格子）
      const asgn = (S.assignmentReport.assignments || []).find(a =>
        a.assigned_name === r.n && a.week === d.week && a.role === d.role
      );
      const clickable = asgn ? `onclick="jumpToCell('${d.week}','${(asgn.campus||'').replace(/'/g,"\\'")}','${(asgn.course||'').replace(/'/g,"\\'")}',event)" style="cursor:pointer" title="點我跳到此格"` : '';
      return `<span class="sd-tag ${d.role === '講師' ? 'sd-t' : 'sd-a'} ${asgn ? 'sd-link' : ''}" ${clickable}>${d.week} ${d.role === '講師' ? '師' : '助'}</span>`;
    }).join('');
    const detailHtml = r.tot > 0
      ? `<div class="stats-detail" id="sd-${idx}">
          <div class="sd-label">排課明細</div>
          <div class="sd-week">${tags}</div>
        </div>`
      : `<div class="stats-detail" id="sd-${idx}"><div style="color:var(--text3);font-size:11px">本營期無排課</div></div>`;

    return `<div class="stats-row" onclick="toggleStatsDetail(${idx},this)">
      <div class="stats-name">${r.n}</div>
      <div class="stats-num sn-t">${r.t || '—'}</div>
      <div class="stats-num sn-a">${r.a || '—'}</div>
      <div class="stats-num sn-tot">${r.tot}</div>
      <div class="stats-chevron" id="sc-${idx}">▾</div>
    </div>${detailHtml}`;
  }).join('');

  document.getElementById('stats-body').innerHTML = html;
  document.getElementById('stats-modal').classList.add('open');
}

function toggleStatsDetail(idx, row) {
  const detail = document.getElementById('sd-' + idx);
  const chevron = document.getElementById('sc-' + idx);
  if (!detail) return;
  const isOpen = detail.classList.toggle('open');
  chevron.classList.toggle('open', isOpen);
}

function closeStats() {
  document.getElementById('stats-modal').classList.remove('open');
}

// 從統計面板點週次 tag，跳到排班表格對應格子並展開面板
function jumpToCell(week, campus, course, e) {
  e.stopPropagation(); // 防止觸發展開/收合列
  closeStats();

  // 找到對應的 .cc 格子
  const cells = document.getElementById('sct-body').querySelectorAll('.cc');
  let target = null;
  for (const el of cells) {
    let cls;
    try { cls = JSON.parse(el.dataset.cls); } catch { continue; }
    if (cls.week === week && cls.campus === campus && cls.course === course) {
      target = el;
      break;
    }
  }
  if (!target) { toast('找不到對應格子', 'err'); return; }

  // 清除其他高亮，選中這格
  cells.forEach(c => c.classList.remove('sel', 'hl-teacher', 'hl-cand'));
  target.classList.add('sel');

  // 滾動到那格（置中顯示）
  target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });

  // 展開右側面板
  let cls;
  try { cls = JSON.parse(target.dataset.cls); } catch { return; }
  S.selCell = cls;
  S.selSlot = null;

  // 確保面板是開的
  document.getElementById('ep').style.display = '';
  renderPanel(cls);
}