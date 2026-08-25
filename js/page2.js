// ════════════════════════════════════════
// page2.js — 老師設定（P2）
//
// 純前端版：runSchedule() 改成透過 scheduler.runInWorker()（Web Worker）執行排班，
// 不再 fetch 後端 API。
//
// ⚠ 角色鎖定／助教保護週數（overrides）：比照專案規劃文件「七、」的決定，這裡的 UI 維持
//   原樣（使用者還是可以設定），overrides 也照樣算出來，但目前跟原系統一樣「不會真的
//   影響排課結果」——不會傳進 scheduler.assignSchedule()，也不會拿去改 eligible() 判斷。
//   這不是遺漏，是刻意維持現狀（這本來就是一個新功能，不是「還原」）。
// ════════════════════════════════════════

function getWeeks() {
  const all = [...(S.requirements.classes || []), ...(S.requirements.skipped_classes || [])];
  const weeks = [...new Set(all.map(c => c.week))];
  function ws(w) { const m = w.match(/(\d+)\/(\d+)/); return m ? parseInt(m[1]) * 100 + parseInt(m[2]) : 9999; }
  return weeks.sort((a, b) => ws(a) - ws(b));
}

function buildP2() {
  const ppl = S.staffReport.people.filter(p => p.scheduling_candidate);

  document.getElementById('s-thead').innerHTML =
    '<th>老師</th><th style="min-width:130px">角色設定</th><th style="min-width:90px">助教保護週數<br><span style="font-weight:400;color:var(--text3)">（新進限定）</span></th>';

  renderP2Rows(ppl, '');
  updateP2Count(ppl.length, ppl.length);
}

function renderP2Rows(ppl, keyword) {
  const tb = document.getElementById('s-tbody');
  tb.innerHTML = '';
  const filtered = keyword
    ? ppl.filter(p => p.name.includes(keyword))
    : ppl;

  filtered.forEach(p => {
    const n = p.name, roles = p.eligible_roles || [];
    const canBoth = roles.includes('講師') && roles.includes('助教');
    const isNew = p.is_new_staff || p.new_staff || false;
    const badges = roles.map(r => `<span class="rb ${r === '講師' ? 'ins' : 'ast'}">${r}</span>`).join('');
    const newBadge = isNew ? `<span class="nb">新進</span>` : '';
    const rv = S.rookieWeeks[n] || '';
    const rov = S.roleOverride[n] || '';

    const rCell = canBoth
      ? `<td><select style="font-size:12px;padding:4px 8px" onchange="S.roleOverride['${n}']=this.value">
          <option value="" ${rov === '' ? 'selected' : ''}>照原設定</option>
          <option value="講師" ${rov === '講師' ? 'selected' : ''}>整個營期只當講師</option>
          <option value="助教" ${rov === '助教' ? 'selected' : ''}>整個營期只當助教</option>
        </select></td>`
      : `<td><div style="font-size:12px;color:var(--text2)">${badges}</div></td>`;

    const nCell = isNew
      ? `<td><input class="ri" type="number" min="0" max="20" value="${rv}" placeholder="0"
           oninput="S.rookieWeeks['${n}']=parseInt(this.value)||0"
           title="前 N 週只排助教，之後可排講師"></td>`
      : `<td style="color:var(--text3);font-size:11px;text-align:center">—</td>`;

    tb.innerHTML += `<tr>
      <td><div class="tn">${n}${newBadge}</div><div class="tm">${badges}</div></td>
      ${rCell}${nCell}
    </tr>`;
  });

  updateP2Count(filtered.length, ppl.length);
}

function updateP2Count(shown, total) {
  const el = document.getElementById('p2-count');
  if (el) el.textContent = shown === total ? `共 ${total} 位` : `顯示 ${shown} / ${total} 位`;
}

function onP2Search(val) {
  const ppl = S.staffReport.people.filter(p => p.scheduling_candidate);
  renderP2Rows(ppl, val.trim());
}

function resetS() {
  S.rookieWeeks = {}; S.roleOverride = {};
  buildP2();
  // 清空搜尋框
  const inp = document.getElementById('p2-search-input');
  if (inp) inp.value = '';
  toast('已重設所有設定');
}

function p2Next() {
  if (S.mode === 'resume') goResumeP3();
  else runSchedule();
}

function goResumeP3() {
  buildP3(); goStep(3);
  const s = S.assignmentReport.summary;
  toast(`已還原 ${s.assigned_slots} 筆排課，可繼續調整`, 'ok');
}

async function runSchedule() {
  loading(true, '排班演算中，資料量較大時需要幾分鐘，請耐心等候...');
  try {
    // 角色鎖定／助教保護週數：算出來但目前不影響排課結果（見上方說明與規劃文件「七、」）
    const weeks = getWeeks();
    const overrides = {};
    S.staffReport.people.filter(p => p.scheduling_candidate).forEach(p => {
      const n = p.name, roles = p.eligible_roles || [];
      const global = S.roleOverride[n] || '';
      const rookN = S.rookieWeeks[n] || 0;
      if (global) {
        overrides[n] = {};
        weeks.forEach(w => { overrides[n][w] = global; });
        return;
      }
      if (rookN > 0 && roles.includes('講師') && roles.includes('助教')) {
        overrides[n] = {};
        weeks.forEach((w, i) => { overrides[n][w] = i < rookN ? '助教' : '講師'; });
      }
    });

    const settings = S.settingsSummary || dataFetch.getDefaultSettings();
    const assignmentReport = await scheduler.runInWorker({
      staffReport: S.staffReport,
      requirementReport: S.requirements,
      campusPriority: settings.campus_priority,
      priorityCourses: settings.priority_courses,
      onProgress: (p) => loading(true, `排班演算中... 已完成 ${p.doneWeeks}/${p.totalWeeks} 週，請耐心等候`),
    });
    S.assignmentReport = assignmentReport;
    buildP3(); goStep(3);
    const s = S.assignmentReport.summary;
    toast(`排班完成！已排 ${s.assigned_slots}/${s.total_required_slots} 人次`, 'ok');
  } catch (e) {
    toast('錯誤：' + e.message, 'err');
  } finally {
    loading(false);
  }
}
