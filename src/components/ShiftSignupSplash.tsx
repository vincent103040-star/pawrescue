import React from 'react';
import { PawPrint, Heart } from 'lucide-react';

/**
 * 全螢幕的溫馨過場，只出現在 LINE 官方帳號選單「班次報名」那顆按鈕（帶著
 * ?tab=shifts 開啟）——不是簽到、不是志工須知，也不是一般網址造訪。
 *
 * 這個區分是刻意的：LIFF 在這個 app 裡預設是輕量、不擋畫面的（見
 * utils/liff.ts 的說明），而簽到走的正是 LIFF，是志工每次上班都要做一次的
 * 動作。同樣三秒的溫馨動畫，放在「偶爾瀏覽班次」上是加分，放在「每天打卡」
 * 上就是每天多罰站三秒——跟今天稍早把登入按鈕、重複橫幅拿掉想省的那種摩擦
 * 完全相反，所以刻意只接在報名這個入口。
 *
 * 純 CSS/SVG，不載外部圖片或 GIF：志工是在園區用手機、訊號不穩定的環境下
 * 開這個連結，讓「歡迎畫面」本身變成連線最容易卡住的一段，划不來。
 */
export const ShiftSignupSplash: React.FC = () => (
  <div className="fixed inset-0 z-[999] flex items-center justify-center bg-gradient-to-br from-[#FAF6EE] via-[#F5E6D0] to-[#FBEFD9]">
    <div className="flex flex-col items-center gap-5 px-6 text-center">
      <div className="relative flex items-center justify-center">
        <span className="absolute inline-flex h-24 w-24 rounded-full bg-[#716053]/20 animate-ping" />
        <div className="relative w-20 h-20 rounded-full bg-[#716053] shadow-lg flex items-center justify-center">
          <PawPrint className="w-10 h-10 text-amber-300" />
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-lg font-bold font-serif text-[#716053]">感謝志工熱心參與</p>
        <p className="text-xs text-[#8a7a6c] flex items-center justify-center gap-1">
          <Heart className="w-3.5 h-3.5 text-rose-400 fill-rose-400" />
          <span>正在為您準備班次資訊</span>
        </p>
      </div>
    </div>
  </div>
);
