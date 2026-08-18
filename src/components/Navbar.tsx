import React from 'react';
import { PawPrint, Calendar, MapPin, MessageSquare, Shield, UserCheck, PlusCircle, Sparkles, Building2, QrCode, BookOpen } from 'lucide-react';
import { BranchId, Branch } from '../types';

interface NavbarProps {
  activeTab: 'dashboard' | 'positions' | 'applications' | 'portal' | 'integration' | 'roster';
  setActiveTab: (tab: 'dashboard' | 'positions' | 'applications' | 'portal' | 'integration' | 'roster') => void;
  selectedBranch: BranchId | 'all';
  setSelectedBranch: (branch: BranchId | 'all') => void;
  branches: Branch[];
  pendingCount: number;
  openCreateModal: () => void;
  openCheckInModal?: () => void;
  openRulebookModal?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  selectedBranch,
  setSelectedBranch,
  branches,
  pendingCount,
  openCreateModal,
  openCheckInModal,
  openRulebookModal
}) => {
  return (
    <header className="bg-white border-b border-[#5A5A40]/15 sticky top-0 z-40 shadow-xs">
      {/* Top Brand & Notice Bar */}
      <div className="bg-[#5A5A40] text-white text-xs py-1.5 px-4 flex justify-between items-center font-medium">
        <div className="flex items-center space-x-2">
          <span className="bg-[#E6E2D3] text-[#5A5A40] px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase">系統展示雛形</span>
          <span className="font-sans">🐾 浪浪家園 - Google 地圖 &amp; 日曆 &amp; LINE 三方串聯志工排班系統</span>
        </div>
        <div className="hidden sm:flex items-center space-x-4 text-white/80 text-[11px]">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400"></span> Google Workspace 同步中</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400"></span> LINE Notify API 正常</span>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-18">
          
          {/* Logo & System Name */}
          <div className="flex items-center space-x-3 cursor-pointer group" onClick={() => setActiveTab('dashboard')}>
            <div className="w-11 h-11 rounded-2xl bg-[#5A5A40] text-white flex items-center justify-center shadow-xs transform transition group-hover:scale-105">
              <PawPrint className="w-6 h-6 text-white" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h1 className="text-xl font-bold font-serif italic text-[#5A5A40] tracking-tight">
                  浪浪家園 PawRescue
                </h1>
                <span className="text-[11px] bg-[#E6E2D3] text-[#5A5A40] px-2.5 py-0.5 rounded-full font-bold">
                  志工管理系統
                </span>
              </div>
              <p className="text-xs text-slate-500 font-sans">流浪動物之家 志工招募與人力服務總控制台</p>
            </div>
          </div>

          {/* Branch Selector */}
          <div className="hidden md:flex items-center bg-[#f5f5f0] p-1.5 rounded-2xl border border-[#5A5A40]/10 text-xs font-medium">
            <span className="px-2.5 text-[#5A5A40] font-bold flex items-center gap-1">
              <Building2 className="w-3.5 h-3.5" /> 院區：
            </span>
            <button
              onClick={() => setSelectedBranch('all')}
              className={`px-3 py-1.5 rounded-xl transition cursor-pointer ${
                selectedBranch === 'all'
                  ? 'bg-[#5A5A40] text-white shadow-xs font-bold'
                  : 'text-slate-600 hover:text-[#5A5A40]'
              }`}
            >
              全部據點 (3)
            </button>
            {branches.map((b) => (
              <button
                key={b.id}
                onClick={() => setSelectedBranch(b.id)}
                className={`px-3 py-1.5 rounded-xl transition cursor-pointer ${
                  selectedBranch === b.id
                    ? 'bg-[#5A5A40] text-white shadow-xs font-bold'
                    : 'text-slate-600 hover:text-[#5A5A40]'
                }`}
              >
                {b.name.split(' ')[0]}
              </button>
            ))}
          </div>

          {/* Quick Action Button */}
          <div className="flex items-center space-x-2">
            {openRulebookModal && (
              <button
                onClick={openRulebookModal}
                className="bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 px-3.5 py-2.5 rounded-full text-xs font-bold flex items-center space-x-1.5 shadow-xs transition transform active:scale-95 cursor-pointer"
              >
                <BookOpen className="w-4 h-4 text-amber-700" />
                <span className="hidden sm:inline">規則書與指南 PDF</span>
                <span className="sm:hidden">規則書</span>
              </button>
            )}

            {openCheckInModal && (
              <button
                onClick={openCheckInModal}
                className="bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-2.5 rounded-full text-xs font-bold flex items-center space-x-1.5 shadow-sm transition transform active:scale-95 cursor-pointer"
              >
                <QrCode className="w-4 h-4" />
                <span>志工掃碼簽到</span>
              </button>
            )}

            <button
              onClick={openCreateModal}
              className="bg-[#5A5A40] hover:bg-[#484833] text-white px-4 py-2.5 rounded-full text-xs font-bold flex items-center space-x-1.5 shadow-sm transition transform active:scale-95 cursor-pointer"
            >
              <PlusCircle className="w-4 h-4 text-[#E6E2D3]" />
              <span className="hidden sm:inline">發布新志工班次</span>
              <span className="sm:hidden">發布班次</span>
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex space-x-1 overflow-x-auto pb-2.5 pt-1 border-t border-[#5A5A40]/10 no-scrollbar">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap flex items-center space-x-1.5 transition cursor-pointer ${
              activeTab === 'dashboard'
                ? 'bg-[#5A5A40] text-white shadow-xs'
                : 'text-slate-600 hover:bg-[#E6E2D3]/40 hover:text-[#5A5A40]'
            }`}
          >
            <Shield className="w-4 h-4 text-amber-300" />
            <span>1. 缺工統計看板</span>
          </button>

          <button
            onClick={() => setActiveTab('positions')}
            className={`px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap flex items-center space-x-1.5 transition cursor-pointer ${
              activeTab === 'positions'
                ? 'bg-[#5A5A40] text-white shadow-xs'
                : 'text-slate-600 hover:bg-[#E6E2D3]/40 hover:text-[#5A5A40]'
            }`}
          >
            <Calendar className="w-4 h-4 text-emerald-300" />
            <span>2. 職位與班次發布</span>
          </button>

          <button
            onClick={() => setActiveTab('applications')}
            className={`px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap flex items-center space-x-1.5 transition relative cursor-pointer ${
              activeTab === 'applications'
                ? 'bg-[#5A5A40] text-white shadow-xs'
                : 'text-slate-600 hover:bg-[#E6E2D3]/40 hover:text-[#5A5A40]'
            }`}
          >
            <UserCheck className="w-4 h-4 text-sky-300" />
            <span>3. 報名與審核流程</span>
            {pendingCount > 0 && (
              <span className="ml-1 px-2 py-0.5 text-[10px] bg-rose-500 text-white rounded-full font-bold animate-pulse">
                {pendingCount}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('portal')}
            className={`px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap flex items-center space-x-1.5 transition cursor-pointer ${
              activeTab === 'portal'
                ? 'bg-[#5A5A40] text-white shadow-xs'
                : 'text-slate-600 hover:bg-[#E6E2D3]/40 hover:text-[#5A5A40]'
            }`}
          >
            <PawPrint className="w-4 h-4 text-purple-300" />
            <span>🐾 志工線上搶班門戶</span>
          </button>

          <button
            onClick={() => setActiveTab('integration')}
            className={`px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap flex items-center space-x-1.5 transition cursor-pointer ${
              activeTab === 'integration'
                ? 'bg-[#5A5A40] text-white shadow-xs'
                : 'text-slate-600 hover:bg-[#E6E2D3]/40 hover:text-[#5A5A40]'
            }`}
          >
            <MessageSquare className="w-4 h-4 text-emerald-300" />
            <span>🗺️ 地圖 / 日曆 / LINE 串聯</span>
          </button>

          <button
            onClick={() => setActiveTab('roster')}
            className={`px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap flex items-center space-x-1.5 transition cursor-pointer ${
              activeTab === 'roster'
                ? 'bg-[#5A5A40] text-white shadow-xs'
                : 'text-slate-600 hover:bg-[#E6E2D3]/40 hover:text-[#5A5A40]'
            }`}
          >
            <Sparkles className="w-4 h-4 text-amber-300" />
            <span>志工人才庫名冊</span>
          </button>
        </div>
      </div>
    </header>
  );
};
