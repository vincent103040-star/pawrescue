import React, { useState, useEffect } from 'react';
import { BookOpen, ShieldAlert, Phone, FileText, Sparkles, MessageCircleQuestion, Loader2, CheckCircle2, Download, Video } from 'lucide-react';
import { SopContent, SopDocument, SopVideo } from '../types';
import { SopDocumentReader } from './SopDocumentReader';

import { authFetch } from '../utils/session';

/**
 * Labels a download with what it will actually cost to fetch.
 *
 * The shelter's manual is a stack of scans -- the one uploaded so far is 88MB.
 * A volunteer tapping that on mobile data at the shelter gate deserves to know
 * before, not after.
 */
function formatFileSize(bytes?: number): string {
  if (bytes == null) return '';
  if (bytes < 1024 * 1024) return `（${Math.max(1, Math.round(bytes / 1024))} KB）`;
  return `（${(bytes / 1048576).toFixed(1)} MB）`;
}
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

  // The same endpoint has always returned these alongside the content; this
  // page simply threw them away. So a coordinator would upload a training
  // manual or a demonstration video, see it listed on their own screen, and
  // have no idea it never reached a single volunteer.
  const [documents, setDocuments] = useState<SopDocument[]>([]);
  const [videos, setVideos] = useState<SopVideo[]>([]);
  const [readingDoc, setReadingDoc] = useState<SopDocument | null>(null);

  useEffect(() => {
    authFetch('/api/sop-content')
      .then(res => res.json())
      .then(data => {
        if (data.success && data.content) setContent(data.content);
        if (Array.isArray(data.documents)) setDocuments(data.documents);
        if (Array.isArray(data.videos)) setVideos(data.videos);
      })
      .catch(() => { /* keep showing the loading state if the fetch fails */ });
  }, []);

  const handleAskRulebook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ragQuestion.trim() || ragLoading) return;
    setRagLoading(true);
    setRagAnswer(null);
    try {
      const res = await authFetch('/api/ai/rag-ask', {
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
      <div className="bg-[#716053] rounded-[32px] p-8 sm:p-10 text-white shadow-md flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-3 max-w-2xl">
          <div className="inline-flex items-center gap-2 bg-white/15 backdrop-blur-xs px-3.5 py-1 rounded-full text-xs font-bold text-[#F5E6D0]">
            <BookOpen className="w-4 h-4 text-[#F5E6D0]" />
            <span>園區標準作業守則 &bull; 志工安全指引</span>
          </div>
          <h2 className="text-3xl font-serif italic text-white font-bold leading-tight">
            {content.bannerTitle}
          </h2>
          <p className="text-[#F5E6D0] text-xs sm:text-sm leading-relaxed">
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
      <div className="bg-white rounded-[28px] p-6 border border-[#716053] shadow-xs space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-[#F5E6D0] text-[#716053] flex items-center justify-center">
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
            className="flex-1 p-3 bg-[#FAF6EE] border border-[#716053] rounded-2xl focus:ring-2 focus:ring-[#716053] focus:outline-none text-xs"
          />
          <button
            type="submit"
            disabled={!ragQuestion.trim() || ragLoading}
            className="px-5 py-3 bg-[#716053] hover:bg-[#5A4A3F] text-white rounded-2xl text-xs font-bold flex items-center justify-center gap-1.5 disabled:opacity-40 cursor-pointer shrink-0"
          >
            {ragLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4 text-amber-300" />}
            <span>{ragLoading ? '查詢中...' : '問問看'}</span>
          </button>
        </form>

        {ragAnswer && (
          <div className="bg-[#FAF6EE] p-4 rounded-2xl text-xs text-slate-700 leading-relaxed space-y-2">
            <p className="whitespace-pre-line">{ragAnswer.answer}</p>
            {ragAnswer.sources.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                <span className="text-[10px] text-slate-400">參考段落：</span>
                {ragAnswer.sources.map(s => (
                  <span key={s} className="text-[10px] bg-white border border-[#716053] text-[#716053] px-2 py-0.5 rounded-full">{s}</span>
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
            <div key={section.id} className="bg-white rounded-[28px] p-6 border border-[#716053] shadow-xs space-y-4">
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

      {/* Training materials the coordinator uploaded. Rendered only when there
          are some, so the page does not grow an empty shelf. */}
      {documents.length > 0 && (
        <div className="bg-white rounded-[28px] border border-[#716053] p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-[#716053] text-white flex items-center justify-center shrink-0">
              <FileText className="w-5 h-5 text-amber-300" />
            </div>
            <div>
              <h3 className="font-bold font-serif italic text-slate-900 text-base">教育訓練手冊與文件</h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                社工上傳的完整教材。建議先「線上閱讀」——掃描檔很大，但裡面的字不多。
              </p>
            </div>
          </div>

          <div className="space-y-2">
            {documents.map(doc => (
              <div key={doc.id} className="p-4 rounded-2xl border border-slate-200 bg-[#FFFDF7] space-y-2">
                <p className="font-bold text-sm text-slate-900">{doc.title}</p>
                <div className="flex flex-wrap items-center gap-2">
                  {doc.hasText && (
                    <button
                      type="button"
                      onClick={() => setReadingDoc(doc)}
                      className="bg-[#716053] hover:bg-[#5A4A3F] text-white font-bold px-3 py-1.5 rounded-xl text-[11px] flex items-center gap-1.5 cursor-pointer transition"
                    >
                      <BookOpen className="w-3.5 h-3.5 text-amber-300" />
                      <span>線上閱讀</span>
                    </button>
                  )}
                  <a
                    href={doc.fileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-slate-600 hover:text-[#716053] font-bold px-3 py-1.5 rounded-xl text-[11px] flex items-center gap-1.5 border border-[#716053] transition"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>下載原始檔{formatFileSize(doc.fileSize)}</span>
                  </a>
                  {doc.fileSize != null && doc.fileSize > 20 * 1024 * 1024 && (
                    <span className="text-[10px] text-amber-700 font-bold">📶 檔案較大，建議用 Wi-Fi 下載</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {videos.length > 0 && (
        <div className="bg-white rounded-[28px] border border-[#716053] p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-[#716053] text-white flex items-center justify-center shrink-0">
              <Video className="w-5 h-5 text-amber-300" />
            </div>
            <div>
              <h3 className="font-bold font-serif italic text-slate-900 text-base">教學影片</h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                實際操作示範。出勤前看一次，比讀十遍文字有用。
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {videos.map(video => (
              <div key={video.id} className="p-4 rounded-2xl border border-slate-200 bg-[#FFFDF7] space-y-2">
                <video
                  src={video.fileUrl}
                  controls
                  preload="none"
                  className="w-full rounded-lg bg-black max-h-48"
                />
                <p className="font-bold text-sm text-slate-900">{video.title}</p>
                {video.description && (
                  <p className="text-[11px] text-slate-600 leading-relaxed">{video.description}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {readingDoc && (
        <SopDocumentReader doc={readingDoc} onClose={() => setReadingDoc(null)} />
      )}

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
