import React from 'react';
import { PawPrint, Calendar, Shield, UserCheck, PlusCircle, Sparkles, QrCode, BookOpen, LogOut, User } from 'lucide-react';
import { AdminUserSession } from '../types';

interface AdminNavbarProps {
  activeTab: 'dashboard' | 'positions' | 'applications' | 'roster' | 'sopManager';
  setActiveTab: (tab: 'dashboard' | 'positions' | 'applications' | 'roster' | 'sopManager') => void;
  pendingCount: number;
  openCreateModal: () => void;
  openCheckInModal?: () => void;
  openRulebookModal?: () => void;
  currentUser: AdminUserSession | null;
  onLogout: () => void;
}

export const AdminNavbar: React.FC<AdminNavbarProps> = ({
  activeTab,
  setActiveTab,
  pendingCount,
  openCreateModal,
  openCheckInModal,
  openRulebookModal,
  currentUser,
  onLogout
}) => {
  return (
    <header className="bg-white border-b border-[#5A5A40]/15 sticky top-0 z-40 shadow-xs">
      
      {/* Top Admin Notice & Status Bar */}
      <div className="bg-[#5A5A40] text-white text-xs py-1.5 px-4 flex justify-between items-center font-medium">
        <div className="flex items-center space-x-2">
          <span className="bg-[#E6E2D3] text-[#5A5A40] px-2.5 py-0.5 rounded-full text-[10px] font-extrabold tracking-wider uppercase flex items-center gap-1">
            <Shield className="w-3 h-3 text-[#5A5A40]" />
            <span>管理督導控制台</span>
          </span>
          <span className="font-sans text-white/90">
            🐾 浪浪家園 PawRescue &bull; 管理者 / 社工督導專用工作站
          </span>
        </div>

        <div className="flex items-center space-x-3 text-white/90 text-[11px]">
          <div className="hidden sm:flex items-center gap-2 bg-black/20 px-2.5 py-0.5 rounded-full">
            <User className="w-3.5 h-3.5 text-[#E6E2D3]" />
            <span>登入者：<strong>{currentUser?.name || '蔡督導'}</strong> ({currentUser?.roleTitle || '系統管理員'})</span>
          </div>

          <button
            onClick={onLogout}
            className="hover:bg-white/20 text-white/80 hover:text-white px-2 py-0.5 rounded-md text-[11px] flex items-center gap-1 transition cursor-pointer"
            title="登出並返回登入主頁"
          >
            <LogOut className="w-3 h-3" />
            <span>登出</span>
          </button>
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
                <span className="text-[10px] bg-[#5A5A40] text-white px-2.5 py-0.5 rounded-full font-bold">
                  管理督導後台
                </span>
              </div>
              <p className="text-xs text-slate-500 font-sans">缺工預警 &bull; 班次發布 &bull; 報名審核 &bull; 人才庫管理</p>
            </div>
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
                <span className="hidden sm:inline">志工簽到掃碼台</span>
                <span className="sm:hidden">簽到台</span>
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

        {/* Admin Navigation Tabs (Exclusively for Staff/Managers) */}
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
            onClick={() => setActiveTab('roster')}
            className={`px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap flex items-center space-x-1.5 transition cursor-pointer ${
              activeTab === 'roster'
                ? 'bg-[#5A5A40] text-white shadow-xs'
                : 'text-slate-600 hover:bg-[#E6E2D3]/40 hover:text-[#5A5A40]'
            }`}
          >
            <Sparkles className="w-4 h-4 text-amber-300" />
            <span>4. 志工人才庫名冊</span>
          </button>

          <button
            onClick={() => setActiveTab('sopManager')}
            className={`px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap flex items-center space-x-1.5 transition cursor-pointer ${
              activeTab === 'sopManager'
                ? 'bg-[#5A5A40] text-white shadow-xs'
                : 'text-slate-600 hover:bg-[#E6E2D3]/40 hover:text-[#5A5A40]'
            }`}
          >
            <BookOpen className="w-4 h-4 text-emerald-300" />
            <span>5. 手冊與 SOP 內容管理</span>
          </button>
        </div>
      </div>
    </header>
  );
};
