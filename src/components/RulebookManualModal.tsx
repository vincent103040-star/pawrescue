import React, { useState } from 'react';
import { 
  BookOpen, 
  Printer, 
  Download, 
  X, 
  ShieldCheck, 
  CheckCircle2, 
  AlertTriangle, 
  Users, 
  Award, 
  Sparkles, 
  Calendar, 
  Building2, 
  QrCode, 
  Heart, 
  PawPrint,
  HelpCircle,
  FileText
} from 'lucide-react';

interface RulebookManualModalProps {
  onClose: () => void;
  onSendLineToast?: (msg: string) => void;
}

export const RulebookManualModal: React.FC<RulebookManualModalProps> = ({
  onClose,
  onSendLineToast
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'rulebook' | 'manual'>('rulebook');

  // Trigger browser print to save/download cleanly formatted PDF
  const handlePrintPdf = () => {
    if (onSendLineToast) {
      onSendLineToast('📄 已準備好 PDF 導出頁面！請在列印對話框中選擇【另存為 PDF】即可下載完整規則書與說明書。');
    }
    setTimeout(() => {
      window.print();
    }, 300);
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#333322]/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 overflow-y-auto animate-in fade-in duration-200 print:p-0 print:bg-white print:static print:overflow-visible">
      
      {/* Container - Styled as elegant booklet card on screen, pure paper on print */}
      <div className="bg-white rounded-[32px] border border-[#716053] shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden print:max-h-none print:shadow-none print:border-none print:rounded-none print:w-full">
        
        {/* Modal Header & Quick Print Actions */}
        <div className="bg-[#716053] text-white p-5 sm:p-6 flex items-center justify-between shrink-0 print:bg-white print:text-slate-900 print:border-b-2 print:border-slate-800 print:p-0 print:pb-4">
          <div className="flex items-center space-x-3">
            <div className="w-12 h-12 rounded-2xl bg-amber-400 text-slate-950 flex items-center justify-center font-bold shadow-sm print:hidden">
              <BookOpen className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-xl sm:text-2xl font-bold font-serif italic tracking-wide text-white print:text-slate-900">
                  🐾 浪浪家園 志工規章守則 &amp; 系統使用說明書
                </h2>
                <span className="bg-[#F5E6D0] text-[#716053] text-[10px] font-extrabold px-2.5 py-0.5 rounded-full print:hidden">
                  官方標準版 2026.V2
                </span>
              </div>
              <p className="text-xs text-white/80 mt-1 print:text-slate-600">
                浪浪家園 PawRescue 流浪動物之家 志工服務規章、安全防護 SOP 與全系統智慧管理操作手冊
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2 print:hidden">
            <button
              onClick={handlePrintPdf}
              className="bg-amber-400 hover:bg-amber-300 text-slate-950 font-extrabold text-xs px-4 py-2.5 rounded-2xl shadow-sm transition flex items-center gap-2 cursor-pointer"
            >
              <Printer className="w-4 h-4 text-slate-950" />
              <span>一鍵列印 / 下載 PDF 守則</span>
            </button>

            <button
              onClick={onClose}
              className="text-white/70 hover:text-white p-2 rounded-xl hover:bg-white/10 transition cursor-pointer"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Tab Switcher (Screen only) */}
        <div className="bg-[#FAF6EE] border-b border-[#716053] px-6 py-2.5 flex items-center justify-between shrink-0 print:hidden">
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setActiveSubTab('rulebook')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                activeSubTab === 'rulebook'
                  ? 'bg-[#716053] text-white shadow-xs'
                  : 'text-slate-600 hover:bg-slate-200'
              }`}
            >
              <ShieldCheck className="w-4 h-4 text-amber-300" />
              <span>第一部分：志工服務規章與安全守則</span>
            </button>

            <button
              onClick={() => setActiveSubTab('manual')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                activeSubTab === 'manual'
                  ? 'bg-[#716053] text-white shadow-xs'
                  : 'text-slate-600 hover:bg-slate-200'
              }`}
            >
              <FileText className="w-4 h-4 text-sky-300" />
              <span>第二部分：全系統操作說明手冊</span>
            </button>
          </div>

          <span className="text-[11px] text-slate-500 font-mono hidden sm:inline">
            📄 可點擊右上角「列印 PDF」直接輸出為紙本教材
          </span>
        </div>

        {/* Modal Body Content (Scrollable on screen, full printable layout) */}
        <div className="p-6 sm:p-8 overflow-y-auto space-y-8 print:overflow-visible print:p-0 print:space-y-6 text-slate-800">
          
          {/* SECTION 1: 志工服務規章與安全守則 */}
          {(activeSubTab === 'rulebook' || true) && (
            <section className={`space-y-6 ${activeSubTab !== 'rulebook' ? 'print:block hidden' : 'block'}`}>
              
              <div className="border-b-2 border-[#716053] pb-2 flex items-center justify-between">
                <h3 className="text-lg font-serif font-bold text-[#716053] flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-amber-600" />
                  <span>第一章：志工服務規章與園區安全守則 (Rulebook &amp; Safety Protocols)</span>
                </h3>
                <span className="text-xs font-mono text-slate-400">Section 1</span>
              </div>

              {/* 1.1 園區安全守則 */}
              <div className="bg-[#FFFDF7] p-5 rounded-2xl border border-[#716053] space-y-3">
                <h4 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-[#716053] text-white flex items-center justify-center text-xs font-mono">1.1</span>
                  <span>園區出入與防護紀律</span>
                </h4>
                <ul className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-slate-700 leading-relaxed pl-2">
                  <li className="bg-white p-3 rounded-xl border border-slate-200 flex items-start gap-2">
                    <span className="text-amber-600 font-bold">•</span>
                    <span><strong>著裝規範：</strong> 服務期間須穿著志工背心，進入狗園請穿長褲與不露趾平底運動鞋，嚴禁穿著拖鞋或高跟鞋。</span>
                  </li>
                  <li className="bg-white p-3 rounded-xl border border-slate-200 flex items-start gap-2">
                    <span className="text-amber-600 font-bold">•</span>
                    <span><strong>門禁與防逃脫：</strong> 貓舍與犬舍均設有雙重隔絕門，進出必須貫徹「關一門、再開一門」原則，嚴防浪浪脫逃。</span>
                  </li>
                  <li className="bg-white p-3 rounded-xl border border-slate-200 flex items-start gap-2">
                    <span className="text-amber-600 font-bold">•</span>
                    <span><strong>大狗放風扣環：</strong> 帶大狗放風須使用「雙重安全扣環」與胸背牽繩，黃色/紅色標籤犬隻須由資深志工陪同。</span>
                  </li>
                  <li className="bg-white p-3 rounded-xl border border-slate-200 flex items-start gap-2">
                    <span className="text-amber-600 font-bold">•</span>
                    <span><strong>餵食與給水：</strong> 嚴禁未經社工或獸醫許可私自餵食非園區指定之零食，每 15 分鐘需為運動場犬隻補充乾淨飲水。</span>
                  </li>
                </ul>
              </div>

              {/* 1.2 志工階級升級與考核規章 */}
              <div className="bg-[#FFFDF7] p-5 rounded-2xl border border-[#716053] space-y-3">
                <h4 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-[#716053] text-white flex items-center justify-center text-xs font-mono">1.2</span>
                  <span>志工成長階級與考核升級制度</span>
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <div className="bg-white p-3.5 rounded-xl border border-slate-200 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <strong className="text-slate-800">🌱 實習志工 (Novice)</strong>
                      <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded-full text-slate-600">入門初階</span>
                    </div>
                    <p className="text-[#716053] text-[11px]">【考核目標】：完成 1 次園區實體培訓 + 完成 10 小時服務（配合資深志工）。</p>
                  </div>

                  <div className="bg-white p-3.5 rounded-xl border border-[#716053] space-y-1.5">
                    <div className="flex items-center justify-between">
                      <strong className="text-[#716053]">⭐ 正式志工 (Regular)</strong>
                      <span className="text-[10px] bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full font-bold">主力幹部</span>
                    </div>
                    <p className="text-[#716053] text-[11px]">【考核目標】：累積 30 小時 + 獨立完成大狗放風與貓房照護 SOP 檢定。</p>
                  </div>

                  <div className="bg-white p-3.5 rounded-xl border border-amber-300 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <strong className="text-amber-800">🎖️ 資深志工 (Senior Leader)</strong>
                      <span className="text-[10px] bg-amber-400 text-slate-950 px-2 py-0.5 rounded-full font-extrabold">核心督導</span>
                    </div>
                    <p className="text-[#716053] text-[11px]">【考核目標】：累積 50 小時 + 通過急救與醫療投藥認證，系統將自動通知管理者審核。</p>
                  </div>
                </div>
              </div>

              {/* 1.3 班次請假與誠信規範 */}
              <div className="bg-[#FFFDF7] p-5 rounded-2xl border border-[#716053] space-y-2 text-xs">
                <h4 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-[#716053] text-white flex items-center justify-center text-xs font-mono">1.3</span>
                  <span>請假、代班與誠信管理規範</span>
                </h4>
                <p className="text-slate-600 leading-relaxed pl-8">
                  若因故無法出席已報名之班次，請務必於<strong>班次開始 24 小時前</strong>於系統或 LINE 志工大群組發起「代班請求」。無故缺席（曠工）達 2 次者，系統將暫停該帳號未來 30 天之搶班權限，以保障浪浪照顧不中斷。
                </p>
              </div>

            </section>
          )}

          {/* SECTION 2: 全系統操作說明手冊 */}
          {(activeSubTab === 'manual' || true) && (
            <section className={`space-y-6 ${activeSubTab !== 'manual' ? 'print:block hidden' : 'block'}`}>
              
              <div className="border-b-2 border-[#716053] pb-2 flex items-center justify-between">
                <h3 className="text-lg font-serif font-bold text-[#716053] flex items-center gap-2">
                  <FileText className="w-5 h-5 text-sky-600" />
                  <span>第二章：系統功能操作使用說明書 (System User Manual)</span>
                </h3>
                <span className="text-xs font-mono text-slate-400">Section 2</span>
              </div>

              {/* 2.1 管理者社工功能 */}
              <div className="space-y-3">
                <h4 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded-lg bg-slate-800 text-white font-mono text-xs">A</span>
                  <span>管理者 / 社工人員 (Manager / Admin Guide)</span>
                </h4>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div className="bg-[#FFFDF7] p-4 rounded-2xl border border-slate-200 space-y-1.5">
                    <div className="flex items-center gap-2 font-bold text-slate-900">
                      <ShieldCheck className="w-4 h-4 text-amber-600" />
                      <span>1. 缺工看板與 AI 智慧一鍵排班</span>
                    </div>
                    <p className="text-slate-600 leading-relaxed">
                      進入「1. 缺工統計看板」，查看大台北 3 大據點（新店總部、陽明山草山狗園、淡水貓島館）缺工狀況。點擊「AI 一鍵補班」，Gemini 3.6 Flash 會自動分析志工技能並直錄最佳人選。
                    </p>
                  </div>

                  <div className="bg-[#FFFDF7] p-4 rounded-2xl border border-slate-200 space-y-1.5">
                    <div className="flex items-center gap-2 font-bold text-slate-900">
                      <Calendar className="w-4 h-4 text-emerald-600" />
                      <span>2. 班次發布與 Google 地圖日曆同步</span>
                    </div>
                    <p className="text-slate-600 leading-relaxed">
                      在「2. 職位與班次發布」建立新班次，系統會自動生成 Google Maps GPS 導航定位，並產出可一鍵加入 Google Calendar 的預約時間檔與 LINE 群組宣傳文案。
                    </p>
                  </div>

                  <div className="bg-[#FFFDF7] p-4 rounded-2xl border border-slate-200 space-y-1.5">
                    <div className="flex items-center gap-2 font-bold text-slate-900">
                      <Users className="w-4 h-4 text-purple-600" />
                      <span>3. 志工人才庫與自動升級通知</span>
                    </div>
                    <p className="text-slate-600 leading-relaxed">
                      於「志工人才庫名冊」掌握全隊志工時數。當志工完成『志工成長軌跡』考核項目並達成門檻，系統將發送卡片通知管理員進行資深級別審核與證書頒發。
                    </p>
                  </div>

                  <div className="bg-[#FFFDF7] p-4 rounded-2xl border border-slate-200 space-y-1.5">
                    <div className="flex items-center gap-2 font-bold text-slate-900">
                      <Sparkles className="w-4 h-4 text-sky-600" />
                      <span>4. 雙週物資人力 AI 預警地圖 &amp; SOP 追蹤</span>
                    </div>
                    <p className="text-slate-600 leading-relaxed">
                      透過「資源需求預警地圖」預測下一週飼料與醫療器材缺口；使用「每日志工勤務看板」讓值班志工勾選完成 SOP，確保浪浪照顧品質。
                    </p>
                  </div>
                </div>
              </div>

              {/* 2.2 志工夥伴功能 */}
              <div className="space-y-3">
                <h4 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded-lg bg-[#716053] text-white font-mono text-xs">B</span>
                  <span>志工夥伴 (Volunteer Guide)</span>
                </h4>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div className="bg-[#FFFDF7] p-4 rounded-2xl border border-slate-200 space-y-1.5">
                    <div className="flex items-center gap-2 font-bold text-slate-900">
                      <PawPrint className="w-4 h-4 text-purple-600" />
                      <span>1. 志工線上搶班門戶</span>
                    </div>
                    <p className="text-slate-600 leading-relaxed">
                      切換至「🐾 志工線上搶班門戶」，選擇意向院區與場域班次，填寫基本資料即可即時預約報名，並收到 LINE 自動確認通知。
                    </p>
                  </div>

                  <div className="bg-[#FFFDF7] p-4 rounded-2xl border border-slate-200 space-y-1.5">
                    <div className="flex items-center gap-2 font-bold text-slate-900">
                      <QrCode className="w-4 h-4 text-emerald-600" />
                      <span>2. 現場 QR Code 簽到與簽退打卡</span>
                    </div>
                    <p className="text-slate-600 leading-relaxed">
                      抵達園區後點擊「志工掃碼簽到」，輸入姓名選擇今日班次進行打卡；服務結束後填寫體驗評分並打卡簽退，時數自動累加。
                    </p>
                  </div>

                  <div className="bg-[#FFFDF7] p-4 rounded-2xl border border-slate-200 space-y-1.5">
                    <div className="flex items-center gap-2 font-bold text-slate-900">
                      <Award className="w-4 h-4 text-amber-600" />
                      <span>3. 志工成長軌跡與數位服務證明</span>
                    </div>
                    <p className="text-slate-600 leading-relaxed">
                      於個人資料頁查看『志工成長軌跡』進度條，逐步打勾解鎖實習/正式/資深志工考核項目；時數符合條件可線上下載列印官方服務證明。
                    </p>
                  </div>

                  <div className="bg-[#FFFDF7] p-4 rounded-2xl border border-slate-200 space-y-1.5">
                    <div className="flex items-center gap-2 font-bold text-slate-900">
                      <CheckCircle2 className="w-4 h-4 text-indigo-600" />
                      <span>4. 勤務看板 SOP 現場執行打勾</span>
                    </div>
                    <p className="text-slate-600 leading-relaxed">
                      在首頁「每日志工勤務看板」查看當日值班 SOP（如給水、出犬檢查、貓房消毒），每完成一項點擊打勾核銷，系統同步紀錄。
                    </p>
                  </div>
                </div>
              </div>

            </section>
          )}

          {/* Footer Signature on print */}
          <div className="pt-6 border-t border-slate-200 text-xs text-slate-500 flex justify-between items-center print:pt-4">
            <span>🐾 浪浪家園 PawRescue 志工服務團隊 敬啟</span>
            <span className="font-mono">版本號: 2026-08-05-V2</span>
          </div>

        </div>

        {/* Modal Footer Controls */}
        <div className="bg-[#FAF6EE] p-4 sm:p-5 border-t border-[#716053] flex items-center justify-between shrink-0 print:hidden">
          <div className="text-xs text-slate-500 flex items-center gap-2">
            <Heart className="w-4 h-4 text-rose-500 fill-rose-500" />
            <span>感謝您為 434 隻浪浪付出關愛與溫暖！</span>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handlePrintPdf}
              className="bg-[#716053] hover:bg-[#5A4A3F] text-white text-xs font-bold px-5 py-2.5 rounded-2xl transition flex items-center gap-2 cursor-pointer shadow-xs"
            >
              <Download className="w-4 h-4 text-amber-300" />
              <span>一鍵下載 / 列印 PDF 守則</span>
            </button>

            <button
              onClick={onClose}
              className="bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold px-4 py-2.5 rounded-2xl border border-slate-300 transition cursor-pointer"
            >
              關閉視窗
            </button>
          </div>
        </div>

      </div>

    </div>
  );
};
