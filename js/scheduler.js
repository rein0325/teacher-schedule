// ════════════════════════════════════════
// scheduler.js — 排課核心：位元遮罩動態規劃
// 對應 schedule_generator.py 的 assign_schedule()
//
// ⚠ 效能事實：真實資料（10 週、每週最多快 40 個槽位）純排課核心實測跑 155~158 秒，
//   絕對不能在瀏覽器主執行緒直接呼叫，一定要透過 scheduler.worker.js 的 Web Worker 執行
//   （見 runInWorker()）。
// ⚠ 位元遮罩全部使用 BigInt：JS 的 <</|/& 是 32-bit 有號整數運算，這份資料每週槽位數
//   可能超過 31 個，用一般數字做遮罩會靜靜算錯。
// ════════════════════════════════════════

const scheduler = (function () {
  const U = (typeof scheduleUtils !== 'undefined') ? scheduleUtils : require('./scheduleUtils.js');

  function bitPosition(bit) {
    let n = 0, b = bit;
    while (b > 1n) { b >>= 1n; n++; }
    return n;
  }

  function popcount(mask) {
    let n = 0, m = mask;
    while (m > 0n) { n += Number(m & 1n); m >>= 1n; }
    return n;
  }

  // 排課核心。輸入/輸出格式對應 schedule_generator.py 的 assign_schedule()。
  function assignSchedule({
    staffReport,
    requirementReport,
    campusPriority,
    priorityCourses,
    lockedCells = {},   // {cell: name}，比照 app.py 原本收到的 locked_cells 格式
    onProgress = null,   // ({doneWeeks, totalWeeks, week}) => void，每排完一週呼叫一次
  }) {
    // locked_cells:{cell:name} → locked_assignments:{cell:{name}}（比照 app.py 的轉換）
    const lockedAssignments = {};
    for (const [cell, name] of Object.entries(lockedCells || {})) {
      lockedAssignments[cell] = { name };
    }
    // Web 版從未使用「跨 session 持久化鎖定檔」這套機制（見規劃文件「五、」），維持恆為空物件
    const unlockExclusions = {};

    const priorityNorm = new Set(priorityCourses.map(U.normalizeCourse));
    const people = staffReport.people;
    const peopleByName = new Map(people.map(p => [p.name, p]));
    const classes = requirementReport.classes;

    // 每人預先算好常用集合，加速 eligible()/candidateSortKey() 判斷（跟逐次計算結果相同，只是快）
    for (const p of people) {
      p._slotsSet = new Set(p.available_time_slots || []);
      p._campusesSet = new Set(p.available_campuses || []);
      p._rolesSet = new Set(p.eligible_roles || []);
      p._courseSet = new Set((p.teachable_courses || []).map(U.normalizeCourse));
      p._priorityCourseCount = [...p._courseSet].filter(c => priorityNorm.has(c)).length;
    }

    function campusRank(campus) {
      const i = campusPriority.indexOf(campus);
      return i < 0 ? 99 : i;
    }
    function coursePriorityRank(course) {
      return priorityNorm.has(U.normalizeCourse(course)) ? 0 : 1;
    }
    function canTeach(person, course) {
      return person._courseSet.has(U.normalizeCourse(course));
    }
    function eligible(person, cls, role) {
      return !!person.scheduling_candidate
        && person._rolesSet.has(role)
        && person._slotsSet.has(cls.week)
        && person._campusesSet.has(cls.campus)
        && canTeach(person, cls.course);
    }
    function classSortKey(cls) {
      return [-(cls.expected_students || 0), coursePriorityRank(cls.course), campusRank(cls.campus), cls.course, cls.class_id];
    }
    function targetCellFor(cls, role, slotIndex) {
      const roleMatches = (cls.source_cells?.role_assignment_cells || []).filter(item => item.role_label === role);
      if (roleMatches.length) return roleMatches[Math.min(slotIndex - 1, roleMatches.length - 1)].cell;
      return null;
    }
    function lockedNameForSlot(cls, role, slotIndex) {
      const targetCell = targetCellFor(cls, role, slotIndex);
      if (!targetCell) return null;
      const lock = lockedAssignments[targetCell];
      return lock ? lock.name : null;
    }
    function excludedNameForSlot(cls, role, slotIndex) {
      const targetCell = targetCellFor(cls, role, slotIndex);
      if (!targetCell) return null;
      return unlockExclusions[targetCell] || null;
    }

    const classesByWeek = new Map();
    for (const cls of classes) {
      if (!classesByWeek.has(cls.week)) classesByWeek.set(cls.week, []);
      classesByWeek.get(cls.week).push(cls);
    }

    const assignmentCounts = new Map();
    const roleCounts = new Map();
    const usedByWeek = new Map();
    const assignments = [];
    const unfilled = [];
    const lockWarnings = [];

    function bump(map, key, delta) { map.set(key, (map.get(key) || 0) + delta); }

    function addAssignment(cls, role, slotIndex, personName, candidateNames, locked) {
      const person = peopleByName.get(personName);
      assignments.push({
        class_id: cls.class_id, week: cls.week, campus: cls.campus, course: cls.course,
        expected_students: cls.expected_students, role, slot_index: slotIndex,
        assigned_name: personName, assigned_priority: person ? person.priority : null,
        target_cell: targetCellFor(cls, role, slotIndex),
        candidate_count: (candidateNames || []).length,
        candidate_names: (candidateNames || []).slice(0, 10),
        locked: !!locked,
      });
      if (!usedByWeek.has(cls.week)) usedByWeek.set(cls.week, new Set());
      usedByWeek.get(cls.week).add(personName);
      bump(assignmentCounts, personName, 1);
      bump(roleCounts, personName + '|' + role, 1);
    }

    function candidateSortKey(person, cls) {
      const campusOrder = person.campus_priority_order || [];
      const personCampusRank = campusOrder.includes(cls.campus) ? campusOrder.indexOf(cls.campus) : 99;
      return [
        -(person.priority || 0),
        person.available_time_slot_count,
        assignmentCounts.get(person.name) || 0,
        personCampusRank,
        -(person._priorityCourseCount || 0),
        person.name || '',
      ];
    }

    function personPreferenceScore(person, cls) {
      const campusOrder = person.campus_priority_order || [];
      const personCampusRank = campusOrder.includes(cls.campus) ? campusOrder.indexOf(cls.campus) : 99;
      const availableSlotCount = Math.min(person.available_time_slot_count ?? 999, 99);
      const assignedCount = Math.min(assignmentCounts.get(person.name) || 0, 99);
      return (person.priority || 0) * 1000
        + Math.max(0, 99 - availableSlotCount) * 5
        + Math.max(0, 99 - assignedCount) * 3
        + Math.max(0, 99 - personCampusRank)
        + (person._priorityCourseCount || 0);
    }

    function slotPriorityKey(slot) {
      return [...classSortKey(slot.cls), slot.role === '講師' ? 0 : 1, slot.slot_index];
    }

    function matchSlotsForWeek(week) {
      let slots = [];
      for (const cls of classesByWeek.get(week) || []) {
        for (let slotIndex = 1; slotIndex <= cls.required_instructor_count; slotIndex++) {
          slots.push({ cls, role: '講師', slot_index: slotIndex });
        }
        for (let slotIndex = 1; slotIndex <= (cls.required_assistant_count || 0); slotIndex++) {
          slots.push({ cls, role: '助教', slot_index: slotIndex });
        }
      }

      const unlockedSlots = [];
      for (const slot of slots) {
        const { cls, role, slot_index } = slot;
        const lockedName = lockedNameForSlot(cls, role, slot_index);
        if (!lockedName) { unlockedSlots.push(slot); continue; }
        const person = peopleByName.get(lockedName);
        if (!person) {
          lockWarnings.push({ target_cell: targetCellFor(cls, role, slot_index), name: lockedName, week, campus: cls.campus, course: cls.course, role, reason: '鎖定老師不在目前師資清單中，已保留原排課並列入警告。' });
          addAssignment(cls, role, slot_index, lockedName, [], true);
          continue;
        }
        if (usedByWeek.get(week)?.has(lockedName)) {
          lockWarnings.push({ target_cell: targetCellFor(cls, role, slot_index), name: lockedName, week, campus: cls.campus, course: cls.course, role, reason: '鎖定老師同週出現多筆排課，已保留但需要人工確認。' });
          addAssignment(cls, role, slot_index, lockedName, [], true);
          continue;
        }
        if (!eligible(person, cls, role)) {
          lockWarnings.push({ target_cell: targetCellFor(cls, role, slot_index), name: lockedName, week, campus: cls.campus, course: cls.course, role, reason: '鎖定老師已不符合新版條件，仍保留原排課；若要重排請手動清空該格再重新指派。' });
        }
        addAssignment(cls, role, slot_index, lockedName, [], true);
      }
      slots = unlockedSlots;

      function eligibleCount(slot) {
        let count = 0;
        for (const person of people) {
          if (!usedByWeek.get(week)?.has(person.name) && eligible(person, slot.cls, slot.role)) count++;
        }
        return count;
      }

      slots.sort((a, b) => U.compareKeys(
        [...classSortKey(a.cls), eligibleCount(a), a.role === '講師' ? 0 : 1, a.slot_index],
        [...classSortKey(b.cls), eligibleCount(b), b.role === '講師' ? 0 : 1, b.slot_index],
      ));

      function buildCandidates(currentSlots) {
        const result = new Map();
        currentSlots.forEach((slot, slotId) => {
          const cls = slot.cls;
          const excludedName = excludedNameForSlot(cls, slot.role, slot.slot_index);
          const slotCandidates = people.filter(person =>
            !usedByWeek.get(week)?.has(person.name) && eligible(person, cls, slot.role) && person.name !== excludedName
          );
          slotCandidates.sort((a, b) => U.compareKeys(candidateSortKey(a, cls), candidateSortKey(b, cls)));
          result.set(slotId, slotCandidates.map(p => p.name));
        });
        return result;
      }

      function protectUniqueCandidateSlots(currentSlots) {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const currentCandidates = buildCandidates(currentSlots);
          const uniqueSlotsByPerson = new Map();
          currentCandidates.forEach((names, slotId) => {
            if (names.length === 1) {
              if (!uniqueSlotsByPerson.has(names[0])) uniqueSlotsByPerson.set(names[0], []);
              uniqueSlotsByPerson.get(names[0]).push(slotId);
            }
          });
          if (uniqueSlotsByPerson.size === 0) return currentSlots;

          const selectedSlotIds = new Set();
          for (const [, slotIds] of uniqueSlotsByPerson) {
            let best = slotIds[0];
            for (const sid of slotIds) {
              if (U.compareKeys(slotPriorityKey(currentSlots[sid]), slotPriorityKey(currentSlots[best])) < 0) best = sid;
            }
            selectedSlotIds.add(best);
          }

          const nextSlots = [];
          currentSlots.forEach((slot, slotId) => {
            if (!selectedSlotIds.has(slotId)) { nextSlots.push(slot); return; }
            const cls = slot.cls;
            const candidateNames = currentCandidates.get(slotId);
            if (usedByWeek.get(week)?.has(candidateNames[0])) return; // 比照原始程式：這格連同「未排課」一起消失
            addAssignment(cls, slot.role, slot.slot_index, candidateNames[0], candidateNames, false);
          });
          currentSlots = nextSlots;
        }
      }

      slots = protectUniqueCandidateSlots(slots);
      const candidates = buildCandidates(slots);
      candidates.forEach((names, slotId) => {
        candidates.set(slotId, names.filter(name => !usedByWeek.get(week)?.has(name)));
      });

      if (slots.length === 0) return;

      const peopleNames = people.filter(p => p.scheduling_candidate && !usedByWeek.get(week)?.has(p.name)).map(p => p.name);

      const slotMasksByPerson = new Map(peopleNames.map(n => [n, 0n]));
      candidates.forEach((names, slotId) => {
        const bit = 1n << BigInt(slotId);
        for (const name of names) {
          if (slotMasksByPerson.has(name)) slotMasksByPerson.set(name, slotMasksByPerson.get(name) | bit);
        }
      });

      const slotScores = slots.map(slot => {
        const cls = slot.cls;
        let score = (cls.expected_students || 0) * 10000;
        score += slot.role === '講師' ? 500 : 0;
        score += priorityNorm.has(U.normalizeCourse(cls.course)) ? 100 : 0;
        score += Math.max(0, 20 - campusRank(cls.campus));
        score += Math.max(0, 5 - slot.slot_index);
        return score;
      });

      let dp = new Map();
      dp.set(0n, { score: 0, pairs: [] });
      for (const personName of peopleNames) {
        const current = new Map(dp);
        let availableMask = slotMasksByPerson.get(personName) || 0n;
        while (availableMask !== 0n) {
          const bit = availableMask & (-availableMask);
          const slotId = bitPosition(bit);
          availableMask -= bit;
          for (const [mask, val] of dp) {
            if (mask & bit) continue;
            const newMask = mask | bit;
            const cls = slots[slotId].cls;
            const person = peopleByName.get(personName);
            const newScore = val.score + slotScores[slotId] * 10000 + personPreferenceScore(person, cls);
            const existing = current.get(newMask);
            if (!existing || newScore > existing.score) {
              current.set(newMask, { score: newScore, pairs: [...val.pairs, [personName, slotId]] });
            }
          }
        }
        dp = current;
      }

      let best = null;
      for (const [mask, val] of dp) {
        const pc = popcount(mask);
        if (!best || val.score > best.score || (val.score === best.score && pc > best.popcount)) {
          best = { mask, score: val.score, popcount: pc, pairs: val.pairs };
        }
      }
      const slotToPerson = new Map();
      for (const [name, slotId] of best.pairs) slotToPerson.set(slotId, name);

      slots.forEach((slot, slotId) => {
        const cls = slot.cls;
        const personName = slotToPerson.get(slotId);
        if (personName) {
          addAssignment(cls, slot.role, slot.slot_index, personName, candidates.get(slotId), false);
        } else {
          unfilled.push({
            class_id: cls.class_id, week: cls.week, campus: cls.campus, course: cls.course,
            expected_students: cls.expected_students, role: slot.role, slot_index: slot.slot_index,
            reason: `找不到符合${slot.role}角色、課程、時段、校區且同週未排課的人；或依預計人數優先時被較高人數需求保留人力。`,
          });
        }
      });
    }

    const weeks = [...classesByWeek.keys()];
    weeks.forEach((week, i) => {
      matchSlotsForWeek(week);
      if (onProgress) onProgress({ doneWeeks: i + 1, totalWeeks: weeks.length, week });
    });

    // ── 統計彙總 ──
    const byWeek = new Map();
    function ensureWeek(w) {
      if (!byWeek.has(w)) byWeek.set(w, { assigned: 0, unfilled: 0, instructors_assigned: 0, assistants_assigned: 0 });
      return byWeek.get(w);
    }
    for (const a of assignments) {
      const bucket = ensureWeek(a.week);
      bucket.assigned++;
      if (a.role === '講師') bucket.instructors_assigned++;
      if (a.role === '助教') bucket.assistants_assigned++;
    }
    for (const item of unfilled) ensureWeek(item.week).unfilled++;

    const byPerson = [...assignmentCounts.entries()]
      .sort((a, b) => (b[1] - a[1]) || U.cmpStr(a[0], b[0]))
      .map(([name, total]) => ({
        name, total_assignments: total,
        instructor_assignments: roleCounts.get(name + '|講師') || 0,
        assistant_assignments: roleCounts.get(name + '|助教') || 0,
      }));

    function counterOf(arr, keyFn) {
      const c = {};
      for (const item of arr) { const k = keyFn(item); c[k] = (c[k] || 0) + 1; }
      return c;
    }

    const sortedAssignments = [...assignments].sort((a, b) => U.compareKeys(
      [a.week, a.campus, a.course, a.role, a.slot_index], [b.week, b.campus, b.course, b.role, b.slot_index]));
    const sortedUnfilled = [...unfilled].sort((a, b) => U.compareKeys(
      [a.week, a.campus, a.course, a.role, a.slot_index], [b.week, b.campus, b.course, b.role, b.slot_index]));

    return {
      generated_at: new Date().toISOString(),
      method: '每週講師與助教槽位一起做加權配對；預計人數權重最高，優先滿足高人數課程。',
      assumptions: [
        '同一人同一週只能被安排一次。',
        '講師與助教都必須符合角色、課程、時段、校區。',
        'Minecraft(小) 與 Minecraft(大) 視為 Minecraft。',
        '需求端課程先依預計人數由多到少排序，講師與助教槽位一起競爭同週人力，優先滿足高人數課程。',
        '預計人數小於等於設定門檻的課程不產生講師/助教需求，也不進入唯一候選人保護。',
        '候選人數為 1 的槽位會先保護；若同一人同週是多個唯一候選槽位，依預計人數、優先課程、校區、角色決定保護哪一格。',
        '候選人皆符合角色、課程、時段、校區時，Priority 數值高者優先，且高於可授課時段數量與已排課次數。',
        '手動指定的鎖定排課（補排缺額時當場鎖定目前畫面上已排好的格子）會保留，不會被自動更動。',
      ],
      summary: {
        required_instructor_slots: classes.reduce((s, c) => s + c.required_instructor_count, 0),
        required_assistant_slots: classes.reduce((s, c) => s + (c.required_assistant_count || 0), 0),
        total_required_slots: classes.reduce((s, c) => s + c.required_instructor_count + (c.required_assistant_count || 0), 0),
        assigned_slots: assignments.length,
        unfilled_slots: unfilled.length,
        assigned_instructor_slots: assignments.filter(a => a.role === '講師').length,
        assigned_assistant_slots: assignments.filter(a => a.role === '助教').length,
        unfilled_instructor_slots: unfilled.filter(a => a.role === '講師').length,
        unfilled_assistant_slots: unfilled.filter(a => a.role === '助教').length,
        by_week: Object.fromEntries(byWeek),
        by_person: byPerson,
        unfilled_by_course: counterOf(unfilled, u => u.course),
        unfilled_by_campus: counterOf(unfilled, u => u.campus),
        locked_assignments: assignments.filter(a => a.locked).length,
        lock_warnings: lockWarnings.length,
      },
      lock_warnings: lockWarnings,
      assignments: sortedAssignments,
      unfilled: sortedUnfilled,
      unfilled_list: sortedUnfilled.map(item => ({
        week: item.week, campus: item.campus, course: item.course, expected_students: item.expected_students,
        missing_role: item.role, slot_index: item.slot_index, reason: item.reason,
      })),
    };
  }

  // 在瀏覽器主執行緒裡呼叫這支：透過 Web Worker 執行 assignSchedule()，回傳 Promise。
  // ⚠ 只能在主執行緒（不是 Worker 內）呼叫，因為它會 new Worker(...)。
  function runInWorker({ staffReport, requirementReport, campusPriority, priorityCourses, lockedCells = {}, onProgress }) {
    return new Promise((resolve, reject) => {
      const worker = new Worker('js/scheduler.worker.js');
      worker.onmessage = (e) => {
        const msg = e.data;
        if (msg.type === 'progress') { if (onProgress) onProgress(msg); }
        else if (msg.type === 'done') { worker.terminate(); resolve(msg.assignmentReport); }
        else if (msg.type === 'error') { worker.terminate(); reject(new Error(msg.message)); }
      };
      worker.onerror = (err) => { worker.terminate(); reject(err); };
      worker.postMessage({ staffReport, requirementReport, campusPriority, priorityCourses, lockedCells });
    });
  }

  return { assignSchedule, runInWorker };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = scheduler;
