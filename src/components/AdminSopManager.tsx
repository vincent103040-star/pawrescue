import React, { useState, useEffect, useRef } from 'react';
import { BookOpen, Save, Plus, Trash2, FileText, Video, Upload, Loader2, ShieldAlert, CalendarClock, Download } from 'lucide-react';
import { SopContent, SopSection, SopDocument, SopVideo, ShiftTemplate } from '../types';
import { ZONE_CONFIGS } from '../data/mockData';
import { SopDocumentReader } from './SopDocumentReader';
import { authFetch } from '../utils/session';

interface AdminSopManagerProps {
  onSendLineToast: (msg: string) => void;
}

const COLOR_THEME_OPTIONS: { value: SopSection['colorTheme']; label: string }[] = [
  { value: 'emerald', label: '綠色' },
  { value: 'rose', label: '粉紅' },
  { value: 'amber', label: '琥珀' },
  { value: 'sky', label: '天藍' },
  { value: 'purple', label: '紫色' }
];

const COLOR_PREVIEW: Record<string, string> = {
  emerald: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  rose: 'bg-rose-100 text-rose-800 border-rose-300',
  amber: 'bg-amber-100 text-amber-800 border-amber-300',
  sky: 'bg-sky-100 text-sky-800 border-sky-300',
  purple: 'bg-purple-100 text-purple-800 border-purple-300'
};

// Uploads a file as the raw request body rather than base64 inside JSON.
// Sending the File directly lets the browser stream it, avoids the ~33% base64
// size penalty, and keeps the server from having to buffer the whole thing in
// memory (see the streaming note on /api/admin/sop-documents in server.ts).
// Title/description travel in headers, URL-encoded because HTTP headers can't
// carry raw Chinese characters.
async function uploadFileRaw(
  url: string,
  file: File,
  meta: { title: string; description?: string }
): Promise<any> {
  const headers: Record<string, string> = {
    'Content-Type': file.type || 'application/octet-stream',
    'X-Upload-Title': encodeURIComponent(meta.title)
  };
  if (meta.description) {
    headers['X-Upload-Description'] = encodeURIComponent(meta.description);
  }

  const res = await authFetch(url, { method: 'POST', headers, body: file });

  // An oversized upload can be rejected with a non-JSON response; read as text
  // first so we surface a real message instead of a JSON parse error.
  const raw = await res.text();
  try {
    return JSON.parse(raw);
  } catch {
    return {
      success: false,
      error: res.status === 413
        ? '檔案過大，伺服器拒絕接收'
        : `伺服器回應異常 (HTTP ${res.status})`
    };
  }
}

/** "（88.2 MB）", or "" when the size isn't known (pre-existing uploads). */
function formatFileSize(bytes?: number): string {
  if (bytes == null) return '';
  if (bytes < 1024 * 1024) return `（${Math.max(1, Math.round(bytes / 1024))} KB）`;
  return `（${(bytes / 1048576).toFixed(1)} MB）`;
}

export const AdminSopManager: React.FC<AdminSopManagerProps> = ({ onSendLineToast }) => {
  const [content, setContent] = useState<SopContent | null>(null);
  const [documents, setDocuments] = useState<SopDocument[]>([]);
  const [videos, setVideos] = useState<SopVideo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // The document currently open in the text reader (null = closed).
  const [readingDoc, setReadingDoc] = useState<SopDocument | null>(null);

  // "班次" cards -- auto-synced every time an admin publishes a shift (see
  // App.tsx's handleCreateShift), not authored here. This section is
  // read/delete only; there's no "新增" button since creation happens
  // automatically via the shift-publishing flow.
  const [shiftTemplates, setShiftTemplates] = useState<ShiftTemplate[]>([]);

  const [docTitle, setDocTitle] = useState('');
  const [docFile, setDocFile] = useState<File | null>(null);
  const [isUploadingDoc, setIsUploadingDoc] = useState(false);

  const [videoTitle, setVideoTitle] = useState('');
  const [videoDescription, setVideoDescription] = useState('');
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [isUploadingVideo, setIsUploadingVideo] = useState(false);

  const docFileInputRef = useRef<HTMLInputElement>(null);
  const videoFileInputRef = useRef<HTMLInputElement>(null);

  const loadContent = () => {
    setIsLoading(true);
    fetch('/api/sop-content')
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setContent(data.content);
          setDocuments(data.documents || []);
          setVideos(data.videos || []);
        }
      })
      .catch(() => onSendLineToast('⚠️ 讀取手冊內容失敗，請重新整理頁面再試一次。'))
      .finally(() => setIsLoading(false));
  };

  const loadShiftTemplates = () => {
    fetch('/api/shift-templates')
      .then(res => res.json())
      .then(data => { if (data.success) setShiftTemplates(data.templates || []); })
      .catch(() => { /* best-effort */ });
  };

  useEffect(() => {
    loadContent();
    loadShiftTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDeleteShiftTemplate = async (id: string) => {
    try {
      await authFetch(`/api/admin/shift-templates/${id}`, { method: 'DELETE' });
      setShiftTemplates(prev => prev.filter(t => t.id !== id));
      onSendLineToast('🗑️ 已刪除該班次範本卡片。');
    } catch {
      onSendLineToast('⚠️ 刪除失敗，請稍後再試。');
    }
  };

  const handleSave = async () => {
    if (!content) return;
    setIsSaving(true);
    try {
      const res = await authFetch('/api/admin/sop-content', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(content)
      });
      const data = await res.json();
      if (data.success) {
        setContent(data.content);
        onSendLineToast('✅ 手冊內容已儲存，並已同步更新 AI 問答的向量參考資料！');
      } else {
        onSendLineToast(`⚠️ 儲存失敗：${data.error || '未知錯誤'}`);
      }
    } catch (err: any) {
      onSendLineToast(`⚠️ 儲存失敗：${err.message || '網路連線異常'}`);
    } finally {
      setIsSaving(false);
    }
  };

  const updateSection = (index: number, updates: Partial<SopSection>) => {
    if (!content) return;
    const sections = [...content.sections];
    sections[index] = { ...sections[index], ...updates };
    setContent({ ...content, sections });
  };

  const updateSectionItem = (sectionIndex: number, itemIndex: number, field: 'label' | 'text', value: string) => {
    if (!content) return;
    const sections = [...content.sections];
    const items = [...sections[sectionIndex].items];
    items[itemIndex] = { ...items[itemIndex], [field]: value };
    sections[sectionIndex] = { ...sections[sectionIndex], items };
    setContent({ ...content, sections });
  };

  const addSectionItem = (sectionIndex: number) => {
    if (!content) return;
    const sections = [...content.sections];
    sections[sectionIndex] = { ...sections[sectionIndex], items: [...sections[sectionIndex].items, { label: '新規範', text: '說明內容...' }] };
    setContent({ ...content, sections });
  };

  const removeSectionItem = (sectionIndex: number, itemIndex: number) => {
    if (!content) return;
    const sections = [...content.sections];
    sections[sectionIndex] = { ...sections[sectionIndex], items: sections[sectionIndex].items.filter((_, i) => i !== itemIndex) };
    setContent({ ...content, sections });
  };

  const addSection = () => {
    if (!content) return;
    const newSection: SopSection = {
      id: `sop-custom-${Date.now()}`,
      icon: '📋',
      colorTheme: 'sky',
      title: '新 SOP 項目',
      subtitle: '請填寫說明',
      items: [{ label: '規範一', text: '說明內容...' }]
    };
    setContent({ ...content, sections: [...content.sections, newSection] });
  };

  const removeSection = (index: number) => {
    if (!content) return;
    setContent({ ...content, sections: content.sections.filter((_, i) => i !== index) });
  };

  const handleUploadDoc = async () => {
    if (!docTitle.trim() || !docFile) return;
    setIsUploadingDoc(true);
    try {
      const data = await uploadFileRaw('/api/admin/sop-documents', docFile, { title: docTitle.trim() });
      if (data.success) {
        setDocuments(prev => [data.document, ...prev]);
        setDocTitle('');
        setDocFile(null);
        if (docFileInputRef.current) docFileInputRef.current.value = '';
        onSendLineToast(
          data.note
            ? `✅ 已上傳「${data.document.title}」（${data.note}）`
            : `✅ 已上傳「${data.document.title}」，並索引 ${data.chunksIndexed} 段內容供 AI 問答參考！`
        );
      } else {
        onSendLineToast(`⚠️ 上傳失敗：${data.error || '未知錯誤'}`);
      }
    } catch (err: any) {
      onSendLineToast(`⚠️ 上傳失敗：${err.message || '網路連線異常'}`);
    } finally {
      setIsUploadingDoc(false);
    }
  };

  const handleDeleteDoc = async (id: string) => {
    try {
      await authFetch(`/api/admin/sop-documents/${id}`, { method: 'DELETE' });
      setDocuments(prev => prev.filter(d => d.id !== id));
      onSendLineToast('🗑️ 已刪除該份文件與其 AI 參考資料。');
    } catch {
      onSendLineToast('⚠️ 刪除失敗，請稍後再試。');
    }
  };

  const handleUploadVideo = async () => {
    if (!videoTitle.trim() || !videoFile) return;
    setIsUploadingVideo(true);
    try {
      const data = await uploadFileRaw('/api/admin/sop-videos', videoFile, {
        title: videoTitle.trim(),
        description: videoDescription.trim()
      });
      if (data.success) {
        setVideos(prev => [data.video, ...prev]);
        setVideoTitle('');
        setVideoDescription('');
        setVideoFile(null);
        if (videoFileInputRef.current) videoFileInputRef.current.value = '';
        onSendLineToast(`✅ 已上傳教學影片「${data.video.title}」！`);
      } else {
        onSendLineToast(`⚠️ 上傳失敗：${data.error || '未知錯誤'}`);
      }
    } catch (err: any) {
      onSendLineToast(`⚠️ 上傳失敗：${err.message || '網路連線異常，影片檔案可能過大。'}`);
    } finally {
      setIsUploadingVideo(false);
    }
  };

  const handleDeleteVideo = async (id: string) => {
    try {
      await authFetch(`/api/admin/sop-videos/${id}`, { method: 'DELETE' });
      setVideos(prev => prev.filter(v => v.id !== id));
      onSendLineToast('🗑️ 已刪除該部教學影片。');
    } catch {
      onSendLineToast('⚠️ 刪除失敗，請稍後再試。');
    }
  };

  if (isLoading || !content) {
    return (
      <div className="py-24 flex items-center justify-center text-slate-400 text-sm gap-2">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span>載入手冊內容中...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 py-6 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto font-sans">

      {/* Header */}
      <div className="bg-white p-6 rounded-[28px] border border-[#716053] shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-[#716053] text-white flex items-center justify-center shrink-0 shadow-xs">
            <BookOpen className="w-6 h-6 text-amber-300" />
          </div>
          <div>
            <h2 className="text-xl font-bold font-serif italic text-slate-900">手冊與 SOP 內容管理</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              編輯的內容會即時同步到志工端「園區安全守則與 SOP」頁面，並自動轉換為向量提供 AI 問答（RAG）參考。
            </p>
          </div>
        </div>
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="bg-[#716053] hover:bg-[#5A4A3F] disabled:opacity-50 text-white font-extrabold px-6 py-3 rounded-full text-xs shadow-md transition flex items-center gap-2 cursor-pointer shrink-0"
        >
          {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4 text-amber-300" />}
          <span>{isSaving ? '儲存並產生向量中...' : '儲存並同步至志工端'}</span>
        </button>
      </div>

      {/* Banner Text */}
      <div className="bg-white p-6 rounded-[28px] border border-[#716053] shadow-xs space-y-3">
        <h3 className="font-bold font-serif text-slate-900 text-sm border-b border-[#716053] pb-2">頁面標題橫幅</h3>
        <div>
          <label className="block text-xs font-bold text-[#716053] mb-1">標題</label>
          <input
            type="text"
            value={content.bannerTitle}
            onChange={e => setContent({ ...content, bannerTitle: e.target.value })}
            className="w-full p-3 bg-[#FAF6EE] border border-[#716053] rounded-2xl text-xs font-medium focus:ring-2 focus:ring-[#716053] focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-[#716053] mb-1">副標說明</label>
          <textarea
            value={content.bannerSubtitle}
            onChange={e => setContent({ ...content, bannerSubtitle: e.target.value })}
            rows={2}
            className="w-full p-3 bg-[#FAF6EE] border border-[#716053] rounded-2xl text-xs focus:ring-2 focus:ring-[#716053] focus:outline-none resize-none"
          />
        </div>
      </div>

      {/* SOP Section Cards (editable) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {content.sections.map((section, sIdx) => (
          <div key={section.id} className={`bg-white rounded-[28px] p-6 border-2 ${COLOR_PREVIEW[section.colorTheme] || COLOR_PREVIEW.emerald} shadow-xs space-y-4`}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 flex-1">
                <input
                  type="text"
                  value={section.icon}
                  onChange={e => updateSection(sIdx, { icon: e.target.value })}
                  className="w-12 p-2 bg-[#FAF6EE] border border-[#716053] rounded-xl text-center text-lg"
                  maxLength={4}
                />
                <select
                  value={section.colorTheme}
                  onChange={e => updateSection(sIdx, { colorTheme: e.target.value as SopSection['colorTheme'] })}
                  className="p-2 bg-[#FAF6EE] border border-[#716053] rounded-xl text-[11px] font-bold cursor-pointer"
                >
                  {COLOR_THEME_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <button
                onClick={() => removeSection(sIdx)}
                className="text-rose-500 hover:bg-rose-50 p-2 rounded-xl transition cursor-pointer shrink-0"
                title="刪除此 SOP 項目"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>

            <input
              type="text"
              value={section.title}
              onChange={e => updateSection(sIdx, { title: e.target.value })}
              placeholder="SOP 標題"
              className="w-full p-2.5 bg-[#FAF6EE] border border-[#716053] rounded-xl text-sm font-bold focus:ring-2 focus:ring-[#716053] focus:outline-none"
            />
            <input
              type="text"
              value={section.subtitle}
              onChange={e => updateSection(sIdx, { subtitle: e.target.value })}
              placeholder="副標說明"
              className="w-full p-2.5 bg-[#FAF6EE] border border-[#716053] rounded-xl text-xs focus:ring-2 focus:ring-[#716053] focus:outline-none"
            />

            <div className="space-y-2">
              {section.items.map((item, iIdx) => (
                <div key={iIdx} className="flex items-start gap-1.5 bg-[#FFFDF7] p-2.5 rounded-xl border border-[#716053]">
                  <div className="flex-1 space-y-1.5">
                    <input
                      type="text"
                      value={item.label}
                      onChange={e => updateSectionItem(sIdx, iIdx, 'label', e.target.value)}
                      placeholder="規範名稱"
                      className="w-full p-1.5 bg-white border border-[#716053] rounded-lg text-[11px] font-bold focus:ring-1 focus:ring-[#716053] focus:outline-none"
                    />
                    <textarea
                      value={item.text}
                      onChange={e => updateSectionItem(sIdx, iIdx, 'text', e.target.value)}
                      rows={2}
                      placeholder="規範說明內容"
                      className="w-full p-1.5 bg-white border border-[#716053] rounded-lg text-[11px] focus:ring-1 focus:ring-[#716053] focus:outline-none resize-none"
                    />
                  </div>
                  <button
                    onClick={() => removeSectionItem(sIdx, iIdx)}
                    className="text-rose-400 hover:bg-rose-50 p-1.5 rounded-lg transition cursor-pointer shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              <button
                onClick={() => addSectionItem(sIdx)}
                className="w-full py-2 border border-dashed border-[#716053] text-[#716053] rounded-xl text-[11px] font-bold hover:bg-[#FAF6EE] transition cursor-pointer flex items-center justify-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>新增規範項目</span>
              </button>
            </div>
          </div>
        ))}

        <button
          onClick={addSection}
          className="bg-[#FFFDF7] border-2 border-dashed border-[#716053] rounded-[28px] p-6 text-[#716053] font-bold text-sm hover:bg-[#FAF6EE] transition cursor-pointer flex items-center justify-center gap-2 min-h-[200px]"
        >
          <Plus className="w-5 h-5" />
          <span>新增一組 SOP 卡片</span>
        </button>
      </div>

      {/* Shift Template Cards -- auto-synced from published shifts, read/delete only */}
      <div className="bg-white p-6 rounded-[28px] border border-[#716053] shadow-xs space-y-4">
        <div className="flex items-center gap-2 font-bold font-serif text-slate-900 text-sm border-b border-[#716053] pb-2">
          <CalendarClock className="w-4 h-4 text-[#716053]" />
          <span>班次範本卡片庫</span>
          <span className="text-[10px] font-sans font-normal text-slate-400">
            每次在「職位與班次發布」發布新班次時自動同步建立，供發布表單的「套用過去班次範本」下拉選單使用
          </span>
        </div>

        {shiftTemplates.length === 0 ? (
          <p className="text-xs text-slate-400 py-6 text-center">尚無班次範本，發布過班次後會自動出現在這裡。</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {shiftTemplates.map(t => (
              <div key={t.id} className="bg-[#FFFDF7] p-4 rounded-2xl border border-[#716053] space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[10px] font-extrabold bg-[#F5E6D0] text-[#716053] px-2 py-0.5 rounded-full shrink-0">
                    屬性：班次
                  </span>
                  <button
                    onClick={() => handleDeleteShiftTemplate(t.id)}
                    className="text-rose-400 hover:bg-rose-50 p-1 rounded-lg transition cursor-pointer shrink-0"
                    title="刪除此範本卡片"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <p className="font-bold text-slate-800 text-xs leading-snug">
                  {ZONE_CONFIGS[t.zone]?.icon} {t.title}
                </p>
                <div className="text-[11px] text-slate-500 space-y-0.5">
                  <p>⏰ {t.timeRange}・👥 {t.requiredCount} 位</p>
                  <p className="truncate">📍 {t.locationDetails}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Emergency Block */}
      <div className="bg-white p-6 rounded-[28px] border border-rose-200 shadow-xs space-y-3">
        <h3 className="font-bold font-serif text-rose-900 text-sm border-b border-rose-100 pb-2 flex items-center gap-1.5">
          <ShieldAlert className="w-4 h-4 text-rose-600" />
          <span>緊急事件處置區塊</span>
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-bold text-rose-800 mb-1">標題</label>
            <input
              type="text"
              value={content.emergencyTitle}
              onChange={e => setContent({ ...content, emergencyTitle: e.target.value })}
              className="w-full p-3 bg-rose-50 border border-rose-200 rounded-2xl text-xs font-medium focus:ring-2 focus:ring-rose-400 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-rose-800 mb-1">值班社工專線</label>
            <input
              type="text"
              value={content.emergencyPhone}
              onChange={e => setContent({ ...content, emergencyPhone: e.target.value })}
              className="w-full p-3 bg-rose-50 border border-rose-200 rounded-2xl text-xs font-medium focus:ring-2 focus:ring-rose-400 focus:outline-none"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs font-bold text-rose-800 mb-1">處置說明</label>
          <textarea
            value={content.emergencyText}
            onChange={e => setContent({ ...content, emergencyText: e.target.value })}
            rows={2}
            className="w-full p-3 bg-rose-50 border border-rose-200 rounded-2xl text-xs focus:ring-2 focus:ring-rose-400 focus:outline-none resize-none"
          />
        </div>
      </div>

      {/* PDF Reference Documents */}
      <div className="bg-white p-6 rounded-[28px] border border-[#716053] shadow-xs space-y-4">
        <div className="flex items-center gap-2 font-bold font-serif text-slate-900 text-sm border-b border-[#716053] pb-2">
          <FileText className="w-4 h-4 text-[#716053]" />
          <span>上傳 PDF 說明教學文件</span>
          <span className="text-[10px] font-sans font-normal text-slate-400">會自動擷取文字並轉為向量，供 AI 問答參考</span>
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={docTitle}
            onChange={e => setDocTitle(e.target.value)}
            placeholder="文件標題，例如：新進志工完整訓練手冊 2026"
            className="flex-1 p-3 bg-[#FAF6EE] border border-[#716053] rounded-2xl text-xs focus:ring-2 focus:ring-[#716053] focus:outline-none"
          />
          <input
            ref={docFileInputRef}
            type="file"
            accept="application/pdf"
            onChange={e => setDocFile(e.target.files?.[0] || null)}
            className="flex-1 p-2.5 bg-[#FAF6EE] border border-[#716053] rounded-2xl text-xs file:mr-2 file:px-3 file:py-1.5 file:rounded-full file:border-0 file:bg-[#716053] file:text-white file:text-[11px] file:font-bold file:cursor-pointer"
          />
          <button
            onClick={handleUploadDoc}
            disabled={!docTitle.trim() || !docFile || isUploadingDoc}
            className="bg-[#716053] hover:bg-[#5A4A3F] disabled:opacity-40 text-white font-bold px-5 py-2.5 rounded-2xl text-xs flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
          >
            {isUploadingDoc ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4 text-amber-300" />}
            <span>{isUploadingDoc ? '解析並索引中...' : '上傳'}</span>
          </button>
        </div>

        {documents.length > 0 && (
          <div className="space-y-2">
            {documents.map(doc => (
              <div key={doc.id} className="bg-[#FFFDF7] p-3 rounded-xl border border-[#716053] text-xs space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-[#716053] font-bold truncate">
                    <FileText className="w-4 h-4 shrink-0" />
                    <span className="truncate">{doc.title}</span>
                  </div>
                  <button onClick={() => handleDeleteDoc(doc.id)} className="text-rose-500 hover:bg-rose-50 p-1.5 rounded-lg transition cursor-pointer shrink-0">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                {/* Reading beats downloading: the scans are huge, the words in
                    them are tiny. The download stays available but is labelled
                    with its real weight so nobody taps it on mobile data. */}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => setReadingDoc(doc)}
                    className="bg-[#716053] hover:bg-[#5A4A3F] text-white font-bold px-3 py-1.5 rounded-xl text-[11px] flex items-center gap-1.5 cursor-pointer"
                  >
                    <BookOpen className="w-3.5 h-3.5 text-amber-300" />
                    <span>線上閱讀</span>
                  </button>
                  <a
                    href={doc.fileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-slate-600 hover:text-[#716053] font-bold px-3 py-1.5 rounded-xl text-[11px] flex items-center gap-1.5 border border-[#716053]"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>下載原始檔{formatFileSize(doc.fileSize)}</span>
                  </a>
                  {doc.fileSize != null && doc.fileSize > 20 * 1024 * 1024 && (
                    <span className="text-[10px] text-amber-600 font-bold">📶 檔案較大，建議用 Wi-Fi 下載</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Teaching Videos */}
      <div className="bg-white p-6 rounded-[28px] border border-[#716053] shadow-xs space-y-4">
        <div className="flex items-center gap-2 font-bold font-serif text-slate-900 text-sm border-b border-[#716053] pb-2">
          <Video className="w-4 h-4 text-[#716053]" />
          <span>上傳教學影片</span>
          <span className="text-[10px] font-sans font-normal text-slate-400">影片檔案請盡量壓縮，避免上傳過大檔案</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input
            type="text"
            value={videoTitle}
            onChange={e => setVideoTitle(e.target.value)}
            placeholder="影片標題"
            className="p-3 bg-[#FAF6EE] border border-[#716053] rounded-2xl text-xs focus:ring-2 focus:ring-[#716053] focus:outline-none"
          />
          <input
            type="text"
            value={videoDescription}
            onChange={e => setVideoDescription(e.target.value)}
            placeholder="簡短說明（選填）"
            className="p-3 bg-[#FAF6EE] border border-[#716053] rounded-2xl text-xs focus:ring-2 focus:ring-[#716053] focus:outline-none"
          />
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            ref={videoFileInputRef}
            type="file"
            accept="video/*"
            onChange={e => setVideoFile(e.target.files?.[0] || null)}
            className="flex-1 p-2.5 bg-[#FAF6EE] border border-[#716053] rounded-2xl text-xs file:mr-2 file:px-3 file:py-1.5 file:rounded-full file:border-0 file:bg-[#716053] file:text-white file:text-[11px] file:font-bold file:cursor-pointer"
          />
          <button
            onClick={handleUploadVideo}
            disabled={!videoTitle.trim() || !videoFile || isUploadingVideo}
            className="bg-[#716053] hover:bg-[#5A4A3F] disabled:opacity-40 text-white font-bold px-5 py-2.5 rounded-2xl text-xs flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
          >
            {isUploadingVideo ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4 text-amber-300" />}
            <span>{isUploadingVideo ? '上傳中...' : '上傳'}</span>
          </button>
        </div>

        {videos.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {videos.map(video => (
              <div key={video.id} className="bg-[#FFFDF7] p-3 rounded-xl border border-[#716053] space-y-2">
                <video src={video.fileUrl} controls className="w-full rounded-lg bg-black max-h-40" />
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-800 truncate">{video.title}</p>
                    {video.description && <p className="text-[10px] text-slate-500 truncate">{video.description}</p>}
                  </div>
                  <button onClick={() => handleDeleteVideo(video.id)} className="text-rose-500 hover:bg-rose-50 p-1.5 rounded-lg transition cursor-pointer shrink-0">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {readingDoc && (
        <SopDocumentReader doc={readingDoc} onClose={() => setReadingDoc(null)} />
      )}
    </div>
  );
};
