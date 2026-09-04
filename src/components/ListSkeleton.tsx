import React from 'react';

interface ListSkeletonProps {
  /** 要畫幾張佔位卡片。抓一個「通常會有幾筆」的數字就好，不用精準。 */
  count?: number;
  /** 單欄（代班看板）或雙欄（我的排班）。 */
  columns?: 1 | 2;
}

/**
 * 資料還在路上時的佔位卡片。
 *
 * 這不是為了好看才加的。在這之前，這些清單在資料回來以前會直接顯示空狀態——
 * 「目前尚無此狀態的班次紀錄」、「目前沒有待接手的代班請求」——那些句子不是
 * 「載入中」，是**很有自信地講了一句假話**：一個明明排了三個班的志工，會被
 * 告知他沒有班，還被建議去報名。網路慢的時候那句話會在畫面上停留一兩秒。
 *
 * 空狀態和載入中看起來一模一樣，是因為程式裡它們本來就是同一個條件
 * （`list.length === 0`）。骨架屏真正的作用是把這兩件事分開：有資料、沒資料、
 * 還不知道，是三種狀態，不是兩種。
 *
 * 用 CSS 的 animate-pulse，沒有圖檔也沒有額外的套件——志工是在園區用手機、
 * 訊號不穩的情況下開這個頁面，載入指示自己變成要等的東西就本末倒置了。
 */
export const ListSkeleton: React.FC<ListSkeletonProps> = ({ count = 2, columns = 2 }) => (
  <div
    className={`grid gap-6 ${columns === 2 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'}`}
    aria-busy="true"
    aria-live="polite"
    aria-label="資料載入中"
  >
    {Array.from({ length: count }).map((_, i) => (
      <div
        key={i}
        className="bg-white rounded-[32px] border border-[#716053]/30 p-6 space-y-4 animate-pulse"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="h-5 w-24 rounded-full bg-[#F5E6D0]" />
          <div className="h-5 w-16 rounded-full bg-[#FAF6EE]" />
        </div>

        <div className="h-6 w-3/4 rounded-lg bg-[#F5E6D0]" />

        <div className="space-y-2">
          <div className="h-3.5 w-full rounded bg-[#FAF6EE]" />
          <div className="h-3.5 w-5/6 rounded bg-[#FAF6EE]" />
          <div className="h-3.5 w-2/3 rounded bg-[#FAF6EE]" />
        </div>

        <div className="pt-3 border-t border-[#716053]/10">
          <div className="h-10 w-full rounded-full bg-[#FAF6EE]" />
        </div>
      </div>
    ))}
  </div>
);
