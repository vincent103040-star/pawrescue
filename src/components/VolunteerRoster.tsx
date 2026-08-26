import React, { useState, useEffect } from 'react';
import { VolunteerProfile, PromotionRequest } from '../types';
import { ZONE_CONFIGS } from '../data/mockData';
import { Users, Award, Clock, Search, Shield, Phone, Mail, MessageSquare, Star, Plus, Check, X, Trophy, TrendingUp, Medal, Sparkles, ArrowUpDown, Filter, Download, FileText, ChevronLeft, ChevronRight, BellRing, Edit2, Trash2, Save } from 'lucide-react';
import { CertificateModal } from './CertificateModal';
import { authFetch } from '../utils/session';

import { resolveZone } from '../data/zones';
interface VolunteerRosterProps {
  volunteers: VolunteerProfile[];
  onAddVolunteer?: (vol: VolunteerProfile) => void;
  /** Re-fetches the roster from the backend after an edit or delete. */
  onVolunteersChanged?: () => void;
  /** Bumped by App when the server reports a promotion change on any device,
      so the review queue below refreshes without a page reload. */
  promotionsRevision?: number;
  onSendLineToast?: (msg: string) => void;
}

export const VolunteerRoster: React.FC<VolunteerRosterProps> = ({
  volunteers,
  onVolunteersChanged,
  promotionsRevision = 0,
  onSendLineToast = (_msg: string) => {}
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [tierFilter, setTierFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'hours_desc' | 'hours_asc' | 'shifts_desc' | 'name'>('hours_desc');
  const [selectedCertVolunteer, setSelectedCertVolunteer] = useState<VolunteerProfile | null>(null);

  // Inline editing of a volunteer's roster details. Hours / shift count / tier
  // are deliberately not editable -- they're earned via check-outs and the
  // promotion review flow (see updateVolunteerDetails in db.ts).
  const [editingEmail, setEditingEmail] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({ skills: '', preferredZones: [] as string[], emergencyContact: '' });
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [deletingEmail, setDeletingEmail] = useState<string | null>(null);

  const [statusBusy, setStatusBusy] = useState<string[]>([]);

  /**
   * Suspends or restores a volunteer's booking rights.
   *
   * Restoring is the common case and is why this control exists at all: the
   * suspension rule assumes somebody can ask to be reinstated, so a coordinator
   * needs a way to say yes. The server notifies the volunteer either way.
   */
  const changeAccountStatus = async (
    vol: VolunteerProfile,
    status: 'active' | 'suspended' | 'inactive',
    reason: string
  ) => {
    if (statusBusy.includes(vol.email)) return;
    setStatusBusy(prev => [...prev, vol.email]);
    try {
      const res = await authFetch(`/api/admin/volunteers/${encodeURIComponent(vol.email)}/account-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, reason })
      });
      const data = await res.json();
      if (!data.success) { onSendLineToast?.(`⚠️ ${data.error || '更新失敗'}`); return; }
      onSendLineToast?.(
        status === 'active'
          ? `✅ 已恢復【${vol.name}】的搶班權限，並已通知本人。`
          : status === 'suspended'
            ? `已暫停【${vol.name}】的搶班權限，並已通知本人。`
            : `已將【${vol.name}】設為離退，紀錄與時數都保留。`
      );
      onVolunteersChanged?.();
    } catch {
      onSendLineToast?.('⚠️ 無法連線，狀態尚未更新。');
    } finally {
      setStatusBusy(prev => prev.filter(e => e !== vol.email));
    }
  };

  const startEditing = (vol: VolunteerProfile) => {
    setEditingEmail(vol.email);
    setEditDraft({
      skills: vol.skills.join('、'),
      preferredZones: [...vol.preferredZones],
      emergencyContact: vol.emergencyContact || ''
    });
  };

  const toggleDraftZone = (zoneKey: string) => {
    setEditDraft(prev => ({
      ...prev,
      preferredZones: prev.preferredZones.includes(zoneKey)
        ? prev.preferredZones.filter(z => z !== zoneKey)
        : [...prev.preferredZones, zoneKey]
    }));
  };

  const handleSaveEdit = async (email: string) => {
    setIsSavingEdit(true);
    try {
      const res = await authFetch(`/api/admin/volunteers/${encodeURIComponent(email)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          skills: editDraft.skills.split(/[、,，]/).map(s => s.trim()).filter(Boolean),
          preferredZones: editDraft.preferredZones,
          emergencyContact: editDraft.emergencyContact.trim()
        })
      });
      const data = await res.json();
      if (data.success) {
        setEditingEmail(null);
        onVolunteersChanged?.();
        onSendLineToast(`✅ 已更新【${data.volunteer.name}】的志工資料。`);
      } else {
        onSendLineToast(`⚠️ 更新失敗：${data.error || '未知錯誤'}`);
      }
    } catch (err: any) {
      onSendLineToast(`⚠️ 更新失敗：${err.message || '網路連線異常'}`);
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleDeleteVolunteer = async (vol: VolunteerProfile) => {
    if (!window.confirm(
      `確定要刪除志工「${vol.name}」的資料嗎？\n\n` +
      `這會一併移除他的 LINE 綁定與待審核的晉升申請，之後可用同一個 Google 帳號重新註冊一次（用來重演首次設定流程）。\n\n` +
      `注意：過去的出勤簽到紀錄會保留在系統中，不會被刪除。此操作無法復原。`
    )) return;

    setDeletingEmail(vol.email);
    try {
      const res = await authFetch(`/api/admin/volunteers/${encodeURIComponent(vol.email)}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        onVolunteersChanged?.();
        onSendLineToast(`🗑️ 已刪除志工「${vol.name}」，現在可以重新走一次首次註冊流程。`);
      } else {
        onSendLineToast(`⚠️ 刪除失敗：${data.error || '未知錯誤'}`);
      }
    } catch (err: any) {
      onSendLineToast(`⚠️ 刪除失敗：${err.message || '網路連線異常'}`);
    } finally {
      setDeletingEmail(null);
    }
  };

  // Pending volunteer tier-promotion requests, awaiting admin approval/rejection
  const [promotionRequests, setPromotionRequests] = useState<PromotionRequest[]>([]);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [rejectNoteDraftId, setRejectNoteDraftId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState('');

  const refreshPromotionRequests = () => {
    authFetch('/api/promotions')
      .then(res => res.json())
      .then(data => {
        if (data.success) setPromotionRequests(data.requests || []);
      })
      .catch(() => { /* best-effort */ });
  };

  useEffect(() => {
    refreshPromotionRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promotionsRevision]);

  const pendingRequests = promotionRequests.filter(r => r.status === 'pending');

  const handleApprovePromotion = (id: string) => {
    setReviewingId(id);
    authFetch(`/api/promotions/${id}/approve`, { method: 'POST' })
      .then(res => res.json())
      .then(() => refreshPromotionRequests())
      .finally(() => setReviewingId(null));
  };

  const handleRejectPromotion = (id: string) => {
    setReviewingId(id);
    authFetch(`/api/promotions/${id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewNote: rejectNote.trim() || undefined })
    })
      .then(res => res.json())
      .then(() => {
        refreshPromotionRequests();
        setRejectNoteDraftId(null);
        setRejectNote('');
      })
      .finally(() => setReviewingId(null));
  };

  // Filter volunteers
  const filteredVolunteers = volunteers.filter(vol => {
    if (tierFilter === 'top_contributors') {
      return vol.totalHours >= 80 || vol.completedShiftsCount >= 8;
    }
    if (tierFilter !== 'all' && vol.tier !== tierFilter) return false;
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      return (
        vol.name.toLowerCase().includes(term) ||
        vol.phone.includes(term) ||
        vol.lineId.toLowerCase().includes(term) ||
        vol.skills.some(s => s.toLowerCase().includes(term))
      );
    }
    return true;
  });

  // Sort volunteers
  const sortedVolunteers = [...filteredVolunteers].sort((a, b) => {
    if (sortBy === 'hours_desc') return b.totalHours - a.totalHours;
    if (sortBy === 'hours_asc') return a.totalHours - b.totalHours;
    if (sortBy === 'shifts_desc') return b.completedShiftsCount - a.completedShiftsCount;
    if (sortBy === 'name') return a.name.localeCompare(b.name, 'zh-TW');
    return 0;
  });

  // Client-side pagination -- purely to keep the browser from having to mount/paint
  // hundreds of cards at once as the roster grows; the full list is already fetched
  // in one shot, so this has no effect on server load or network payload.
  const ITEMS_PER_PAGE = 9;
  const [currentPage, setCurrentPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(sortedVolunteers.length / ITEMS_PER_PAGE));

  // Changing a filter/search/sort can shrink the result set out from under whatever
  // page you were on -- snap back to page 1 so you never land on a blank page.
  React.useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, tierFilter, sortBy]);

  const paginatedVolunteers = sortedVolunteers.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  // Calculate ranks based on totalHours descending
  const hoursRankedMap = new Map<string, number>();
  [...volunteers]
    .sort((a, b) => b.totalHours - a.totalHours)
    .forEach((vol, idx) => {
      hoursRankedMap.set(vol.id, idx + 1);
    });

  // Top 3 Leaderboard
  const topVolunteers = [...volunteers]
    .sort((a, b) => b.totalHours - a.totalHours)
    .slice(0, 3);

  return (
    <div className="space-y-6 py-6 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto font-sans">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 sm:p-8 rounded-[32px] border border-[#716053] shadow-xs">
        <div>
          <div className="flex items-center space-x-2">
            <h2 className="text-2xl font-bold font-serif italic text-[#716053] flex items-center gap-2">
              <Users className="w-6 h-6 text-[#716053]" />
              <span>志工人才庫與服務歷程名冊</span>
            </h2>
            <span className="bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-extrabold px-2.5 py-0.5 rounded-full flex items-center gap-1">
              <Trophy className="w-3 h-3 text-amber-600" />
              <span>貢獻度排行榜</span>
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1 font-sans">
            紀錄志工服務時數、完成班次、技能標籤、偏好場域與頂尖榮譽徽章。
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs font-bold font-sans">
          <span className="bg-[#FAF6EE] text-[#716053] px-3.5 py-1.5 rounded-full border border-[#716053]">
            總登記志工：{volunteers.length} 位
          </span>
          <span className="bg-[#716053] text-white px-3.5 py-1.5 rounded-full shadow-2xs">
            累積服務：{volunteers.reduce((acc, v) => acc + v.totalHours, 0)} 小時
          </span>
        </div>
      </div>

      {/* Pending Tier Promotion Requests -- volunteers who hit 100% on their growth
          checklist land here for admin approval/rejection */}
      {pendingRequests.length > 0 && (
        <div className="bg-white rounded-[28px] p-6 border border-amber-300 shadow-xs space-y-4">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
              <BellRing className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold font-serif text-slate-900 flex items-center gap-2">
                <span>待審核晉升申請</span>
                <span className="bg-rose-500 text-white text-[10px] font-extrabold px-2 py-0.5 rounded-full animate-pulse">
                  {pendingRequests.length}
                </span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">志工已達成晉升考核門檻，請審核是否核發新等級。</p>
            </div>
          </div>

          <div className="space-y-3">
            {pendingRequests.map(req => (
              <div key={req.id} className="bg-amber-50/60 border border-amber-200 rounded-2xl p-4 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <p className="font-bold text-slate-900 text-sm">
                      {req.volunteerName}
                      <span className="mx-1.5 text-slate-400 font-normal">申請由</span>
                      <span className="text-slate-600">{req.currentTier}</span>
                      <span className="mx-1 text-slate-400">→</span>
                      <span className="text-[#716053] font-extrabold">{req.requestedTier}</span>
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      申請時間：{req.requestedAt} ・ 已完成 {req.completedItems.length} 項考核項目
                    </p>
                    {req.completedItems.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {req.completedItems.map((item, idx) => (
                          <span key={idx} className="text-[10px] bg-white text-slate-600 border border-amber-200 px-2 py-0.5 rounded-md">
                            ✓ {item}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleApprovePromotion(req.id)}
                      disabled={reviewingId === req.id}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3.5 py-2 rounded-xl text-xs shadow-2xs transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>核准晉升</span>
                    </button>
                    <button
                      onClick={() => setRejectNoteDraftId(rejectNoteDraftId === req.id ? null : req.id)}
                      disabled={reviewingId === req.id}
                      className="bg-white hover:bg-rose-50 text-rose-700 border border-rose-300 font-bold px-3.5 py-2 rounded-xl text-xs shadow-2xs transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>駁回</span>
                    </button>
                  </div>
                </div>

                {rejectNoteDraftId === req.id && (
                  <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-amber-200/70">
                    <input
                      type="text"
                      value={rejectNote}
                      onChange={e => setRejectNote(e.target.value)}
                      placeholder="駁回原因（選填，將顯示給志工）"
                      className="flex-1 px-3 py-2 bg-white border border-amber-300 rounded-xl text-xs focus:ring-2 focus:ring-rose-400 focus:outline-none"
                    />
                    <button
                      onClick={() => handleRejectPromotion(req.id)}
                      disabled={reviewingId === req.id}
                      className="bg-rose-600 hover:bg-rose-700 text-white font-bold px-4 py-2 rounded-xl text-xs shadow-2xs transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                    >
                      確認駁回
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top Contributor Leaderboard Honor Roll */}
      <div className="bg-gradient-to-r from-[#716053] via-[#5A4A3F] to-[#363626] rounded-[32px] p-6 text-white shadow-xl relative overflow-hidden border border-[#F5E6D0]/20">
        <div className="absolute right-0 top-0 translate-x-1/4 -translate-y-1/4 w-80 h-80 bg-amber-400/10 rounded-full blur-3xl pointer-events-none"></div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 pb-4 border-b border-white/10 relative z-10">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-400 text-slate-950 flex items-center justify-center font-bold shadow-md">
              <Trophy className="w-6 h-6 text-amber-900" />
            </div>
            <div>
              <h3 className="font-serif font-bold text-lg text-white flex items-center gap-2">
                <span>浪浪家園 頂尖志工英雄榜 (Top Contributors)</span>
                <Sparkles className="w-4 h-4 text-amber-300 animate-pulse" />
              </h3>
              <p className="text-xs text-[#F5E6D0]">根據『累積服務時數』與『完成班次』綜合評選最高榮譽志工</p>
            </div>
          </div>
        </div>

        {/* Top 3 Podium Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 relative z-10">
          {topVolunteers.map((vol, idx) => {
            const rankBadges = [
              { label: '🏆 榜首金獎徽章', badgeBg: 'bg-amber-400 text-slate-950', ring: 'ring-2 ring-amber-300', rankNum: '1' },
              { label: '🥈 傑出銀獎徽章', badgeBg: 'bg-slate-200 text-slate-900', ring: 'ring-2 ring-slate-300', rankNum: '2' },
              { label: '🥉 熱心銅獎徽章', badgeBg: 'bg-amber-700 text-amber-100', ring: 'ring-2 ring-amber-600', rankNum: '3' }
            ];
            const badge = rankBadges[idx];

            return (
              <div
                key={vol.id}
                className={`bg-white/10 backdrop-blur-md rounded-2xl p-4 border border-white/15 flex items-center space-x-3 ${badge.ring}`}
              >
                <div className="relative shrink-0">
                  <img
                    src={vol.avatar}
                    alt={vol.name}
                    className="w-14 h-14 rounded-2xl object-cover border-2 border-white/80 shadow-md"
                  />
                  <span className={`absolute -top-2 -left-2 w-6 h-6 rounded-full font-black text-xs flex items-center justify-center shadow-md ${badge.badgeBg}`}>
                    {badge.rankNum}
                  </span>
                </div>

                <div className="space-y-1 flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-white font-serif text-base truncate">{vol.name}</span>
                    <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${badge.badgeBg}`}>
                      {badge.label}
                    </span>
                  </div>
                  
                  <div className="flex items-center space-x-3 text-xs text-[#F5E6D0] font-mono">
                    <span>⏱️ <strong className="text-white">{vol.totalHours}</strong> 小時</span>
                    <span>📋 <strong className="text-white">{vol.completedShiftsCount}</strong> 班次</span>
                  </div>

                  <div className="flex items-center justify-between text-[10px] text-white/70">
                    <span className="truncate">專長: {vol.skills.join(', ')}</span>
                    <button
                      onClick={() => setSelectedCertVolunteer(vol)}
                      className="ml-2 bg-amber-400 hover:bg-amber-300 text-slate-950 font-extrabold px-2 py-0.5 rounded-md shadow-2xs transition flex items-center gap-1 shrink-0 cursor-pointer"
                    >
                      <Download className="w-3 h-3 text-slate-950" />
                      <span>下載證明</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Filter, Search & Sort Control Panel */}
      <div className="flex flex-col lg:flex-row justify-between items-stretch lg:items-center gap-4 bg-white p-5 rounded-[24px] border border-[#716053] font-sans shadow-2xs">
        
        {/* Tier Filters */}
        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
          <span className="text-[#716053] uppercase tracking-wider text-[11px] font-bold mr-1 flex items-center gap-1">
            <Filter className="w-3.5 h-3.5" />
            <span>階級篩選：</span>
          </span>
          <button
            onClick={() => setTierFilter('all')}
            className={`px-3.5 py-1.5 rounded-full transition cursor-pointer ${
              tierFilter === 'all'
                ? 'bg-[#716053] text-white font-bold'
                : 'bg-[#FAF6EE] text-slate-600 hover:bg-[#F5E6D0]/40'
            }`}
          >
            全部志工 ({volunteers.length})
          </button>
          <button
            onClick={() => setTierFilter('top_contributors')}
            className={`px-3.5 py-1.5 rounded-full transition cursor-pointer flex items-center gap-1 ${
              tierFilter === 'top_contributors'
                ? 'bg-amber-500 text-slate-950 font-extrabold shadow-2xs'
                : 'bg-amber-100 text-amber-900 hover:bg-amber-200'
            }`}
          >
            <Trophy className="w-3.5 h-3.5 text-amber-800" />
            <span>頂尖貢獻榜 (時數 ≥ 80h)</span>
          </button>
          <button
            onClick={() => setTierFilter('志工隊長')}
            className={`px-3.5 py-1.5 rounded-full transition cursor-pointer ${
              tierFilter === '志工隊長'
                ? 'bg-[#716053] text-white font-bold'
                : 'bg-[#FAF6EE] text-slate-600 hover:bg-[#F5E6D0]/40'
            }`}
          >
            ⭐ 志工隊長
          </button>
          <button
            onClick={() => setTierFilter('資深志工')}
            className={`px-3.5 py-1.5 rounded-full transition cursor-pointer ${
              tierFilter === '資深志工'
                ? 'bg-[#716053] text-white font-bold'
                : 'bg-[#FAF6EE] text-slate-600 hover:bg-[#F5E6D0]/40'
            }`}
          >
            🏅 資深志工
          </button>
          <button
            onClick={() => setTierFilter('新進志工')}
            className={`px-3.5 py-1.5 rounded-full transition cursor-pointer ${
              tierFilter === '新進志工'
                ? 'bg-[#716053] text-white font-bold'
                : 'bg-[#FAF6EE] text-slate-600 hover:bg-[#F5E6D0]/40'
            }`}
          >
            🌱 新進志工
          </button>
        </div>

        {/* Sort & Search Controls */}
        <div className="flex flex-col sm:flex-row items-center gap-3">
          
          {/* Sorting Dropdown */}
          <div className="flex items-center space-x-1.5 bg-[#FAF6EE] px-3 py-1.5 rounded-2xl border border-[#716053] text-xs w-full sm:w-auto">
            <ArrowUpDown className="w-3.5 h-3.5 text-[#716053] shrink-0" />
            <span className="text-[#716053] font-bold text-[11px] whitespace-nowrap">排序：</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="bg-transparent font-bold text-[#716053] focus:outline-none cursor-pointer w-full"
            >
              <option value="hours_desc">累積時數 (高 → 低)</option>
              <option value="hours_asc">累積時數 (低 → 高)</option>
              <option value="shifts_desc">完成班次 (高 → 低)</option>
              <option value="name">志工姓名 (依筆劃)</option>
            </select>
          </div>

          {/* Search Box */}
          <div className="relative w-full sm:w-56">
            <Search className="w-4 h-4 text-[#716053] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="搜尋姓名、專長、LINE..."
              className="w-full pl-9 pr-3 py-2 bg-[#FAF6EE] border border-[#716053] rounded-2xl text-xs focus:ring-2 focus:ring-[#716053] focus:outline-none"
            />
          </div>

        </div>

      </div>

      {/* Volunteer Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 font-sans">
        {paginatedVolunteers.map(vol => {
          const rank = hoursRankedMap.get(vol.id) || 99;
          const isTop3 = rank <= 3;
          const isEditing = editingEmail === vol.email;

          return (
            <div
              key={vol.id}
              className={`bg-white rounded-[28px] border p-6 shadow-xs flex flex-col justify-between space-y-4 transition relative ${
                isTop3 ? 'border-amber-300 ring-2 ring-amber-200/60 shadow-md' : 'border-[#716053] hover:border-[#716053]'
              }`}
            >
              {/* Rank Badge on Card Top Right */}
              <div className="absolute top-5 right-5 flex flex-col items-end gap-1">
                {rank === 1 && (
                  <span className="bg-amber-400 text-slate-950 font-extrabold text-[10px] px-2.5 py-0.5 rounded-full shadow-xs flex items-center gap-1">
                    🥇 榜首 1st
                  </span>
                )}
                {rank === 2 && (
                  <span className="bg-slate-200 text-slate-800 font-extrabold text-[10px] px-2.5 py-0.5 rounded-full shadow-xs flex items-center gap-1">
                    🥈 榜眼 2nd
                  </span>
                )}
                {rank === 3 && (
                  <span className="bg-amber-700 text-amber-100 font-extrabold text-[10px] px-2.5 py-0.5 rounded-full shadow-xs flex items-center gap-1">
                    🥉 探花 3rd
                  </span>
                )}
                {rank > 3 && (
                  <span className="bg-[#FAF6EE] text-slate-600 font-bold text-[10px] px-2 py-0.5 rounded-full border border-[#716053]">
                    貢獻第 {rank} 名
                  </span>
                )}

                {/* Admin actions: edit this volunteer's details, or remove them
                    entirely so first-time registration can be replayed. */}
                {!isEditing && (
                  <div className="flex items-center gap-1 pt-0.5">
                    <button
                      onClick={() => startEditing(vol)}
                      title="編輯志工資料"
                      className="p-1.5 rounded-lg text-[#716053] hover:bg-[#F5E6D0] transition cursor-pointer"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDeleteVolunteer(vol)}
                      disabled={deletingEmail === vol.email}
                      title="刪除此志工資料"
                      className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50 transition cursor-pointer disabled:opacity-40"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>

              <div className="space-y-4">
                
                {/* Avatar & Basic Info */}
                <div className="flex items-center space-x-3 pr-16">
                  <div className="relative">
                    <img
                      src={vol.avatar}
                      alt={vol.name}
                      className="w-12 h-12 rounded-2xl object-cover border-2 border-[#716053] shadow-xs"
                    />
                    {isTop3 && (
                      <span className="absolute -bottom-1 -right-1 bg-amber-500 text-white rounded-full p-0.5 shadow-xs">
                        <Trophy className="w-3 h-3 text-slate-950" />
                      </span>
                    )}
                  </div>
                  <div>
                    <div className="flex items-center space-x-2">
                      <h3 className="font-bold font-serif text-slate-900 text-lg">
                        {vol.name}
                      </h3>
                      <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${
                        vol.tier === '志工隊長'
                          ? 'bg-[#716053] text-white'
                          : vol.tier === '資深志工'
                          ? 'bg-[#F5E6D0] text-[#716053]'
                          : 'bg-[#FAF6EE] text-slate-700 border border-[#716053]'
                      }`}>
                        {vol.tier}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <p className="text-xs text-[#716053] font-medium">LINE ID: @{vol.lineId}</p>
                      {vol.lineLinked ? (
                        <span className="text-[9px] bg-emerald-100 text-emerald-800 border border-emerald-300 font-extrabold px-1.5 py-0.2 rounded-full flex items-center gap-0.5">
                          <Check className="w-2.5 h-2.5" />
                          <span>已連結真實 LINE</span>
                        </span>
                      ) : (
                        <span className="text-[9px] bg-slate-100 text-slate-500 border border-slate-200 font-bold px-1.5 py-0.2 rounded-full">
                          尚未連結
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Account state -- only shown when it is not the ordinary one,
                    so a roster of active volunteers stays uncluttered. */}
                {vol.accountStatus && vol.accountStatus !== 'active' && (
                  <div className={`rounded-2xl p-3 text-xs border ${
                    vol.accountStatus === 'suspended'
                      ? 'bg-rose-50 border-rose-200'
                      : 'bg-slate-50 border-slate-200'
                  }`}>
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className={`font-bold ${
                        vol.accountStatus === 'suspended' ? 'text-rose-800' : 'text-slate-600'
                      }`}>
                        {vol.accountStatus === 'suspended' ? '⛔ 已停權（無法搶班）' : '📁 已離退'}
                      </span>
                      <button
                        onClick={() => changeAccountStatus(vol, 'active', '由督導恢復')}
                        disabled={statusBusy.includes(vol.email)}
                        className="px-2.5 py-1 rounded-xl bg-emerald-600 text-white text-[11px] font-bold hover:bg-emerald-700 disabled:opacity-50 transition"
                      >
                        {statusBusy.includes(vol.email) ? '處理中...' : '恢復權限'}
                      </button>
                    </div>
                    {vol.statusReason && (
                      <p className="text-[10px] text-slate-500 mt-1.5">{vol.statusReason}</p>
                    )}
                    {vol.statusChangedBy && (
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        由 {vol.statusChangedBy === 'system' ? '系統' : vol.statusChangedBy} 設定
                        {vol.statusChangedAt && ` · ${new Date(vol.statusChangedAt).toLocaleDateString('zh-TW')}`}
                      </p>
                    )}
                    <p className="text-[10px] text-emerald-700 mt-1.5">
                      服務時數與出勤紀錄都保留，恢復後即可繼續報名。
                    </p>
                  </div>
                )}

                {/* Hours & Shifts Stats */}
                <div className="grid grid-cols-2 gap-2 bg-[#FAF6EE] p-3.5 rounded-2xl text-xs border border-[#716053]">
                  <div>
                    <p className="text-[10px] text-[#716053] font-semibold">總服務時數</p>
                    <p className="font-extrabold text-[#716053] text-lg font-serif">
                      {vol.totalHours} <span className="text-xs font-sans font-medium">小時</span>
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-[#716053] font-semibold">出班次數</p>
                    <p className="font-extrabold text-slate-800 text-lg font-serif">
                      {vol.completedShiftsCount} <span className="text-xs font-sans font-medium">次</span>
                    </p>
                  </div>
                </div>

                {/* Special Top Volunteer Achievement Badges */}
                <div className="space-y-1">
                  <p className="text-[11px] font-bold text-[#716053] uppercase tracking-wider flex items-center gap-1">
                    <Award className="w-3.5 h-3.5 text-amber-600" />
                    <span>榮譽與成就徽章：</span>
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {vol.totalHours >= 100 && (
                      <span className="bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-bold px-2 py-0.5 rounded-md flex items-center gap-1">
                        🏆 百小時榮譽勳章
                      </span>
                    )}
                    {vol.completedShiftsCount >= 10 && (
                      <span className="bg-emerald-100 text-emerald-800 border border-emerald-300 text-[10px] font-bold px-2 py-0.5 rounded-md flex items-center gap-1">
                        ⭐ 班次熱血達人
                      </span>
                    )}
                    {vol.tier === '志工隊長' && (
                      <span className="bg-sky-100 text-sky-800 border border-sky-300 text-[10px] font-bold px-2 py-0.5 rounded-md flex items-center gap-1">
                        👑 卓越領航隊長
                      </span>
                    )}
                    {vol.skills.includes('園區車輛接送') && (
                      <span className="bg-purple-100 text-purple-800 border border-purple-200 text-[10px] font-bold px-2 py-0.5 rounded-md">
                        🚗 救援接送大使
                      </span>
                    )}
                  </div>
                </div>

                {isEditing ? (
                  /* ---- Edit mode ---- */
                  <div className="space-y-3 bg-[#FAF6EE] border-3 border-amber-400 rounded-2xl p-3.5">
                    <div>
                      <label className="text-[11px] font-bold text-[#716053] block mb-1">專業與技能（用、或逗號分隔）</label>
                      <input
                        type="text"
                        value={editDraft.skills}
                        onChange={e => setEditDraft({ ...editDraft, skills: e.target.value })}
                        placeholder="例如：親人貓撫摸、貓砂盆清潔"
                        className="w-full p-2 bg-white rounded-xl text-[11px] focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="text-[11px] font-bold text-[#716053] block mb-1">偏好支援場域（可複選）</label>
                      <div className="flex flex-wrap gap-1">
                        {Object.keys(ZONE_CONFIGS).map(zKey => {
                          const zConf = resolveZone(zKey);
                          const picked = editDraft.preferredZones.includes(zKey);
                          return (
                            <button
                              key={zKey}
                              type="button"
                              onClick={() => toggleDraftZone(zKey)}
                              className={`text-[10px] font-bold px-2.5 py-1 rounded-full transition cursor-pointer border-2 ${
                                picked
                                  ? `${zConf?.badgeBg} border-[#716053]`
                                  : 'bg-white text-slate-400 border-slate-300'
                              }`}
                            >
                              {zConf?.icon} {zConf?.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      <label className="text-[11px] font-bold text-[#716053] block mb-1">🆘 緊急聯絡人</label>
                      <input
                        type="text"
                        value={editDraft.emergencyContact}
                        onChange={e => setEditDraft({ ...editDraft, emergencyContact: e.target.value })}
                        placeholder="例如：王媽媽 0922-888-000"
                        className="w-full p-2 bg-white rounded-xl text-[11px] focus:outline-none"
                      />
                    </div>

                    <p className="text-[10px] text-slate-500 leading-snug">
                      💡 服務時數、出班次數與志工等級不可手動修改，會由簽退紀錄與晉升審核自動累計；榮譽徽章也會依此自動更新。
                    </p>

                    <div className="flex justify-end gap-2 pt-1">
                      <button
                        onClick={() => setEditingEmail(null)}
                        className="px-3 py-1.5 rounded-xl text-[11px] font-bold text-slate-500 hover:bg-slate-100 cursor-pointer"
                      >
                        取消
                      </button>
                      <button
                        onClick={() => handleSaveEdit(vol.email)}
                        disabled={isSavingEdit}
                        className="bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 font-bold px-4 py-1.5 rounded-xl text-[11px] transition flex items-center gap-1.5 cursor-pointer"
                      >
                        <Save className="w-3.5 h-3.5" />
                        <span>{isSavingEdit ? '儲存中...' : '儲存變更'}</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Skill Tags */}
                    <div className="space-y-1">
                      <p className="text-[11px] font-bold text-[#716053] uppercase tracking-wider">專業與技能：</p>
                      <div className="flex flex-wrap gap-1">
                        {vol.skills.length > 0 ? vol.skills.map((skill, idx) => (
                          <span
                            key={idx}
                            className="bg-[#FAF6EE] text-slate-700 border border-[#716053] px-2.5 py-0.5 rounded-lg text-[11px]"
                          >
                            {skill}
                          </span>
                        )) : (
                          <span className="text-[11px] text-slate-400 italic">尚未填寫</span>
                        )}
                      </div>
                    </div>

                    {/* Preferred Zones */}
                    <div className="space-y-1">
                      <p className="text-[11px] font-bold text-[#716053] uppercase tracking-wider">偏好支援場域：</p>
                      <div className="flex flex-wrap gap-1">
                        {vol.preferredZones.length > 0 ? vol.preferredZones.map(zKey => {
                          const zConf = resolveZone(zKey);
                          return (
                            <span
                              key={zKey}
                              className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${zConf?.badgeBg}`}
                            >
                              {zConf?.icon} {zConf?.name}
                            </span>
                          );
                        }) : (
                          <span className="text-[11px] text-slate-400 italic">尚未填寫</span>
                        )}
                      </div>
                    </div>

                    {/* Emergency Contact & Download Certificate Button */}
                    <div className="text-[11px] text-slate-500 pt-3 border-t border-[#716053] flex justify-between items-center gap-2">
                      <div className="truncate">
                        <span>🆘 緊急聯絡人：</span>
                        <span className="font-medium text-slate-800">
                          {vol.emergencyContact || <span className="text-slate-400 italic">尚未填寫</span>}
                        </span>
                      </div>

                      <button
                        onClick={() => setSelectedCertVolunteer(vol)}
                        className="bg-[#716053] hover:bg-[#5A4A3F] text-white font-bold px-3 py-1.5 rounded-full text-[11px] shadow-2xs transition flex items-center gap-1 shrink-0 cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5 text-[#F5E6D0]" />
                        <span>下載證明</span>
                      </button>
                    </div>
                  </>
                )}

              </div>
            </div>
          );
        })}
      </div>

      {/* Pagination -- only shown once there's actually more than one page */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <button
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="p-2 rounded-xl border border-[#716053] bg-white text-[#716053] disabled:opacity-30 disabled:cursor-not-allowed hover:bg-[#FAF6EE] transition cursor-pointer"
            title="上一頁"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
            <button
              key={p}
              onClick={() => setCurrentPage(p)}
              className={`w-9 h-9 rounded-xl text-xs font-bold transition cursor-pointer ${
                p === currentPage
                  ? 'bg-[#716053] text-white shadow-xs'
                  : 'bg-white text-slate-600 border border-[#716053] hover:bg-[#FAF6EE]'
              }`}
            >
              {p}
            </button>
          ))}

          <button
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            className="p-2 rounded-xl border border-[#716053] bg-white text-[#716053] disabled:opacity-30 disabled:cursor-not-allowed hover:bg-[#FAF6EE] transition cursor-pointer"
            title="下一頁"
          >
            <ChevronRight className="w-4 h-4" />
          </button>

          <span className="text-[11px] text-slate-400 ml-2">
            第 {currentPage} / {totalPages} 頁・共 {sortedVolunteers.length} 位志工
          </span>
        </div>
      )}

      {/* Certificate Modal */}
      {selectedCertVolunteer && (
        <CertificateModal
          volunteer={selectedCertVolunteer}
          onClose={() => setSelectedCertVolunteer(null)}
        />
      )}

    </div>
  );
};

