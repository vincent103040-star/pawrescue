import React, { useState, useRef, useEffect } from 'react';
import { PawPrint, Shield, Heart, Sparkles, Calendar, MapPin, MessageSquare, CheckCircle2, ArrowRight, User, Phone, Users, ShieldCheck, Award, QrCode, BookOpen, Clock, HeartHandshake, ChevronRight, Check, Smartphone, KeyRound, Star, Quote, Home } from 'lucide-react';
import { BranchId, AdminUserSession, VolunteerUserSession } from '../types';
import { GooglePhoneAuthModal } from './GooglePhoneAuthModal';

interface LoginPortalProps {
  onLoginAsAdmin: (admin: AdminUserSession) => void;
  onLoginAsVolunteer: (volunteer: VolunteerUserSession) => void;
  pendingApplicationsCount: number;
  openShiftsCount: number;
  totalVolunteersCount: number;
  totalServiceHours: number;
}

// Real quotes pulled from the volunteer service-feedback records (see mockData.ts
// INITIAL_ATTENDANCE_RECORDS) — shown here as short testimonials rather than fabricated copy.
const VOLUNTEER_TESTIMONIALS = [
  {
    name: '王嘉偉',
    role: '貓舍區志工',
    avatar: 'https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?auto=format&fit=crop&w=200&q=80',
    quote: '社工說明非常清晰，貓咪環境通風又乾淨！每次來都覺得毛孩們被照顧得很好。',
    rating: 5
  },
  {
    name: '張志豪',
    role: '醫療隔離區資深志工',
    avatar: 'https://images.unsplash.com/photo-1450778869180-41d0601e046e?auto=format&fit=crop&w=200&q=80',
    quote: '獸醫師跟護理師帶得很好，衛教流程很完整，看著牠們一天天恢復，很有成就感。',
    rating: 5
  },
  {
    name: '林哲銘',
    role: '幼犬育幼志工',
    avatar: 'https://images.unsplash.com/photo-1601979031925-424e53b6caaa?auto=format&fit=crop&w=200&q=80',
    quote: '小狗超級可愛！每一次餵奶陪伴，都覺得自己也被療癒了，體驗滿分！',
    rating: 5
  }
];

// Fictional demo success stories tied to real mock volunteers — represents the kind of
// outcome the volunteer/adoption-matching flow is meant to produce. Swap in real cases
// once the shelter starts recording confirmed adoptions.
const ADOPTION_SUCCESS_STORIES = [
  {
    petName: '小黑',
    photo: 'https://images.unsplash.com/photo-1552053831-71594a27632d?auto=format&fit=crop&w=500&q=80',
    caredBy: ['陳美玲', '王嘉偉', '林哲銘'],
    story: '曾經怕生躲在籠子深處，經過三位志工接力每週的耐心陪伴，學會了對人搖尾巴。2026 年 6 月，牠在新店找到了願意天天帶牠散步的家人。'
  },
  {
    petName: '豆花',
    photo: 'https://images.unsplash.com/photo-1517423440428-a5a00ad493e8?auto=format&fit=crop&w=500&q=80',
    caredBy: ['王嘉偉', '陳美玲'],
    story: '入園時營養不良、對人充滿戒心。志工們天天輪班報到餵食梳毛，半年後親人指數大躍進，現在是淡水一戶人家的窗邊小霸王。'
  },
  {
    petName: '奶茶',
    photo: 'https://images.unsplash.com/photo-1601979031925-424e53b6caaa?auto=format&fit=crop&w=500&q=80',
    caredBy: ['林哲銘', '張志豪', '王嘉偉', '陳美玲'],
    story: '幼犬時期由四位志工輪班泡奶照顧，健康長大後個性活潑親人，領養家庭說牠是全家人每天最期待見到的笑臉。'
  },
  {
    petName: '灰灰 & 小玉',
    photo: 'https://images.unsplash.com/photo-1450778869180-41d0601e046e?auto=format&fit=crop&w=500&q=80',
    caredBy: ['張志豪', '林哲銘'],
    story: '一貓一狗從小一起長大、形影不離，志工協助社工找到願意「一起領養」的家庭，牠們至今仍是彼此最好的朋友。'
  }
];

export const LoginPortal: React.FC<LoginPortalProps> = ({
  onLoginAsAdmin,
  onLoginAsVolunteer,
  pendingApplicationsCount,
  openShiftsCount,
  totalVolunteersCount,
  totalServiceHours
}) => {
  // Admin custom login state
  const [adminName, setAdminName] = useState('蔡督導');
  const [adminRoleTitle, setAdminRoleTitle] = useState('園區總督導 (系統管理員)');
  const [adminBranch, setAdminBranch] = useState<BranchId | 'all'>('all');

  // Lightweight cursor-follow paw icon, scoped only to the adoption success wall —
  // a single tracked element (not a per-mousemove DOM/canvas trail), so it stays cheap
  // even with real network-loaded photos. Skipped entirely if the user prefers reduced motion.
  const [pawPos, setPawPos] = useState<{ x: number; y: number } | null>(null);
  const prefersReducedMotionRef = useRef(false);
  useEffect(() => {
    prefersReducedMotionRef.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);
  const handleSuccessWallMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (prefersReducedMotionRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setPawPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  // Volunteer Google Auth Modal state
  const [showGoogleAuthModal, setShowGoogleAuthModal] = useState(false);
  const [modalInitialGoogleData, setModalInitialGoogleData] = useState<{
    email: string;
    name: string;
    phone: string;
  }>({
    email: 'xiaoming@gmail.com',
    name: '林小明',
    phone: '0912-345-678'
  });

  // Preset quick logins
  const handleQuickAdminLogin = (name: string, roleTitle: string, branch: BranchId | 'all' = 'all') => {
    onLoginAsAdmin({
      name,
      roleTitle,
      email: `${name === '蔡督導' ? 'tsai' : 'chen'}@pawrescue.org.tw`,
      branchId: branch
    });
  };

  const handleOpenGoogleAuth = (name: string = '熱血志工', email: string = 'vincent103040@gmail.com', phone: string = '0912-345-678') => {
    setModalInitialGoogleData({ name, email, phone });
    setShowGoogleAuthModal(true);
  };

  return (
    <div className="min-h-screen bg-[#f5f5f0] text-[#333333] flex flex-col justify-between selection:bg-[#E6E2D3] selection:text-[#5A5A40]">
      
      {/* Top Header Bar */}
      <header className="bg-white border-b border-[#5A5A40]/15 py-4 px-6 sm:px-10 sticky top-0 z-30 shadow-2xs">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-11 h-11 rounded-2xl bg-[#5A5A40] text-white flex items-center justify-center shadow-xs">
              <PawPrint className="w-6 h-6 text-white" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h1 className="text-xl font-bold font-serif italic text-[#5A5A40] tracking-tight">
                  浪浪家園 PawRescue
                </h1>
                <span className="text-[10px] bg-[#E6E2D3] text-[#5A5A40] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">
                  身分登入門戶
                </span>
              </div>
              <p className="text-xs text-slate-500 font-sans">流浪動物之家 &bull; 志工招募與排班管理雙軌系統</p>
            </div>
          </div>

          <div className="hidden md:flex items-center space-x-6 text-xs text-slate-600 font-sans">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="font-semibold text-slate-700">Google 地圖 / 日曆串聯</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
              <span className="font-semibold text-slate-700">LINE 官方帳號連線中</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8 sm:py-12 space-y-10">
        
        {/* Welcome Hero Banner — warm photo storytelling */}
        <div
          className="relative rounded-[32px] overflow-hidden shadow-lg max-w-5xl mx-auto h-72 sm:h-96 flex items-end"
          style={{
            backgroundImage: `linear-gradient(to top, rgba(20,20,10,0.88), rgba(20,20,10,0.35) 55%, rgba(20,20,10,0.05)), url('https://images.unsplash.com/photo-1548199973-03cce0bbc87b?auto=format&fit=crop&w=1600&q=80')`,
            backgroundSize: 'cover',
            backgroundPosition: 'center'
          }}
        >
          <div className="p-6 sm:p-10 space-y-3 text-white max-w-2xl">
            <div className="inline-flex items-center gap-2 bg-white/15 backdrop-blur-xs text-white px-4 py-1.5 rounded-full text-xs font-extrabold border border-white/25">
              <Sparkles className="w-4 h-4 text-amber-300" />
              <span>為浪浪找到回家的路 &bull; 志工招募中</span>
            </div>
            <h2 className="text-2xl sm:text-4xl font-serif font-bold tracking-tight leading-snug drop-shadow-sm">
              每一次陪伴，都是牠們重獲新生的起點 🐾
            </h2>
            <p className="text-xs sm:text-sm text-white/90 font-sans leading-relaxed">
              謝謝每一位曾經蹲下來，摸摸牠們頭的你。這裡是專屬志工夥伴與社工督導的家，一起用行動延續更多溫暖故事。
            </p>
            <div className="flex flex-wrap gap-4 pt-1 text-xs font-sans font-bold">
              <span className="flex items-center gap-1.5">
                <Users className="w-4 h-4 text-amber-300" />
                <span>{totalVolunteersCount} 位志工夥伴正在守護</span>
              </span>
              <span className="flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-amber-300" />
                <span>累積 {totalServiceHours} 小時溫暖陪伴</span>
              </span>
            </div>
          </div>
        </div>

        {/* Live System Stats Ticker */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5 max-w-4xl mx-auto">
          <div className="bg-white p-3.5 rounded-2xl border border-[#5A5A40]/12 text-center shadow-2xs">
            <div className="text-lg font-extrabold text-[#5A5A40]">{openShiftsCount}</div>
            <div className="text-[11px] text-slate-500 font-medium">全院區開放預約班次</div>
          </div>
          <div className="bg-white p-3.5 rounded-2xl border border-[#5A5A40]/12 text-center shadow-2xs">
            <div className="text-lg font-extrabold text-rose-600">{pendingApplicationsCount}</div>
            <div className="text-[11px] text-slate-500 font-medium">待審核志工報名名單</div>
          </div>
          <div className="bg-white p-3.5 rounded-2xl border border-[#5A5A40]/12 text-center shadow-2xs">
            <div className="text-lg font-extrabold text-emerald-700">{totalVolunteersCount}</div>
            <div className="text-[11px] text-slate-500 font-medium">人才庫註冊志工夥伴</div>
          </div>
          <div className="bg-white p-3.5 rounded-2xl border border-[#5A5A40]/12 text-center shadow-2xs">
            <div className="text-lg font-extrabold text-sky-700">3 據點</div>
            <div className="text-[11px] text-slate-500 font-medium">新店本館 / 淡水 / 陽明山</div>
          </div>
        </div>

        {/* Volunteer Testimonials — real quotes, so the login page carries their voice */}
        <div className="max-w-5xl mx-auto space-y-4">
          <div className="text-center space-y-1">
            <h3 className="text-lg font-bold font-serif italic text-slate-900">志工們，怎麼說 💬</h3>
            <p className="text-xs text-slate-500">來自服務回饋紀錄的真實心得</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {VOLUNTEER_TESTIMONIALS.map((t, idx) => (
              <div key={idx} className="bg-white rounded-[24px] border border-[#5A5A40]/12 p-5 shadow-2xs space-y-3">
                <Quote className="w-5 h-5 text-amber-400 fill-amber-200" />
                <p className="text-xs text-slate-700 leading-relaxed">{t.quote}</p>
                <div className="flex items-center gap-2.5 pt-1 border-t border-[#5A5A40]/10">
                  <img
                    src={t.avatar}
                    alt=""
                    className="w-9 h-9 rounded-full object-cover border-2 border-white shadow-xs"
                  />
                  <div className="overflow-hidden">
                    <div className="text-xs font-bold text-slate-900 truncate">{t.name}</div>
                    <div className="text-[10px] text-slate-500 truncate">{t.role}</div>
                  </div>
                  <div className="ml-auto flex items-center gap-0.5 shrink-0">
                    {Array.from({ length: t.rating }).map((_, i) => (
                      <Star key={i} className="w-3 h-3 text-amber-400 fill-amber-400" />
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Adoption Success Wall — photos represent the outcome volunteering leads to */}
        <div className="max-w-5xl mx-auto space-y-4">
          <div className="text-center space-y-1">
            <h3 className="text-lg font-bold font-serif italic text-slate-900">領養成功牆 🏠</h3>
            <p className="text-xs text-slate-500">每一位志工的陪伴，都在為牠們鋪一條回家的路</p>
          </div>
          <div
            className="relative grid grid-cols-2 sm:grid-cols-4 gap-4"
            onMouseMove={handleSuccessWallMouseMove}
            onMouseLeave={() => setPawPos(null)}
          >
            {pawPos && (
              <div
                className="pointer-events-none absolute z-20 text-xl transition-[left,top] duration-150 ease-out select-none"
                style={{ left: pawPos.x - 12, top: pawPos.y - 12 }}
              >
                🐾
              </div>
            )}

            {ADOPTION_SUCCESS_STORIES.map((s, idx) => (
              <div
                key={idx}
                className="group relative rounded-[20px] overflow-hidden aspect-[4/5] shadow-2xs border border-[#5A5A40]/10"
              >
                <img
                  src={s.photo}
                  alt={s.petName}
                  className="w-full h-full object-cover transition duration-300 group-hover:scale-105"
                />
                {/* Always-visible bottom label */}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent p-3 pt-8">
                  <div className="flex items-center gap-1 text-[10px] font-extrabold text-emerald-300">
                    <Home className="w-3 h-3" />
                    <span>已找到永遠的家</span>
                  </div>
                  <div className="text-white font-bold text-sm font-serif">{s.petName}</div>
                  <div className="flex items-center gap-1 text-[10px] text-white/80 mt-0.5">
                    <Users className="w-3 h-3" />
                    <span>{s.caredBy.length} 位志工接力守護過牠</span>
                  </div>
                </div>
                {/* Hover-reveal story */}
                <div className="absolute inset-0 bg-black/80 backdrop-blur-xs p-4 flex flex-col justify-center opacity-0 group-hover:opacity-100 transition duration-300">
                  <p className="text-[11px] text-white/95 leading-relaxed">{s.story}</p>
                  <div className="mt-2.5 space-y-1">
                    <p className="text-[9px] text-white/60 font-bold uppercase tracking-wider">陪伴過牠的志工</p>
                    <div className="flex flex-wrap gap-1">
                      {s.caredBy.map((name, i) => (
                        <span
                          key={i}
                          className="text-[10px] font-bold text-amber-200 bg-amber-500/20 border border-amber-400/30 px-2 py-0.5 rounded-full"
                        >
                          {name}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Two Major Identity Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 max-w-5xl mx-auto items-stretch">
          
          {/* Card 1: 管理者 / 社工人員 (Manager / Admin Guide) */}
          <div className="bg-white rounded-[32px] border-2 border-[#5A5A40]/25 p-7 sm:p-9 shadow-md flex flex-col justify-between space-y-6 relative overflow-hidden transition duration-300 hover:border-[#5A5A40] hover:shadow-xl group">
            
            {/* Top Tag & Header */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="bg-[#5A5A40] text-white text-xs font-extrabold px-3.5 py-1.5 rounded-full flex items-center gap-1.5 shadow-xs">
                  <ShieldCheck className="w-4 h-4 text-[#E6E2D3]" />
                  <span>第一種身分 &bull; 管理端</span>
                </span>
                <span className="text-xs text-slate-400 font-medium">Admin & Staff</span>
              </div>

              <div>
                <h3 className="text-2xl font-bold font-serif italic text-slate-900 group-hover:text-[#5A5A40] transition">
                  管理者 / 社工督導人員
                </h3>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  專為園區主管、招募社工與值日組長打造的後台總控制台。
                </p>
              </div>

              {/* Function Features List */}
              <div className="bg-[#f5f5f0] p-4.5 rounded-2xl border border-[#5A5A40]/10 space-y-2.5 text-xs text-slate-700 font-sans">
                <div className="font-bold text-[#5A5A40] mb-1 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>後台專有功能清單：</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#5A5A40] mt-1.5 shrink-0"></span>
                  <span><strong>缺工統計預警看板</strong>：各場域即時人力、缺工熱點地圖、當日值日生任務板</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#5A5A40] mt-1.5 shrink-0"></span>
                  <span><strong>職位與班次發布</strong>：AI 一鍵生成招募貼文、AI 智慧自動配對排班</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#5A5A40] mt-1.5 shrink-0"></span>
                  <span><strong>報名與審核流程</strong>：時段衝突即時預警、錄取推播 LINE 與日曆</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#5A5A40] mt-1.5 shrink-0"></span>
                  <span><strong>地圖 / 日曆 / LINE 串聯</strong>：三方 API 同步中心與 LINE 圖文選單</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#5A5A40] mt-1.5 shrink-0"></span>
                  <span><strong>志工人才庫名冊</strong>：志工等級維護、服務時數紀錄、月度排班報表匯出</span>
                </div>
              </div>
            </div>

            {/* Quick Demo Logins & Login Action */}
            <div className="space-y-4 pt-2 border-t border-[#5A5A40]/10">
              <div className="space-y-2">
                <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  快速以預設社工身分進入：
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => handleQuickAdminLogin('蔡督導', '園區總督導 (系統管理員)', 'all')}
                    className="p-2.5 rounded-xl border border-[#5A5A40]/20 bg-white hover:bg-[#E6E2D3]/30 text-left transition cursor-pointer flex items-center gap-2 shadow-2xs"
                  >
                    <div className="w-8 h-8 rounded-lg bg-[#5A5A40] text-white flex items-center justify-center text-xs font-bold shrink-0">
                      蔡
                    </div>
                    <div className="overflow-hidden">
                      <div className="text-xs font-bold text-slate-900 truncate">蔡督導</div>
                      <div className="text-[10px] text-slate-500 truncate">總督導 &bull; 全區</div>
                    </div>
                  </button>

                  <button
                    onClick={() => handleQuickAdminLogin('陳社工', '志工招募組長', 'main')}
                    className="p-2.5 rounded-xl border border-[#5A5A40]/20 bg-white hover:bg-[#E6E2D3]/30 text-left transition cursor-pointer flex items-center gap-2 shadow-2xs"
                  >
                    <div className="w-8 h-8 rounded-lg bg-emerald-700 text-white flex items-center justify-center text-xs font-bold shrink-0">
                      陳
                    </div>
                    <div className="overflow-hidden">
                      <div className="text-xs font-bold text-slate-900 truncate">陳社工</div>
                      <div className="text-[10px] text-slate-500 truncate">招募組長 &bull; 本館</div>
                    </div>
                  </button>
                </div>
              </div>

              {/* Main Enter Button */}
              <button
                onClick={() => handleQuickAdminLogin(adminName, adminRoleTitle, adminBranch)}
                className="w-full py-3.5 bg-[#5A5A40] hover:bg-[#484833] text-white font-extrabold rounded-2xl text-xs shadow-md transition flex items-center justify-center gap-2 cursor-pointer transform group-hover:scale-[1.01]"
              >
                <Shield className="w-4 h-4 text-[#E6E2D3]" />
                <span>進入管理者 / 社工督導控制台</span>
                <ArrowRight className="w-4 h-4 text-[#E6E2D3]" />
              </button>
            </div>

          </div>

          {/* Card 2: 志工夥伴 (Volunteer Guide) */}
          <div className="bg-white rounded-[32px] border-2 border-amber-300/80 p-7 sm:p-9 shadow-md flex flex-col justify-between space-y-6 relative overflow-hidden transition duration-300 hover:border-amber-500 hover:shadow-xl group">
            
            {/* Top Tag & Header */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="bg-amber-600 text-white text-xs font-extrabold px-3.5 py-1.5 rounded-full flex items-center gap-1.5 shadow-xs">
                  <HeartHandshake className="w-4 h-4 text-amber-100" />
                  <span>第二種身分 &bull; 志工端</span>
                </span>
                <span className="text-xs text-slate-400 font-medium">Volunteer Guide</span>
              </div>

              <div>
                <h3 className="text-2xl font-bold font-serif italic text-slate-900 group-hover:text-amber-700 transition">
                  志工夥伴專屬服務平台
                </h3>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  專為熱心志工夥伴量身打造的預約搶班、出勤簽到與成長歷程門戶。
                </p>
              </div>

              {/* Function Features List */}
              <div className="bg-amber-50/60 p-4.5 rounded-2xl border border-amber-200/60 space-y-2.5 text-xs text-slate-700 font-sans">
                <div className="font-bold text-amber-900 mb-1 flex items-center gap-1.5">
                  <Heart className="w-4 h-4 text-rose-500 fill-rose-500" />
                  <span>志工專屬功能清單：</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-600 mt-1.5 shrink-0"></span>
                  <span><strong>班次瀏覽與線上搶班</strong>：貓舍、大狗散步、幼犬育幼、醫療區一鍵登記</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-600 mt-1.5 shrink-0"></span>
                  <span><strong>我的排班與出勤紀錄</strong>：審核進度、日曆排程對齊、服務時數與評價回饋</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-600 mt-1.5 shrink-0"></span>
                  <span><strong>志工成長晉升歷程</strong>：實習 ➔ 正式 ➔ 資深志工考核清單與達標通知</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-600 mt-1.5 shrink-0"></span>
                  <span><strong>LINE 通知與個人偏好</strong>：自訂班次異動、急召推播、簽到通知時間</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-600 mt-1.5 shrink-0"></span>
                  <span><strong>志工安全守則與園區 SOP</strong>：犬貓接觸防護規範、出勤 QR 簽到/簽退</span>
                </div>
              </div>
            </div>

            {/* Google Authentication & Volunteer Sign-In Section */}
            <div className="space-y-3 pt-2 border-t border-amber-200/60">
              
              {/* Google Sign-in Section Header */}
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-bold text-slate-700 flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                  </svg>
                  <span>Google 帳號登入 (真實 OAuth 授權)：</span>
                </div>
                <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-full border border-emerald-200 flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3 text-emerald-600" />
                  <span>Google 帳號驗證通過始得放行</span>
                </span>
              </div>

              {/* Main Mandatory Google Sign-In Trigger */}
              <button
                type="button"
                onClick={() => handleOpenGoogleAuth('志工夥伴', 'vincent103040@gmail.com', '0912-345-678')}
                className="w-full py-4 bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-700 hover:to-amber-800 text-white font-extrabold rounded-2xl text-sm shadow-md hover:shadow-lg transition flex items-center justify-center gap-3 cursor-pointer transform hover:scale-[1.01] active:scale-95"
              >
                <div className="w-7 h-7 rounded-full bg-white flex items-center justify-center shrink-0 shadow-xs">
                  <svg className="w-4 h-4" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                  </svg>
                </div>
                <span>使用 Google 帳號登入</span>
                <ArrowRight className="w-4 h-4 text-amber-200" />
              </button>

              <div className="p-2.5 rounded-xl bg-amber-50/70 border border-amber-200/60 text-center">
                <p className="text-[11px] text-amber-900 leading-tight">
                  🔒 <strong>實名安全規範</strong>：必須通過真實 Google 帳號授權並登記聯絡電話，後台審核通過方可進入志工專屬平台。
                </p>
              </div>

            </div>

          </div>

        </div>

        {/* System Architecture Feature Overview */}
        <div className="bg-white rounded-[28px] p-6 sm:p-8 border border-[#5A5A40]/12 shadow-xs max-w-5xl mx-auto space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#5A5A40]/10 pb-3">
            <h4 className="font-bold font-serif text-slate-900 text-base flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-amber-600" />
              <span>雙軌介面獨立設計 &bull; 資料與通知全自動即時同步</span>
            </h4>
            <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200">
              ● 實時雙向連動中
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-xs font-sans">
            <div className="bg-[#f5f5f0] p-3.5 rounded-2xl border border-[#5A5A40]/10 space-y-1.5">
              <div className="font-bold text-[#5A5A40] flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-[#5A5A40] text-white flex items-center justify-center text-[10px]">1</span>
                <span>志工端一鍵搶班</span>
              </div>
              <p className="text-slate-600 text-[11px] leading-relaxed">
                志工在專區選取班次並送出報名，填寫之基本資料將自動紀錄於本地儲存。
              </p>
            </div>

            <div className="bg-[#f5f5f0] p-3.5 rounded-2xl border border-[#5A5A40]/10 space-y-1.5">
              <div className="font-bold text-[#5A5A40] flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-[#5A5A40] text-white flex items-center justify-center text-[10px]">2</span>
                <span>管理者即時審核</span>
              </div>
              <p className="text-slate-600 text-[11px] leading-relaxed">
                社工在管理端審核名單，自動防範時段衝突，通過時自動增減該班次缺額。
              </p>
            </div>

            <div className="bg-[#f5f5f0] p-3.5 rounded-2xl border border-[#5A5A40]/10 space-y-1.5">
              <div className="font-bold text-[#5A5A40] flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-[#5A5A40] text-white flex items-center justify-center text-[10px]">3</span>
                <span>日曆與地圖串聯</span>
              </div>
              <p className="text-slate-600 text-[11px] leading-relaxed">
                錄取後行程可一鍵同步 Google 日曆，出勤時點擊可喚醒 Google Maps 路線導航。
              </p>
            </div>

            <div className="bg-[#f5f5f0] p-3.5 rounded-2xl border border-[#5A5A40]/10 space-y-1.5">
              <div className="font-bold text-[#5A5A40] flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-[#5A5A40] text-white flex items-center justify-center text-[10px]">4</span>
                <span>出勤簽到與成長</span>
              </div>
              <p className="text-slate-600 text-[11px] leading-relaxed">
                志工到場手機掃碼簽到/簽退，時數自動累加，考核達標自動通報管理員核發徽章。
              </p>
            </div>
          </div>
        </div>

      </main>

      {/* Google & Phone Credential Link Verification Modal */}
      {showGoogleAuthModal && (
        <GooglePhoneAuthModal
          initialEmail={modalInitialGoogleData.email}
          initialName={modalInitialGoogleData.name}
          initialPhone={modalInitialGoogleData.phone}
          onClose={() => setShowGoogleAuthModal(false)}
          onSuccessLogin={(volunteer) => {
            setShowGoogleAuthModal(false);
            onLoginAsVolunteer(volunteer);
          }}
        />
      )}

      {/* Footer */}
      <footer className="bg-[#5A5A40] text-white/80 py-6 text-center text-xs border-t border-[#5A5A40]/20 space-y-2">
        <p className="text-amber-200/90 italic font-serif text-xs">
          「謝謝你，讓我們相信，每一隻浪浪都值得被溫柔對待。」 —— 來自浪浪家園全體毛孩
        </p>
        <p className="font-semibold text-white tracking-wide font-serif italic text-sm">
          🐾 浪浪家園 PawRescue &bull; 流浪動物之家 志工招募與人力資源管理系統
        </p>
        <p className="mt-1 text-white/60 text-[11px] font-sans">
          雙軌獨立介面：管理者 / 社工人員 (Admin Guide) &bull; 志工夥伴 (Volunteer Guide)
        </p>
      </footer>

    </div>
  );
};
