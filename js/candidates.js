// ════════════════════════════════════════
// candidates.js — 手動換人候選人清單
// 對應 app.py 的 api_candidates()，這是唯一一段完全不在 schedule_generator.py 裡的邏輯，
// 完整規格見專案規劃文件「六、」。
//
// ⚠ 排序規則跟 scheduler.js 內 assign_schedule() 用的 candidate_sort_key 不完全一樣：
//   這裡沒有「是否教優先課程」這項排序依據，故意不加。
// ════════════════════════════════════════

const candidates = (function () {
  const U = (typeof scheduleUtils !== 'undefined') ? scheduleUtils : require('./scheduleUtils.js');

  // 對應 assign_schedule() 內的 eligible()
  function eligible(person, week, campus, course, role) {
    if (!person.scheduling_candidate) return false;
    if (!(person.eligible_roles || []).includes(role)) return false;
    if (!(person.available_time_slots || []).includes(week)) return false;
    if (!(person.available_campuses || []).includes(campus)) return false;
    const courseSet = new Set((person.teachable_courses || []).map(U.normalizeCourse));
    return courseSet.has(U.normalizeCourse(course));
  }

  // 對應 app.py api_candidates() 裡的 sort_key：
  // (-priority, 可授課時段數, 全局已排課次數, 校區偏好順序, 姓名)
  function sortKey(person, campus, assignmentCounts) {
    const campusOrder = person.campus_priority_order || [];
    const campusRank = campusOrder.includes(campus) ? campusOrder.indexOf(campus) : 99;
    return [
      -(person.priority || 0),
      person.available_time_slot_count,
      assignmentCounts[person.name] || 0,
      campusRank,
      person.name || '',
    ];
  }

  // 純同步函式，不需要 fetch，也不需要 loading 畫面
  function getCandidates({ staff, week, campus, course, role, used_names = [], assignment_counts = {} }) {
    const usedSet = new Set(used_names);
    const eligiblePeople = (staff.people || []).filter(p => eligible(p, week, campus, course, role));

    const cand = [];
    const conflict = [];
    for (const p of eligiblePeople) {
      (usedSet.has(p.name) ? conflict : cand).push(p);
    }

    const cmp = (a, b) => U.compareKeys(
      sortKey(a, campus, assignment_counts),
      sortKey(b, campus, assignment_counts),
    );
    cand.sort(cmp);
    conflict.sort(cmp);

    const toOut = p => ({
      name: p.name,
      priority: p.priority || 0,
      assignment_count: assignment_counts[p.name] || 0,
    });

    return {
      candidates: cand.map(toOut),
      conflict_candidates: conflict.map(toOut),
    };
  }

  return { getCandidates, eligible };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = candidates;
