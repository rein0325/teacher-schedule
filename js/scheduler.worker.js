// ════════════════════════════════════════
// scheduler.worker.js — 在 Web Worker 裡執行 assignSchedule()
// 避免長時間運算（真實資料約 150+ 秒）卡住瀏覽器主執行緒/UI。
// 由 scheduler.js 的 runInWorker() 建立與溝通，不需要放進 index.html 的 <script> 清單。
// ════════════════════════════════════════

importScripts('scheduleUtils.js', 'scheduler.js');

self.onmessage = function (e) {
  const { staffReport, requirementReport, campusPriority, priorityCourses, lockedCells } = e.data;
  try {
    const assignmentReport = scheduler.assignSchedule({
      staffReport,
      requirementReport,
      campusPriority,
      priorityCourses,
      lockedCells,
      onProgress: (p) => self.postMessage({ type: 'progress', ...p }),
    });
    self.postMessage({ type: 'done', assignmentReport });
  } catch (err) {
    self.postMessage({ type: 'error', message: err && err.message ? err.message : String(err) });
  }
};
