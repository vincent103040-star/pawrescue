import React, { useState } from 'react';
import { PositionShift, VolunteerApplication, Branch, AttendanceRecord, VolunteerUserSession } from '../types';
import { ZONE_CONFIGS } from '../data/mockData';
import { Calendar, Clock, MapPin, CheckCircle2, AlertCircle, QrCode, Star, ArrowUpRight, Award, ExternalLink, ShieldCheck, Heart, FileText, Check, ChevronRight } from 'lucide-react';
import { CertificateModal } from './CertificateModal';
import { buildGoogleCalendarLink } from '../utils/googleCalendar';

interface VolunteerMyShiftsProps {
  shifts: PositionShift[];
  applications: VolunteerApplication[];
  branches: Branch[];
  attendanceRecords: AttendanceRecord[];
  currentUser: VolunteerUserSession | null;
  onOpenCheckInModal: () => void;
  onSendLineToast: (msg: string) => void;
  onCancelApplication?: (appId: string) => void;
}

export const VolunteerMyShifts: React.FC<VolunteerMyShiftsProps> = ({
  shifts,
  applications,
  branches,
  attendanceRecords,
  currentUser,
  onOpenCheckInModal,
  onSendLineToast,
  onCancelApplication
}) => {
  const [cancelConfirmAppId, setCancelConfirmAppId] = useState<string | null>(null);
  const [activeSubTab, setActiveSubTab] = useState<'all' | 'upcoming' | 'completed' | 'pending'>('all');
  const [showCertificateModal, setShowCertificateModal] = useState(false);

  const vName = currentUser?.name || localStorage.getItem('volunteer_profile_name') || '林小明';
  const volunteerName = vName;
  const vEmail = currentUser?.email || localStorage.getItem('volunteer_profile_email') || 'xiaoming@gmail.com';
  const vPhone = currentUser?.phone || localStorage.getItem('volunteer_profile_phone') || '0912-345-678';
  const vLineId = currentUser?.lineId || localStorage.getItem('volunteer_profile_lineid') || 'xiaoming_line';

  // Filter applications belonging to this volunteer
  const myApplications = applications.filter(a => 
    (a.volunteerName && a.volunteerName.trim().toLowerCase() === vName.trim().toLowerCase()) ||
    (a.volunteerEmail && a.volunteerEmail.trim().toLowerCase() === vEmail.trim().toLowerCase()) ||
    (a.volunteerPhone && a.volunteerPhone.trim() === vPhone.trim()) ||
    (a.lineId && a.lineId.trim() === vLineId.trim())
  );

  // Filter attendance records belonging to this volunteer
  const myAttendance = attendanceRecords.filter(r =>
    (r.volunteerName && r.volunteerName.trim().toLowerCase() === vName.trim().toLowerCase()) ||
    (vPhone && r.volunteerPhone && r.volunteerPhone.trim() === vPhone.trim()) ||
    (vLineId && r.lineId && r.lineId.trim() === vLineId.trim())
  );

  const completedAttendance = myAttendance.filter(r => r.status === 'completed');
  const totalCompletedHours = completedAttendance.reduce((acc, r) => acc + (r.hoursLogged || 3), 0) + (currentUser?.totalHours || 0);

  const approvedApps = myApplications.filter(a => a.status === 'approved');
  const pendingApps = myApplications.filter(a => a.status === 'pending');

  const filteredApps = myApplications.filter(app => {
    if (activeSubTab === 'upcoming') return app.status === 'approved';
    if (activeSubTab === 'completed') return app.status === 'attended';
    if (activeSubTab === 'pending') return app.status === 'pending';
    return true;
  });

  return (
    <div className="space-y-8 py-6 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto font-sans">
      
      {/* Header Banner */}
      <div className="bg-white rounded-[32px] p-6 sm:p-8 border border-[#5A5A40]/15 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 bg-amber-100 text-amber-900 px-3 py-1 rounded-full text-xs font-extrabold border border-amber-300">
            <Calendar className="w-3.5 h-3.5 text-amber-700" />
            <span>志工專屬 &bull; 個人排班與服務歷程</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-serif italic text-slate-900 font-bold">
            {volunteerName} 志工的服務清單 🐾
          </h2>
          <p className="text-xs text-slate-600 font-sans">
            即時追蹤您的報名審核進度、待出勤班次路線導航，以及累積的志工服務時數與評價。
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 self-start md:self-auto">
          <button
            onClick={onOpenCheckInModal}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold px-5 py-2.5 rounded-full text-xs shadow-xs transition flex items-center gap-2 cursor-pointer"
          >
            <QrCode className="w-4 h-4" />
            <span>現場 QR 簽到 / 簽退</span>
          </button>

          <button
            onClick={() => setShowCertificateModal(true)}
            className="bg-[#5A5A40] hover:bg-[#484833] text-white font-extrabold px-5 py-2.5 rounded-full text-xs shadow-xs transition flex items-center gap-2 cursor-pointer"
          >
            <Award className="w-4 h-4 text-amber-300" />
            <span>匯出服務證明 PDF</span>
          </button>
        </div>
      </div>

      {/* Summary Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-[24px] border border-[#5A5A40]/12 shadow-2xs space-y-1">
          <div className="text-xs text-slate-500 font-semibold flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-[#5A5A40]" />
            <span>累計服務總時數</span>
          </div>
          <div className="text-2xl font-extrabold text-[#5A5A40]">
            {totalCompletedHours} <span className="text-xs font-bold text-slate-600">小時</span>
          </div>
          <div className="text-[11px] text-emerald-700 font-bold flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" /> 已獲園區認證時數
          </div>
        </div>

        <div className="bg-white p-5 rounded-[24px] border border-[#5A5A40]/12 shadow-2xs space-y-1">
          <div className="text-xs text-slate-500 font-semibold flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span>即將出勤 (已錄取)</span>
          </div>
          <div className="text-2xl font-extrabold text-emerald-700">
            {approvedApps.length} <span className="text-xs font-bold text-slate-600">班次</span>
          </div>
          <div className="text-[11px] text-slate-500 font-medium">已同步至 Google 日曆</div>
        </div>

        <div className="bg-white p-5 rounded-[24px] border border-[#5A5A40]/12 shadow-2xs space-y-1">
          <div className="text-xs text-slate-500 font-semibold flex items-center gap-1.5">
            <AlertCircle className="w-4 h-4 text-amber-600" />
            <span>審核中志工報名</span>
          </div>
          <div className="text-2xl font-extrabold text-amber-700">
            {pendingApps.length} <span className="text-xs font-bold text-slate-600">筆</span>
          </div>
          <div className="text-[11px] text-slate-500 font-medium">社工督導審查中</div>
        </div>

        <div className="bg-white p-5 rounded-[24px] border border-[#5A5A40]/12 shadow-2xs space-y-1">
          <div className="text-xs text-slate-500 font-semibold flex items-center gap-1.5">
            <Award className="w-4 h-4 text-amber-600" />
            <span>目前志工位階</span>
          </div>
          <div className="text-2xl font-extrabold text-slate-900">
            {currentUser?.tier || '資深志工'}
          </div>
          <div className="text-[11px] text-amber-800 font-bold">🌟 下一目標：志工隊長</div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-3.5 rounded-[24px] border border-[#5A5A40]/12 shadow-2xs">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveSubTab('all')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
              activeSubTab === 'all'
                ? 'bg-[#5A5A40] text-white shadow-xs'
                : 'text-slate-600 hover:bg-[#f5f5f0]'
            }`}
          >
            全部紀錄 ({myApplications.length})
          </button>

          <button
            onClick={() => setActiveSubTab('upcoming')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
              activeSubTab === 'upcoming'
                ? 'bg-[#5A5A40] text-white shadow-xs'
                : 'text-slate-600 hover:bg-[#f5f5f0]'
            }`}
          >
            即將出勤 ({approvedApps.length})
          </button>

          <button
            onClick={() => setActiveSubTab('pending')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
              activeSubTab === 'pending'
                ? 'bg-[#5A5A40] text-white shadow-xs'
                : 'text-slate-600 hover:bg-[#f5f5f0]'
            }`}
          >
            審核中 ({pendingApps.length})
          </button>

          <button
            onClick={() => setActiveSubTab('completed')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
              activeSubTab === 'completed'
                ? 'bg-[#5A5A40] text-white shadow-xs'
                : 'text-slate-600 hover:bg-[#f5f5f0]'
            }`}
          >
            已完成服務 ({completedAttendance.length})
          </button>
        </div>

        <div className="text-xs text-slate-500 font-semibold px-3">
          共 {filteredApps.length} 筆項目
        </div>
      </div>

      {/* Shifts Application Cards */}
      {filteredApps.length === 0 ? (
        <div className="bg-white rounded-[32px] p-12 text-center border border-[#5A5A40]/15 space-y-4">
          <div className="w-16 h-16 rounded-full bg-[#f5f5f0] text-slate-400 flex items-center justify-center mx-auto">
            <Heart className="w-8 h-8 text-slate-400" />
          </div>
          <h3 className="font-serif font-bold text-slate-800 text-lg">目前尚無此狀態的班次紀錄</h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            您可以切換至「線上搶班」頁面，選擇心儀的園區與時段加入服務隊伍！
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {filteredApps.map(app => {
            const shift = shifts.find(s => s.id === app.shiftId);
            const branch = branches.find(b => b.id === shift?.branchId);
            const zoneConf = shift ? ZONE_CONFIGS[shift.zone] : null;

            return (
              <div
                key={app.id}
                className="bg-white rounded-[28px] p-6 border border-[#5A5A40]/15 shadow-xs space-y-4 flex flex-col justify-between hover:shadow-md transition"
              >
                <div className="space-y-3">
                  
                  {/* Status Badges Header */}
                  <div className="flex items-center justify-between">
                    <span className={`text-xs font-bold px-3 py-1 rounded-full flex items-center gap-1.5 ${zoneConf?.badgeBg || 'bg-slate-100'}`}>
                      <span>{zoneConf?.icon || '🐾'}</span>
                      <span>{zoneConf?.name || '園區照護'}</span>
                    </span>

                    {app.status === 'approved' && (
                      <span className="text-xs font-extrabold px-3 py-1 bg-emerald-100 text-emerald-800 rounded-full flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        <span>已錄取 &bull; 待出勤</span>
                      </span>
                    )}

                    {app.status === 'pending' && (
                      <span className="text-xs font-extrabold px-3 py-1 bg-amber-100 text-amber-800 rounded-full flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-amber-600" />
                        <span>社工審核中</span>
                      </span>
                    )}

                    {app.status === 'attended' && (
                      <span className="text-xs font-extrabold px-3 py-1 bg-sky-100 text-sky-800 rounded-full flex items-center gap-1">
                        <Award className="w-3.5 h-3.5 text-sky-600" />
                        <span>服務已結案 (+3h)</span>
                      </span>
                    )}

                    {app.status === 'rejected' && (
                      <span className="text-xs font-extrabold px-3 py-1 bg-rose-100 text-rose-800 rounded-full">
                        未錄取 (名額額滿)
                      </span>
                    )}
                  </div>

                  {/* Shift Title */}
                  <h3 className="text-lg font-bold font-serif text-slate-900">
                    {shift?.title || '志工排班項目'}
                  </h3>

                  {/* Info Details */}
                  <div className="space-y-2 text-xs text-slate-600 bg-[#f5f5f0] p-4 rounded-2xl border border-[#5A5A40]/10 font-sans">
                    <div className="flex items-center gap-2">
                      <MapPin className="w-4 h-4 text-[#5A5A40] shrink-0" />
                      <span className="font-bold text-slate-900">{branch?.name}</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-[#5A5A40] shrink-0" />
                      <span className="font-bold text-[#5A5A40]">
                        {shift?.date} ({shift?.timeRange})
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-[#5A5A40] shrink-0" />
                      <span>報名登記時間：{app.appliedAt}</span>
                    </div>

                    {app.reviewNotes && (
                      <div className="pt-2 mt-2 border-t border-[#5A5A40]/10 text-slate-700">
                        <strong>社工回覆：</strong> {app.reviewNotes}
                      </div>
                    )}
                  </div>
                </div>

                {/* Bottom Actions */}
                <div className="pt-3 border-t border-[#5A5A40]/10 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-3">
                    {branch?.googleMapsUrl && (
                      <a
                        href={branch.googleMapsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-[#5A5A40] font-bold hover:underline flex items-center gap-1"
                      >
                        <MapPin className="w-3.5 h-3.5" />
                        <span>查看導航</span>
                        <ArrowUpRight className="w-3 h-3" />
                      </a>
                    )}

                    {app.status === 'approved' && shift && (
                      <a
                        href={buildGoogleCalendarLink({
                          title: `🐾 志工班次：${shift.title}`,
                          date: shift.date,
                          timeRange: shift.timeRange,
                          location: shift.locationDetails || branch?.name || '浪浪家園',
                          details: `浪浪家園志工服務班次\n地點：${branch?.name || ''}\n任務：${(shift.tasks || []).join('、')}`
                        })}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-[#5A5A40] font-bold hover:underline flex items-center gap-1"
                      >
                        <Calendar className="w-3.5 h-3.5" />
                        <span>加入 Google 日曆</span>
                        <ArrowUpRight className="w-3 h-3" />
                      </a>
                    )}

                    {(app.status === 'pending' || app.status === 'approved') && onCancelApplication && (
                      cancelConfirmAppId === app.id ? (
                        <div className="flex items-center gap-2 bg-rose-50 border border-rose-200 px-3 py-1.5 rounded-xl animate-fade-in">
                          <span className="text-xs text-rose-800 font-bold">確定取消此班次？</span>
                          <button
                            type="button"
                            onClick={() => {
                              onCancelApplication(app.id);
                              setCancelConfirmAppId(null);
                            }}
                            className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-black shadow-2xs transition cursor-pointer"
                          >
                            確認取消
                          </button>
                          <button
                            type="button"
                            onClick={() => setCancelConfirmAppId(null)}
                            className="px-2 py-1 bg-white hover:bg-slate-100 text-slate-600 rounded-lg text-xs font-bold border border-slate-200 transition cursor-pointer"
                          >
                            保留
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setCancelConfirmAppId(app.id)}
                          className="text-xs text-rose-600 hover:text-rose-800 hover:underline font-bold transition cursor-pointer flex items-center gap-1"
                        >
                          <span>取消報名</span>
                        </button>
                      )
                    )}
                  </div>

                  {app.status === 'approved' && (
                    <button
                      onClick={onOpenCheckInModal}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-full text-xs font-bold shadow-2xs transition flex items-center gap-1.5 cursor-pointer"
                    >
                      <QrCode className="w-3.5 h-3.5" />
                      <span>出勤簽到</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Certificate Modal */}
      {showCertificateModal && (
        <CertificateModal
          volunteer={{
            id: 'vol-my',
            name: volunteerName,
            email: currentUser?.email || 'xiaoming@gmail.com',
            phone: currentUser?.phone || '0912-345-678',
            lineId: currentUser?.lineId || 'xiaoming_line',
            avatar: '',
            skills: ['大型犬牽引放風', '貓房清消', '傷病貓照護'],
            preferredZones: ['dog', 'cat'],
            totalHours: totalCompletedHours,
            completedShiftsCount: Math.max(1, completedAttendance.length + 8),
            tier: currentUser?.tier || '資深志工',
            joinedDate: '2025-06-15',
            emergencyContact: '林媽媽 (0988-111-222)'
          }}
          onClose={() => setShowCertificateModal(false)}
        />
      )}

    </div>
  );
};
