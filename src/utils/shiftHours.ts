/**
 * 從 "10:00 - 13:00" 這樣的時段字串算出時數。
 *
 * 這個函式原本住在 MonthlyReportModal 裡。它被搬出來，是因為 Dashboard 也要用
 * 它（三處），而只要 Dashboard 還從那個檔案 import 任何東西，整個月報元件——連
 * 同它拉進來的一切——就會被打包進主 bundle，那樣把月報改成 lazy 就完全沒有作用。
 *
 * 那種失效不會有任何錯誤：lazy 設定看起來正確，動態 import 也確實寫了，只是
 * 檔案早就在主 bundle 裡，切不出去。唯一看得出來的方式是比對建置後的大小。
 *
 * 解析不出來時回傳 3.5，維持原本的行為 —— 這個值被用來累計服務時數，回傳 0
 * 會讓一個時段格式沒寫好的班次靜靜地不算時數。
 */
export const calculateShiftDurationHours = (timeRange: string): number => {
  try {
    const parts = timeRange.split('-').map(p => p.trim());
    if (parts.length === 2) {
      const [startH, startM] = parts[0].split(':').map(Number);
      const [endH, endM] = parts[1].split(':').map(Number);
      if (!isNaN(startH) && !isNaN(endH)) {
        const startTotalMinutes = startH * 60 + (startM || 0);
        const endTotalMinutes = endH * 60 + (endM || 0);
        const diffMinutes = endTotalMinutes - startTotalMinutes;
        if (diffMinutes > 0) {
          return Math.round((diffMinutes / 60) * 10) / 10;
        }
      }
    }
  } catch (e) {
    // fallback
  }
  return 3.5;
};
