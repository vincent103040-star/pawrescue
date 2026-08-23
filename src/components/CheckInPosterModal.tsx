import React, { useState, useEffect, useMemo } from 'react';
import { X, Printer, Loader2, AlertTriangle } from 'lucide-react';
import { qrToSvg } from '../utils/qrcode';
import { authFetch } from '../utils/session';

interface CheckInPosterModalProps {
  onClose: () => void;
}

/**
 * A printable check-in poster, for sites that have no screen at the gate.
 *
 * The rotating six-digit code needs something to display it. Paper can't count
 * down, so the poster carries a signed link instead and leans on GPS for the
 * proof of presence -- the server refuses a poster scan that arrives without
 * coordinates, precisely because a photo of a poster travels and a location
 * doesn't.
 */
export const CheckInPosterModal: React.FC<CheckInPosterModalProps> = ({ onClose }) => {
  const [info, setInfo] = useState<{
    path: string; geocoded: boolean; shelterName: string; radiusMeters: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    authFetch('/api/admin/attendance/poster')
      .then(res => res.json())
      .then(data => { data.success ? setInfo(data) : setError(data.error || '讀取失敗'); })
      .catch(() => setError('無法連線到伺服器'));
  }, []);

  const url = info ? `${window.location.origin}${info.path}` : '';

  // Level Q so the code still reads with a coffee ring or a torn corner on it --
  // a poster lives on a wall for months.
  const svg = useMemo(() => (url ? qrToSvg(url, { size: 320, margin: 4, ec: 'Q' }) : ''), [url]);

  return (
    <div className="fixed inset-0 z-50 bg-[#716053]/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 overflow-y-auto print:bg-white print:p-0 print:block">
      <div className="bg-white w-full max-w-lg rounded-[28px] border border-[#716053] shadow-md my-6 overflow-hidden font-sans print:border-0 print:shadow-none print:max-w-none print:my-0 print:rounded-none">

        <div className="p-5 border-b border-[#716053] flex items-start justify-between gap-3 print:hidden">
          <div>
            <h3 className="font-bold font-serif text-slate-900 text-base">🖨️ 列印現場簽到海報</h3>
            <p className="text-[11px] text-slate-500 mt-1">
              適合沒有螢幕的據點：印出來貼在門口，志工用手機掃描即可簽到。
            </p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:bg-slate-100 p-1.5 rounded-lg cursor-pointer shrink-0" aria-label="關閉">
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div className="p-5 text-xs text-rose-700 print:hidden">⚠️ {error}</div>
        )}

        {!info && !error && (
          <div className="p-12 flex items-center justify-center gap-2 text-slate-500 text-xs print:hidden">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>產生 QR Code 中...</span>
          </div>
        )}

        {info && (
          <>
            {/* The poster itself -- this is the part that prints. */}
            <div className="p-8 text-center space-y-5 print:p-16">
              <div>
                <p className="text-3xl font-bold font-serif text-[#716053]">🐾 志工現場簽到</p>
                <p className="text-sm text-slate-600 mt-2">{info.shelterName}</p>
              </div>

              <div
                className="inline-block border-4 border-[#716053] rounded-3xl p-3 bg-white"
                dangerouslySetInnerHTML={{ __html: svg }}
              />

              <div className="text-left max-w-xs mx-auto space-y-2 text-sm text-slate-700">
                <p className="font-bold text-[#716053] text-center pb-1">用手機相機掃描上方 QR Code</p>
                <ol className="list-decimal list-inside space-y-1 leading-relaxed">
                  <li>掃描後會開啟簽到頁面</li>
                  <li>用 Google 或 LINE 帳號登入</li>
                  <li>允許取得位置（必要）</li>
                  <li>選擇今天的班次，完成簽到</li>
                </ol>
                <p className="text-[11px] text-slate-500 pt-2 border-t border-slate-200">
                  📍 需在 {info.shelterName} 方圓 {info.radiusMeters} 公尺內才能簽到。<br />
                  服務結束後請記得回到同一頁面「離場簽退」，時數才會計算。
                </p>
              </div>
            </div>

            <div className="p-5 border-t border-[#716053] bg-[#FAF6EE] space-y-3 print:hidden">
              {!info.geocoded && (
                <div className="bg-amber-50 border border-[#716053] rounded-2xl p-3 text-[11px] text-slate-700 flex gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold">園區地址尚未定位成功</p>
                    <p className="text-slate-500 mt-0.5">
                      海報簽到完全依賴 GPS 比對，請先到「職位與班次發布」頁把地址改成可定位的完整地址，否則志工會一直簽到失敗。
                    </p>
                  </div>
                </div>
              )}

              <div className="bg-white border border-[#716053] rounded-2xl p-3 text-[11px] text-slate-600 leading-relaxed">
                <p className="font-bold text-[#716053] mb-1">關於安全性</p>
                <p>
                  海報上的 QR 是固定的，被拍照就會外流，所以它只用來確認「連結來自本系統」。
                  真正確認志工人在現場的是手機 GPS —— 用海報簽到時，沒有開啟定位就無法完成。
                  若據點有螢幕，建議改用會每 60 秒更換的現場簽到碼，防偽效果更好。
                </p>
              </div>

              <button
                onClick={() => window.print()}
                className="w-full bg-[#716053] hover:bg-[#5A4A3F] text-white font-extrabold px-4 py-3 rounded-2xl flex items-center justify-center gap-2 cursor-pointer"
              >
                <Printer className="w-4 h-4 text-amber-300" />
                <span>列印這張海報</span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
