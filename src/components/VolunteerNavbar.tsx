import React from 'react';
import { PawPrint, Calendar, Heart, MessageSquare, QrCode, BookOpen, LogOut, User, TrendingUp, Settings, Star, CheckCircle2, HeartHandshake } from 'lucide-react';
import { VolunteerUserSession } from '../types';

export type VolunteerActiveTab = 'shifts' | 'myshifts' | 'growth' | 'settings' | 'sop';

interface VolunteerNavbarProps {
  activeTab: VolunteerActiveTab;
  setActiveTab: (tab: VolunteerActiveTab) => void;
  openCheckInModal?: () => void;
  openRulebookModal?: () => void;
  currentUser: VolunteerUserSession | null;
  mySignupsCount: number;
  onLogout: () => void;
}

export const VolunteerNavbar: React.FC<VolunteerNavbarProps> = ({
  activeTab,
  setActiveTab,
  openCheckInModal,
  openRulebookModal,
  currentUser,
  mySignupsCount,
  onLogout
}) => {
  return (
    <header className="bg-white border-b border-amber-200/80 sticky top-0 z-40 shadow-xs">
      
      {/* Top Volunteer Notice & Status Bar */}
      <div className="bg-[#716053] text-white text-xs py-1.5 px-4 flex flex-wrap gap-y-1 justify-between items-center font-medium">
        <div className="flex items-center space-x-2 min-w-0">
          <span className="bg-amber-100 text-amber-900 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold tracking-wider uppercase flex items-center gap-1 shrink-0">
            <HeartHandshake className="w-3 h-3 text-amber-700" />
            <span>志工專屬服務平台</span>
          </span>
          <span className="hidden sm:inline font-sans text-white/90 truncate">
            🐾 浪浪家園 PawRescue &bull; 志工排班、出勤簽到與成長歷程
          </span>
        </div>

        <div className="flex items-center space-x-2 text-white/90 text-[11px] shrink-0">
          <div className="hidden sm:flex items-center gap-2 bg-black/20 px-2.5 py-0.5 rounded-full">
            <User className="w-3.5 h-3.5 text-amber-200" />
            <span>
              志工：<strong>{currentUser?.name || '林小明'}</strong>
              <span className="ml-1 px-1.5 py-0.2 bg-amber-500/40 text-amber-100 rounded-md text-[10px]">
                {currentUser?.tier || '資深志工'}
              </span>
            </span>
          </div>

          <button
            onClick={onLogout}
            className="hover:bg-white/20 text-white/80 hover:text-white px-2 py-0.5 rounded-md text-[11px] flex items-center gap-1 transition cursor-pointer whitespace-nowrap shrink-0"
            title="登出並返回身分選擇頁"
          >
            <LogOut className="w-3 h-3" />
            <span>登出</span>
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-y-2 min-h-18 py-2">

          {/* Logo & Volunteer Portal Name */}
          <div className="flex items-center space-x-3 cursor-pointer group min-w-0" onClick={() => setActiveTab('shifts')}>
            <div className="w-11 h-11 rounded-2xl bg-[#716053] text-white flex items-center justify-center shadow-xs transform transition group-hover:scale-105 shrink-0">
              <PawPrint className="w-6 h-6 text-white" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center space-x-2 flex-wrap">
                <h1 className="text-xl font-bold font-serif italic text-[#716053] tracking-tight whitespace-nowrap">
                  浪浪家園 PawRescue
                </h1>
                <span className="text-[10px] bg-amber-100 text-amber-900 border border-amber-300 px-2.5 py-0.5 rounded-full font-bold whitespace-nowrap">
                  志工專屬專區
                </span>
              </div>
              <p className="hidden sm:block text-xs text-slate-500 font-sans">線上搶班 &bull; 我的排班日曆 &bull; 出勤簽到 &bull; 晉升成長</p>
            </div>
          </div>

          {/* Quick Action Button for Volunteer */}
          <div className="flex items-center gap-2 shrink-0">
            {openCheckInModal && (
              <button
                onClick={openCheckInModal}
                className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-full text-xs font-bold flex items-center space-x-1.5 shadow-sm transition transform active:scale-95 cursor-pointer whitespace-nowrap"
              >
                <QrCode className="w-4 h-4 shrink-0" />
                <span className="hidden sm:inline">手機掃碼簽到 / 簽退</span>
                <span className="sm:hidden">掃碼簽到</span>
              </button>
            )}

            {openRulebookModal && (
              <button
                onClick={openRulebookModal}
                className="bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 px-3.5 py-2.5 rounded-full text-xs font-bold flex items-center space-x-1.5 shadow-xs transition cursor-pointer whitespace-nowrap shrink-0"
              >
                <BookOpen className="w-4 h-4 text-amber-700" />
                <span className="hidden sm:inline">安全守則 PDF</span>
                <span className="sm:hidden">SOP</span>
              </button>
            )}
          </div>
        </div>

        {/* Volunteer Navigation Tabs */}
        <div className="flex space-x-1 overflow-x-auto pb-2.5 pt-1 border-t border-[#716053] no-scrollbar">
          <button
            onClick={() => setActiveTab('shifts')}
            className={`px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap flex items-center space-x-1.5 transition cursor-pointer ${
              activeTab === 'shifts'
                ? 'bg-[#716053] text-white shadow-xs'
                : 'text-slate-600 hover:bg-[#F5E6D0]/40 hover:text-[#716053]'
            }`}
          >
            <Calendar className="w-4 h-4 text-amber-300" />
            <span>1. 職位與班次時間表 (排班月曆與搶班)</span>
          </button>

          <button
            onClick={() => setActiveTab('myshifts')}
            className={`px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap flex items-center space-x-1.5 transition relative cursor-pointer ${
              activeTab === 'myshifts'
                ? 'bg-[#716053] text-white shadow-xs'
                : 'text-slate-600 hover:bg-[#F5E6D0]/40 hover:text-[#716053]'
            }`}
          >
            <Calendar className="w-4 h-4 text-sky-300" />
            <span>2. 我的排班與出勤紀錄</span>
            {mySignupsCount > 0 && (
              <span className="ml-1 px-2 py-0.5 text-[10px] bg-[#716053] text-white rounded-full font-bold">
                {mySignupsCount}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('growth')}
            className={`px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap flex items-center space-x-1.5 transition cursor-pointer ${
              activeTab === 'growth'
                ? 'bg-[#716053] text-white shadow-xs'
                : 'text-slate-600 hover:bg-[#F5E6D0]/40 hover:text-[#716053]'
            }`}
          >
            <TrendingUp className="w-4 h-4 text-amber-300" />
            <span>3. 志工成長晉升歷程</span>
          </button>

          <button
            onClick={() => setActiveTab('settings')}
            className={`px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap flex items-center space-x-1.5 transition cursor-pointer ${
              activeTab === 'settings'
                ? 'bg-[#716053] text-white shadow-xs'
                : 'text-slate-600 hover:bg-[#F5E6D0]/40 hover:text-[#716053]'
            }`}
          >
            <Settings className="w-4 h-4 text-purple-300" />
            <span>4. LINE 通知與個人設定</span>
          </button>

          <button
            onClick={() => setActiveTab('sop')}
            className={`px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap flex items-center space-x-1.5 transition cursor-pointer ${
              activeTab === 'sop'
                ? 'bg-[#716053] text-white shadow-xs'
                : 'text-slate-600 hover:bg-[#F5E6D0]/40 hover:text-[#716053]'
            }`}
          >
            <BookOpen className="w-4 h-4 text-emerald-300" />
            <span>5. 園區安全守則與 SOP</span>
          </button>
        </div>
      </div>
    </header>
  );
};
