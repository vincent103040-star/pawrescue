import React, { useState, useEffect } from 'react';
import { VolunteerProfile, PromotionRequest } from '../types';
import { ZONE_CONFIGS } from '../data/mockData';
import { Users, Award, Clock, Search, Shield, Phone, Mail, MessageSquare, Star, Plus, Check, X, Trophy, TrendingUp, Medal, Sparkles, ArrowUpDown, Filter, Download, FileText, ChevronLeft, ChevronRight, BellRing } from 'lucide-react';
import { CertificateModal } from './CertificateModal';

interface VolunteerRosterProps {
  volunteers: VolunteerProfile[];
  onAddVolunteer?: (vol: VolunteerProfile) => void;
}

export const VolunteerRoster: React.FC<VolunteerRosterProps> = ({ volunteers }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [tierFilter, setTierFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'hours_desc' | 'hours_asc' | 'shifts_desc' | 'name'>('hours_desc');
  const [selectedCertVolunteer, setSelectedCertVolunteer] = useState<VolunteerProfile | null>(null);

  // Pending volunteer tier-promotion requests, awaiting admin approval/rejection
  const [promotionRequests, setPromotionRequests] = useState<PromotionRequest[]>([]);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [rejectNoteDraftId, setRejectNoteDraftId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState('');

  const refreshPromotionRequests = () => {
    fetch('/api/promotions')
      .then(res => res.json())
      .then(data => {
        if (data.success) setPromotionRequests(data.requests || []);
      })
      .catch(() => { /* best-effort */ });
  };

  useEffect(() => {
    refreshPromotionRequests();
  }, []);

  const pendingRequests = promotionRequests.filter(r => r.status === 'pending');

  const handleApprovePromotion = (id: string) => {
    setReviewingId(id);
    fetch(`/api/promotions/${id}/approve`, { method: 'POST' })
      .then(res => res.json())
      .then(() => refreshPromotionRequests())
      .finally(() => setReviewingId(null));
  };

  const handleRejectPromotion = (id: string) => {
    setReviewingId(id);
    fetch(`/api/promotions/${id}/reject`, {
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 sm:p-8 rounded-[32px] border border-[#5A5A40]/12 shadow-xs">
        <div>
          <div className="flex items-center space-x-2">
            <h2 className="text-2xl font-bold font-serif italic text-[#5A5A40] flex items-center gap-2">
              <Users className="w-6 h-6 text-[#5A5A40]" />
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
          <span className="bg-[#f5f5f0] text-[#5A5A40] px-3.5 py-1.5 rounded-full border border-[#5A5A40]/15">
            總登記志工：{volunteers.length} 位
          </span>
          <span className="bg-[#5A5A40] text-white px-3.5 py-1.5 rounded-full shadow-2xs">
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
                      <span className="text-[#5A5A40] font-extrabold">{req.requestedTier}</span>
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
      <div className="bg-gradient-to-r from-[#5A5A40] via-[#484833] to-[#363626] rounded-[32px] p-6 text-white shadow-xl relative overflow-hidden border border-[#E6E2D3]/20">
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
              <p className="text-xs text-[#E6E2D3]">根據『累積服務時數』與『完成班次』綜合評選最高榮譽志工</p>
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
                  
                  <div className="flex items-center space-x-3 text-xs text-[#E6E2D3] font-mono">
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
      <div className="flex flex-col lg:flex-row justify-between items-stretch lg:items-center gap-4 bg-white p-5 rounded-[24px] border border-[#5A5A40]/12 font-sans shadow-2xs">
        
        {/* Tier Filters */}
        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
          <span className="text-[#5A5A40] uppercase tracking-wider text-[11px] font-bold mr-1 flex items-center gap-1">
            <Filter className="w-3.5 h-3.5" />
            <span>階級篩選：</span>
          </span>
          <button
            onClick={() => setTierFilter('all')}
            className={`px-3.5 py-1.5 rounded-full transition cursor-pointer ${
              tierFilter === 'all'
                ? 'bg-[#5A5A40] text-white font-bold'
                : 'bg-[#f5f5f0] text-slate-600 hover:bg-[#E6E2D3]/40'
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
                ? 'bg-[#5A5A40] text-white font-bold'
                : 'bg-[#f5f5f0] text-slate-600 hover:bg-[#E6E2D3]/40'
            }`}
          >
            ⭐ 志工隊長
          </button>
          <button
            onClick={() => setTierFilter('資深志工')}
            className={`px-3.5 py-1.5 rounded-full transition cursor-pointer ${
              tierFilter === '資深志工'
                ? 'bg-[#5A5A40] text-white font-bold'
                : 'bg-[#f5f5f0] text-slate-600 hover:bg-[#E6E2D3]/40'
            }`}
          >
            🏅 資深志工
          </button>
          <button
            onClick={() => setTierFilter('新進志工')}
            className={`px-3.5 py-1.5 rounded-full transition cursor-pointer ${
              tierFilter === '新進志工'
                ? 'bg-[#5A5A40] text-white font-bold'
                : 'bg-[#f5f5f0] text-slate-600 hover:bg-[#E6E2D3]/40'
            }`}
          >
            🌱 新進志工
          </button>
        </div>

        {/* Sort & Search Controls */}
        <div className="flex flex-col sm:flex-row items-center gap-3">
          
          {/* Sorting Dropdown */}
          <div className="flex items-center space-x-1.5 bg-[#f5f5f0] px-3 py-1.5 rounded-2xl border border-[#5A5A40]/15 text-xs w-full sm:w-auto">
            <ArrowUpDown className="w-3.5 h-3.5 text-[#5A5A40] shrink-0" />
            <span className="text-[#5A5A40] font-bold text-[11px] whitespace-nowrap">排序：</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="bg-transparent font-bold text-[#5A5A40] focus:outline-none cursor-pointer w-full"
            >
              <option value="hours_desc">累積時數 (高 → 低)</option>
              <option value="hours_asc">累積時數 (低 → 高)</option>
              <option value="shifts_desc">完成班次 (高 → 低)</option>
              <option value="name">志工姓名 (依筆劃)</option>
            </select>
          </div>

          {/* Search Box */}
          <div className="relative w-full sm:w-56">
            <Search className="w-4 h-4 text-[#5A5A40] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="搜尋姓名、專長、LINE..."
              className="w-full pl-9 pr-3 py-2 bg-[#f5f5f0] border border-[#5A5A40]/15 rounded-2xl text-xs focus:ring-2 focus:ring-[#5A5A40] focus:outline-none"
            />
          </div>

        </div>

      </div>

      {/* Volunteer Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 font-sans">
        {paginatedVolunteers.map(vol => {
          const rank = hoursRankedMap.get(vol.id) || 99;
          const isTop3 = rank <= 3;

          return (
            <div
              key={vol.id}
              className={`bg-white rounded-[28px] border p-6 shadow-xs flex flex-col justify-between space-y-4 transition relative ${
                isTop3 ? 'border-amber-300 ring-2 ring-amber-200/60 shadow-md' : 'border-[#5A5A40]/12 hover:border-[#5A5A40]/30'
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
                  <span className="bg-[#f5f5f0] text-slate-600 font-bold text-[10px] px-2 py-0.5 rounded-full border border-[#5A5A40]/10">
                    貢獻第 {rank} 名
                  </span>
                )}
              </div>

              <div className="space-y-4">
                
                {/* Avatar & Basic Info */}
                <div className="flex items-center space-x-3 pr-16">
                  <div className="relative">
                    <img
                      src={vol.avatar}
                      alt={vol.name}
                      className="w-12 h-12 rounded-2xl object-cover border-2 border-[#5A5A40]/20 shadow-xs"
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
                          ? 'bg-[#5A5A40] text-white'
                          : vol.tier === '資深志工'
                          ? 'bg-[#E6E2D3] text-[#5A5A40]'
                          : 'bg-[#f5f5f0] text-slate-700 border border-[#5A5A40]/15'
                      }`}>
                        {vol.tier}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <p className="text-xs text-[#5A5A40] font-medium">LINE ID: @{vol.lineId}</p>
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

                {/* Hours & Shifts Stats */}
                <div className="grid grid-cols-2 gap-2 bg-[#f5f5f0] p-3.5 rounded-2xl text-xs border border-[#5A5A40]/10">
                  <div>
                    <p className="text-[10px] text-[#5A5A40] font-semibold">總服務時數</p>
                    <p className="font-extrabold text-[#5A5A40] text-lg font-serif">
                      {vol.totalHours} <span className="text-xs font-sans font-medium">小時</span>
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-[#5A5A40] font-semibold">出班次數</p>
                    <p className="font-extrabold text-slate-800 text-lg font-serif">
                      {vol.completedShiftsCount} <span className="text-xs font-sans font-medium">次</span>
                    </p>
                  </div>
                </div>

                {/* Special Top Volunteer Achievement Badges */}
                <div className="space-y-1">
                  <p className="text-[11px] font-bold text-[#5A5A40] uppercase tracking-wider flex items-center gap-1">
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

                {/* Skill Tags */}
                <div className="space-y-1">
                  <p className="text-[11px] font-bold text-[#5A5A40] uppercase tracking-wider">專業與技能：</p>
                  <div className="flex flex-wrap gap-1">
                    {vol.skills.map((skill, idx) => (
                      <span
                        key={idx}
                        className="bg-[#f5f5f0] text-slate-700 border border-[#5A5A40]/10 px-2.5 py-0.5 rounded-lg text-[11px]"
                      >
                        {skill}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Preferred Zones */}
                <div className="space-y-1">
                  <p className="text-[11px] font-bold text-[#5A5A40] uppercase tracking-wider">偏好支援場域：</p>
                  <div className="flex flex-wrap gap-1">
                    {vol.preferredZones.map(zKey => {
                      const zConf = ZONE_CONFIGS[zKey];
                      return (
                        <span
                          key={zKey}
                          className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${zConf?.badgeBg}`}
                        >
                          {zConf?.icon} {zConf?.name}
                        </span>
                      );
                    })}
                  </div>
                </div>

                {/* Emergency Contact & Download Certificate Button */}
                <div className="text-[11px] text-slate-500 pt-3 border-t border-[#5A5A40]/10 flex justify-between items-center gap-2">
                  <div className="truncate">
                    <span>🆘 緊急聯絡人：</span>
                    <span className="font-medium text-slate-800">{vol.emergencyContact}</span>
                  </div>

                  <button
                    onClick={() => setSelectedCertVolunteer(vol)}
                    className="bg-[#5A5A40] hover:bg-[#484833] text-white font-bold px-3 py-1.5 rounded-full text-[11px] shadow-2xs transition flex items-center gap-1 shrink-0 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5 text-[#E6E2D3]" />
                    <span>下載證明</span>
                  </button>
                </div>

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
            className="p-2 rounded-xl border border-[#5A5A40]/15 bg-white text-[#5A5A40] disabled:opacity-30 disabled:cursor-not-allowed hover:bg-[#f5f5f0] transition cursor-pointer"
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
                  ? 'bg-[#5A5A40] text-white shadow-xs'
                  : 'bg-white text-slate-600 border border-[#5A5A40]/15 hover:bg-[#f5f5f0]'
              }`}
            >
              {p}
            </button>
          ))}

          <button
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            className="p-2 rounded-xl border border-[#5A5A40]/15 bg-white text-[#5A5A40] disabled:opacity-30 disabled:cursor-not-allowed hover:bg-[#f5f5f0] transition cursor-pointer"
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

