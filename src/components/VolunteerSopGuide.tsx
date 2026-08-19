import React, { useState } from 'react';
import { BookOpen, ShieldAlert, Heart, CheckCircle2, AlertTriangle, Phone, FileText, Sparkles, Download, ArrowRight, ShieldCheck, Dog, Cat, Syringe, MessageCircleQuestion, Loader2 } from 'lucide-react';

interface VolunteerSopGuideProps {
  onOpenRulebookModal: () => void;
}

export const VolunteerSopGuide: React.FC<VolunteerSopGuideProps> = ({
  onOpenRulebookModal
}) => {
  const [ragQuestion, setRagQuestion] = useState('');
  const [ragAnswer, setRagAnswer] = useState<{ answer: string; sources: string[]; isFallback?: boolean } | null>(null);
  const [ragLoading, setRagLoading] = useState(false);

  const handleAskRulebook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ragQuestion.trim() || ragLoading) return;
    setRagLoading(true);
    setRagAnswer(null);
    try {
      const res = await fetch('/api/ai/rag-ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: ragQuestion })
      });
      const data = await res.json();
      setRagAnswer({ answer: data.answer, sources: data.sources || [], isFallback: data.isFallback });
    } catch (err) {
      console.warn('Rulebook RAG ask failed', err);
      setRagAnswer({ answer: '暫時連不上 AI 服務，請直接聯繫值班社工，或稍後再試一次。', sources: [] });
    } finally {
      setRagLoading(false);
    }
  };

  return (
    <div className="space-y-8 py-6 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto font-sans">
      
      {/* Header Banner */}
      <div className="bg-[#5A5A40] rounded-[32px] p-8 sm:p-10 text-white shadow-md flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-3 max-w-2xl">
          <div className="inline-flex items-center gap-2 bg-white/15 backdrop-blur-xs px-3.5 py-1 rounded-full text-xs font-bold text-[#E6E2D3]">
            <BookOpen className="w-4 h-4 text-[#E6E2D3]" />
            <span>園區標準作業守則 &bull; 志工安全指引</span>
          </div>
          <h2 className="text-3xl font-serif italic text-white font-bold leading-tight">
            志工服務安全規範與毛孩照護 SOP 🐾
          </h2>
          <p className="text-[#E6E2D3] text-xs sm:text-sm leading-relaxed">
            服務毛孩的第一原則是「安全第一」。請在每次出勤前複習相關場域規範，遇到特殊狀況立即通報值日社工或駐院獸醫。
          </p>
        </div>

        <button
          onClick={onOpenRulebookModal}
          className="bg-amber-400 hover:bg-amber-500 text-amber-950 font-extrabold px-6 py-3 rounded-full text-xs shadow-md transition flex items-center gap-2 shrink-0 cursor-pointer transform hover:scale-105"
        >
          <FileText className="w-4 h-4" />
          <span>開啟完整手冊 &bull; PDF 下載</span>
        </button>
      </div>

      {/* Rulebook AI Q&A (RAG over the rulebook/SOP content above) */}
      <div className="bg-white rounded-[28px] p-6 border border-[#5A5A40]/15 shadow-xs space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-[#E6E2D3] text-[#5A5A40] flex items-center justify-center">
            <MessageCircleQuestion className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold font-serif text-slate-900 text-base">問手冊 AI 小幫手</h3>
            <p className="text-[11px] text-slate-500">直接用你的話問規則手冊，AI 只會根據手冊內容回答，查不到會誠實說</p>
          </div>
        </div>

        <form onSubmit={handleAskRulebook} className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={ragQuestion}
            onChange={e => setRagQuestion(e.target.value)}
            placeholder="例如：貓咪飛機耳的時候該怎麼辦？"
            className="flex-1 p-3 bg-[#f5f5f0] border border-[#5A5A40]/15 rounded-2xl focus:ring-2 focus:ring-[#5A5A40] focus:outline-none text-xs"
          />
          <button
            type="submit"
            disabled={!ragQuestion.trim() || ragLoading}
            className="px-5 py-3 bg-[#5A5A40] hover:bg-[#484833] text-white rounded-2xl text-xs font-bold flex items-center justify-center gap-1.5 disabled:opacity-40 cursor-pointer shrink-0"
          >
            {ragLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4 text-amber-300" />}
            <span>{ragLoading ? '查詢中...' : '問問看'}</span>
          </button>
        </form>

        {ragAnswer && (
          <div className="bg-[#f5f5f0] p-4 rounded-2xl text-xs text-slate-700 leading-relaxed space-y-2">
            <p className="whitespace-pre-line">{ragAnswer.answer}</p>
            {ragAnswer.sources.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                <span className="text-[10px] text-slate-400">參考段落：</span>
                {ragAnswer.sources.map(s => (
                  <span key={s} className="text-[10px] bg-white border border-[#5A5A40]/15 text-[#5A5A40] px-2 py-0.5 rounded-full">{s}</span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Safety SOP Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        
        {/* Card 1: 犬區放風 */}
        <div className="bg-white rounded-[28px] p-6 border border-[#5A5A40]/15 shadow-xs space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold text-lg">
              🐕
            </div>
            <div>
              <h3 className="font-bold font-serif text-slate-900 text-base">
                大狗運動場 &amp; 放風散步 SOP
              </h3>
              <p className="text-[11px] text-slate-500">B區大型犬戶外放電指導</p>
            </div>
          </div>

          <ul className="space-y-2.5 text-xs text-slate-600">
            <li className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
              <span><strong>雙扣牽繩規範</strong>：胸背帶與項圈必須使用雙頭安全扣，出舍前確認鎖緊。</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
              <span><strong>防爆衝距離</strong>：放風時兩犬距離保持至少 3 公尺，嚴禁讓未社會化犬隻正面嗅聞接觸。</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
              <span><strong>高溫防燙爪</strong>：夏季地面超過 35°C 時縮短柏油路行走，改至遮蔭草坪。</span>
            </li>
          </ul>
        </div>

        {/* Card 2: 貓舍清消 */}
        <div className="bg-white rounded-[28px] p-6 border border-[#5A5A40]/15 shadow-xs space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-rose-100 text-rose-800 flex items-center justify-center font-bold text-lg">
              🐱
            </div>
            <div>
              <h3 className="font-bold font-serif text-slate-900 text-base">
                貓舍區清消與陪伴 SOP
              </h3>
              <p className="text-[11px] text-slate-500">A棟親人貓房與隔離舍規範</p>
            </div>
          </div>

          <ul className="space-y-2.5 text-xs text-slate-600">
            <li className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-rose-600 mt-0.5 shrink-0" />
              <span><strong>進出雙道門</strong>：進入貓舍必須「關一扇才能開下一扇」，嚴防貓咪奪門暴衝。</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-rose-600 mt-0.5 shrink-0" />
              <span><strong>分區清消不混用</strong>：隔離房抹布與拖把不得跨房使用，每次接觸後使用次氯酸消毒手部。</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-rose-600 mt-0.5 shrink-0" />
              <span><strong>安撫觀察情緒</strong>：若貓咪飛機耳或低吼，請暫停互動並通知資深隊長。</span>
            </li>
          </ul>
        </div>

        {/* Card 3: 幼犬育幼 */}
        <div className="bg-white rounded-[28px] p-6 border border-[#5A5A40]/15 shadow-xs space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-100 text-amber-800 flex items-center justify-center font-bold text-lg">
              🍼
            </div>
            <div>
              <h3 className="font-bold font-serif text-slate-900 text-base">
                幼犬育幼與保暖 SOP
              </h3>
              <p className="text-[11px] text-slate-500">C棟幼幼犬照護特別規範</p>
            </div>
          </div>

          <ul className="space-y-2.5 text-xs text-slate-600">
            <li className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
              <span><strong>泡奶溫度測試</strong>：代母乳泡製以 38°C 微溫為準，手背測試不燙方可餵食。</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
              <span><strong>定時排便刺激</strong>：餵食後使用微濕溫棉花輕柔刺激肛門與尿道排泄。</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
              <span><strong>保暖燈監測</strong>：確認保暖燈高度維持 45 公分，避免幼犬過熱或受寒。</span>
            </li>
          </ul>
        </div>

      </div>

      {/* Emergency Protocol Bar */}
      <div className="bg-rose-50 border border-rose-200 rounded-[28px] p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-rose-600 text-white flex items-center justify-center shrink-0">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div>
            <h4 className="font-bold text-rose-950 text-sm">
              緊急事件處置與受傷第一道防線
            </h4>
            <p className="text-xs text-rose-800 mt-0.5">
              若不幸遭犬貓咬傷抓傷，請立即使用大量生理食鹽水沖洗 15 分鐘，並立即告知督導安排就醫破傷風評估。
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs font-bold text-rose-900 bg-white p-3 rounded-2xl border border-rose-200 shrink-0">
          <Phone className="w-4 h-4 text-rose-600" />
          <span>園區值班社工專線：(02) 2211-8899 #108</span>
        </div>
      </div>

    </div>
  );
};
