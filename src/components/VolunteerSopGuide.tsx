import React, { useState, useEffect } from 'react';
import { BookOpen, ShieldAlert, Phone, FileText, Sparkles, MessageCircleQuestion, Loader2, CheckCircle2 } from 'lucide-react';
import { SopContent } from '../types';

interface VolunteerSopGuideProps {
  onOpenRulebookModal: () => void;
}

const COLOR_THEME_CLASSES: Record<string, { badgeBg: string; badgeText: string; iconColor: string }> = {
  emerald: { badgeBg: 'bg-emerald-100', badgeText: 'text-emerald-800', iconColor: 'text-emerald-600' },
  rose: { badgeBg: 'bg-rose-100', badgeText: 'text-rose-800', iconColor: 'text-rose-600' },
  amber: { badgeBg: 'bg-amber-100', badgeText: 'text-amber-800', iconColor: 'text-amber-600' },
  sky: { badgeBg: 'bg-sky-100', badgeText: 'text-sky-800', iconColor: 'text-sky-600' },
  purple: { badgeBg: 'bg-purple-100', badgeText: 'text-purple-800', iconColor: 'text-purple-600' }
};

export const VolunteerSopGuide: React.FC<VolunteerSopGuideProps> = ({
  onOpenRulebookModal
}) => {
  const [ragQuestion, setRagQuestion] = useState('');
  const [ragAnswer, setRagAnswer] = useState<{ answer: string; sources: string[]; isFallback?: boolean } | null>(null);
  const [ragLoading, setRagLoading] = useState(false);

  // Content now comes from the admin-editable SOP manager (see AdminSopManager.tsx)
  // instead of being hardcoded here -- this page just renders whatever the admin
  // last saved, in the exact same layout as before.
  const [content, setContent] = useState<SopContent | null>(null);

  useEffect(() => {
    fetch('/api/sop-content')
      .then(res => res.json())
      .then(data => {
        if (data.success && data.content) setContent(data.content);
      })
      .catch(() => { /* keep showing the loading state if the fetch fails */ });
  }, []);

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

  if (!content) {
    return (
      <div className="py-24 flex items-center justify-center text-slate-400 text-sm gap-2">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span>載入手冊內容中...</span>
      </div>
    );
  }

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
            {content.bannerTitle}
          </h2>
          <p className="text-[#E6E2D3] text-xs sm:text-sm leading-relaxed">
            {content.bannerSubtitle}
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
        {content.sections.map(section => {
          const theme = COLOR_THEME_CLASSES[section.colorTheme] || COLOR_THEME_CLASSES.emerald;
          return (
            <div key={section.id} className="bg-white rounded-[28px] p-6 border border-[#5A5A40]/15 shadow-xs space-y-4">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-2xl ${theme.badgeBg} ${theme.badgeText} flex items-center justify-center font-bold text-lg`}>
                  {section.icon}
                </div>
                <div>
                  <h3 className="font-bold font-serif text-slate-900 text-base">
                    {section.title}
                  </h3>
                  <p className="text-[11px] text-slate-500">{section.subtitle}</p>
                </div>
              </div>

              <ul className="space-y-2.5 text-xs text-slate-600">
                {section.items.map((item, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <CheckCircle2 className={`w-4 h-4 ${theme.iconColor} mt-0.5 shrink-0`} />
                    <span><strong>{item.label}</strong>：{item.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      {/* Emergency Protocol Bar */}
      <div className="bg-rose-50 border border-rose-200 rounded-[28px] p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-rose-600 text-white flex items-center justify-center shrink-0">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div>
            <h4 className="font-bold text-rose-950 text-sm">
              {content.emergencyTitle}
            </h4>
            <p className="text-xs text-rose-800 mt-0.5">
              {content.emergencyText}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs font-bold text-rose-900 bg-white p-3 rounded-2xl border border-rose-200 shrink-0">
          <Phone className="w-4 h-4 text-rose-600" />
          <span>園區值班社工專線：{content.emergencyPhone}</span>
        </div>
      </div>

    </div>
  );
};
