import React, { useState } from 'react';
import { PositionShift, ShiftSignup, ShelterLocation, AttendanceRecord, VolunteerUserSession, SubstitutionRequest } from '../types';
import { ZONE_CONFIGS } from '../data/mockData';
import { Calendar, Clock, MapPin, CheckCircle2, AlertCircle, QrCode, Star, ArrowUpRight, Award, ExternalLink, ShieldCheck, Heart, FileText, Check, ChevronRight, Handshake, XCircle, Undo2 } from 'lucide-react';
import { CertificateModal } from './CertificateModal';
import { ListSkeleton } from './ListSkeleton';
import { buildGoogleCalendarLink } from '../utils/googleCalendar';
import { hoursUntilShift, SUBSTITUTION_NOTICE_HOURS, timeUntilLabel } from '../utils/shiftTime';

interface VolunteerMyShiftsProps {
  shifts: PositionShift[];
  shiftSignups: ShiftSignup[];
  shelterLocation: ShelterLocation;
  attendanceRecords: AttendanceRecord[];
  currentUser: VolunteerUserSession | null;
  onOpenCheckInModal: () => void;
  onSendLineToast: (msg: string) => void;
  onCancelSignup?: (appId: string) => void;
  /** Open substitution requests, so a booking can show that it is already asking for cover. */
  substitutions?: SubstitutionRequest[];
  onRequestSubstitution?: (appId: string, reason: string) => void;
  onWithdrawSubstitution?: (requestId: string) => void;
  /**
   * 初次載入還沒有結果。用來把「還不知道」跟「確定沒有」分開——沒有這個旗標，
   * 資料還在路上時畫面會直接宣告「目前尚無此狀態的班次紀錄」，對一個排了三個
   * 班的志工來說那是假的。
   */
  isLoading?: boolean;
}

export const VolunteerMyShifts: React.FC<VolunteerMyShiftsProps> = ({
  shifts,
  shiftSignups,
  shelterLocation,
  attendanceRecords,
  currentUser,
  onOpenCheckInModal,
  onSendLineToast,
  onCancelSignup,
  substitutions = [],
  onRequestSubstitution,
  onWithdrawSubstitution,
  isLoading = false
}) => {
  const [cancelConfirmAppId, setCancelConfirmAppId] = useState<string | null>(null);
  const [subFormAppId, setSubFormAppId] = useState<string | null>(null);
  const [subReason, setSubReason] = useState('');
  const [activeSubTab, setActiveSubTab] = useState<'all' | 'upcoming' | 'completed' | 'pending'>('all');
  const [showCertificateModal, setShowCertificateModal] = useState(false);

  // Who this page belongs to comes from the signed-in session and nowhere
  // else. These four used to fall back to a demo volunteer -- 林小明,
  // xiaoming@gmail.com, 0912-345-678 -- and that phone number is shared by two
  // of the sample bookings and one of the sample attendance rows, so a
  // volunteer whose session was missing a field was shown another person's
  // pending shifts under their own name.
  const vName = (currentUser?.name || '').trim();
  const volunteerName = vName;
  const vEmail = (currentUser?.email || '').trim().toLowerCase();
  const vPhone = (currentUser?.phone || '').trim();
  const vLineId = (currentUser?.lineId || '').trim();

  // Email is the identity the server issues the session against and scopes
  // /api/shift-signups by, so it is the only thing matched here. A phone
  // number is reformatted on its way through the login (+886912345678 comes
  // back as 0912-345-678) and a name is not unique, so neither can say whose
  // booking this is.
  const mySignups = vEmail
    ? shiftSignups.filter(a => (a.volunteerEmail || '').trim().toLowerCase() === vEmail)
    : [];

  // Attendance rows carry no email, so these still match on the other three --
  // but only against values that came from the session, never invented ones.
  const myAttendance = attendanceRecords.filter(r =>
    (!!vName && (r.volunteerName || '').trim().toLowerCase() === vName.toLowerCase()) ||
    (!!vPhone && (r.volunteerPhone || '').trim() === vPhone) ||
    (!!vLineId && (r.lineId || '').trim() === vLineId)
  );

  const completedAttendance = myAttendance.filter(r => r.status === 'completed');

  // The record on file is the total. The server credits a volunteer's hours
  // when their check-out is confirmed, so every completed shift below is
  // already inside this figure -- summing them again on top counted each shift
  // twice, both here and on the printed service certificate. The stored number
  // is also the only one that includes hours a coordinator logged by hand for
  // work done on paper.
  const totalCompletedHours = currentUser?.totalHours || 0;

  const approvedApps = mySignups.filter(a => a.status === 'approved');
  const pendingApps = mySignups.filter(a => a.status === 'pending');

  const filteredApps = mySignups.filter(app => {
    if (activeSubTab === 'upcoming') return app.status === 'approved';
    if (activeSubTab === 'completed') return app.status === 'attended';
    if (activeSubTab === 'pending') return app.status === 'pending';
    return true;
  });

  return (
    <div className="space-y-8 py-6 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto font-sans">
      
      {/* Header Banner */}
      <div className="bg-white rounded-[32px] p-6 sm:p-8 border border-[#716053] shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-6">
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
            className="bg-[#716053] hover:bg-[#5A4A3F] text-white font-extrabold px-5 py-2.5 rounded-full text-xs shadow-xs transition flex items-center gap-2 cursor-pointer"
          >
            <Award className="w-4 h-4 text-amber-300" />
            <span>匯出服務證明 PDF</span>
          </button>
        </div>
      </div>

      {/* Summary Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-[24px] border border-[#716053] shadow-2xs space-y-1">
          <div className="text-xs text-slate-500 font-semibold flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-[#716053]" />
            <span>累計服務總時數</span>
          </div>
          <div className="text-2xl font-extrabold text-[#716053]">
            {totalCompletedHours} <span className="text-xs font-bold text-slate-600">小時</span>
          </div>
          <div className="text-[11px] text-emerald-700 font-bold flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" /> 已獲園區認證時數
          </div>
        </div>

        <div className="bg-white p-5 rounded-[24px] border border-[#716053] shadow-2xs space-y-1">
          <div className="text-xs text-slate-500 font-semibold flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span>即將出勤 (已錄取)</span>
          </div>
          <div className="text-2xl font-extrabold text-emerald-700">
            {approvedApps.length} <span className="text-xs font-bold text-slate-600">班次</span>
          </div>
          <div className="text-[11px] text-slate-500 font-medium">已同步至 Google 日曆</div>
        </div>

        <div className="bg-white p-5 rounded-[24px] border border-[#716053] shadow-2xs space-y-1">
          <div className="text-xs text-slate-500 font-semibold flex items-center gap-1.5">
            <AlertCircle className="w-4 h-4 text-amber-600" />
            <span>審核中志工報名</span>
          </div>
          <div className="text-2xl font-extrabold text-amber-700">
            {pendingApps.length} <span className="text-xs font-bold text-slate-600">筆</span>
          </div>
          <div className="text-[11px] text-slate-500 font-medium">社工督導審查中</div>
        </div>

        <div className="bg-white p-5 rounded-[24px] border border-[#716053] shadow-2xs space-y-1">
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
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-3.5 rounded-[24px] border border-[#716053] shadow-2xs">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveSubTab('all')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
              activeSubTab === 'all'
                ? 'bg-[#716053] text-white shadow-xs'
                : 'text-slate-600 hover:bg-[#FAF6EE]'
            }`}
          >
            全部紀錄 ({mySignups.length})
          </button>

          <button
            onClick={() => setActiveSubTab('upcoming')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
              activeSubTab === 'upcoming'
                ? 'bg-[#716053] text-white shadow-xs'
                : 'text-slate-600 hover:bg-[#FAF6EE]'
            }`}
          >
            即將出勤 ({approvedApps.length})
          </button>

          <button
            onClick={() => setActiveSubTab('pending')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
              activeSubTab === 'pending'
                ? 'bg-[#716053] text-white shadow-xs'
                : 'text-slate-600 hover:bg-[#FAF6EE]'
            }`}
          >
            審核中 ({pendingApps.length})
          </button>

          <button
            onClick={() => setActiveSubTab('completed')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
              activeSubTab === 'completed'
                ? 'bg-[#716053] text-white shadow-xs'
                : 'text-slate-600 hover:bg-[#FAF6EE]'
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
      {isLoading ? (
        <ListSkeleton count={2} columns={2} />
      ) : filteredApps.length === 0 ? (
        <div className="bg-white rounded-[32px] p-12 text-center border border-[#716053] space-y-4">
          <div className="w-16 h-16 rounded-full bg-[#FAF6EE] text-slate-400 flex items-center justify-center mx-auto">
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
            const zoneConf = shift ? ZONE_CONFIGS[shift.zone] : null;

            return (
              <div
                key={app.id}
                className="bg-white rounded-[28px] p-6 border border-[#716053] shadow-xs space-y-4 flex flex-col justify-between hover:shadow-md transition"
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

                    {app.status === 'cancelled' && (
                      <span className="text-xs font-extrabold px-3 py-1 bg-slate-100 text-slate-600 rounded-full flex items-center gap-1">
                        <XCircle className="w-3.5 h-3.5 text-slate-400" />
                        <span>已取消報名</span>
                      </span>
                    )}

                    {app.status === 'substituted' && (
                      <span className="text-xs font-extrabold px-3 py-1 bg-violet-100 text-violet-800 rounded-full flex items-center gap-1">
                        <Handshake className="w-3.5 h-3.5 text-violet-600" />
                        <span>已由夥伴代班</span>
                      </span>
                    )}

                    {app.status === 'absent' && (
                      <span className="text-xs font-extrabold px-3 py-1 bg-rose-100 text-rose-800 rounded-full flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
                        <span>紀錄為未到場</span>
                      </span>
                    )}
                  </div>

                  {/* Shift Title */}
                  <h3 className="text-lg font-bold font-serif text-slate-900">
                    {shift?.title || '志工排班項目'}
                  </h3>

                  {/* Info Details */}
                  <div className="space-y-2 text-xs text-slate-600 bg-[#FAF6EE] p-4 rounded-2xl border border-[#716053] font-sans">
                    <div className="flex items-center gap-2">
                      <MapPin className="w-4 h-4 text-[#716053] shrink-0" />
                      <span className="font-bold text-slate-900">{shift?.locationDetails}</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-[#716053] shrink-0" />
                      <span className="font-bold text-[#716053]">
                        {shift?.date} ({shift?.timeRange})
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-[#716053] shrink-0" />
                      <span>報名登記時間：{app.appliedAt}</span>
                    </div>

                    {app.reviewNotes && (
                      <div className="pt-2 mt-2 border-t border-[#716053] text-slate-700">
                        <strong>社工回覆：</strong> {app.reviewNotes}
                      </div>
                    )}
                  </div>
                </div>

                {/* Bottom Actions */}
                <div className="pt-3 border-t border-[#716053] flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-3">
                    {shelterLocation.googleMapsUrl && (
                      <a
                        href={shelterLocation.googleMapsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-[#716053] font-bold hover:underline flex items-center gap-1"
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
                          location: shift.locationDetails || '浪浪家園',
                          details: `浪浪家園志工服務班次\n地點：${shift.locationDetails || ''}\n任務：${(shift.tasks || []).join('、')}`
                        })}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-[#716053] font-bold hover:underline flex items-center gap-1"
                      >
                        <Calendar className="w-3.5 h-3.5" />
                        <span>加入 Google 日曆</span>
                        <ArrowUpRight className="w-3 h-3" />
                      </a>
                    )}

                    {app.status === 'approved' && onRequestSubstitution && (() => {
                      const open = substitutions.find(
                        s => s.signupId === app.id && s.status === 'open'
                      );
                      const hours = hoursUntilShift(shift?.date, shift?.timeRange);
                      const past = hours !== null && hours < 0;
                      if (past) return null;

                      if (open) {
                        return (
                          <div className="w-full bg-violet-50 border border-violet-200 rounded-2xl px-3 py-2 flex items-center justify-between gap-2 flex-wrap">
                            <span className="text-xs text-violet-900 font-bold flex items-center gap-1.5">
                              <Handshake className="w-3.5 h-3.5 text-violet-600" />
                              代班請求進行中，等待夥伴接手
                              {open.reason && <span className="font-normal">（{open.reason}）</span>}
                            </span>
                            {onWithdrawSubstitution && (
                              <button
                                type="button"
                                onClick={() => onWithdrawSubstitution(open.id)}
                                className="text-xs text-violet-700 hover:text-violet-900 hover:underline font-bold flex items-center gap-1 cursor-pointer"
                              >
                                <Undo2 className="w-3.5 h-3.5" />
                                <span>我可以來了，撤回</span>
                              </button>
                            )}
                          </div>
                        );
                      }

                      if (subFormAppId === app.id) {
                        return (
                          <div className="w-full bg-violet-50 border border-violet-200 rounded-2xl p-3 space-y-2 animate-fade-in">
                            <label className="text-xs font-bold text-violet-900 block">
                              簡單說明原因（選填，其他夥伴看得到）
                            </label>
                            <input
                              type="text"
                              value={subReason}
                              maxLength={200}
                              onChange={e => setSubReason(e.target.value)}
                              placeholder="例如：家裡臨時有事"
                              className="w-full px-3 py-2 rounded-xl border border-violet-200 text-xs"
                            />
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  onRequestSubstitution(app.id, subReason.trim());
                                  setSubFormAppId(null);
                                  setSubReason('');
                                }}
                                className="px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-xs font-black transition cursor-pointer"
                              >
                                送出代班請求
                              </button>
                              <button
                                type="button"
                                onClick={() => { setSubFormAppId(null); setSubReason(''); }}
                                className="px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-600 rounded-lg text-xs font-bold border border-slate-200 transition cursor-pointer"
                              >
                                再想想
                              </button>
                            </div>
                          </div>
                        );
                      }

                      const urgent = hours !== null && hours < SUBSTITUTION_NOTICE_HOURS;
                      return (
                        <button
                          type="button"
                          onClick={() => { setSubFormAppId(app.id); setSubReason(''); }}
                          className={`text-xs font-bold transition cursor-pointer flex items-center gap-1 ${
                            urgent ? 'text-violet-700 hover:text-violet-900' : 'text-[#716053] hover:text-slate-900'
                          } hover:underline`}
                        >
                          <Handshake className="w-3.5 h-3.5" />
                          <span>{urgent ? `來不及了？找人代班（${timeUntilLabel(hours)}）` : '找人代班'}</span>
                        </button>
                      );
                    })()}

                    {(app.status === 'pending' || app.status === 'approved') && onCancelSignup && (
                      cancelConfirmAppId === app.id ? (
                        <div className="flex items-center gap-2 bg-rose-50 border border-rose-200 px-3 py-1.5 rounded-xl animate-fade-in flex-wrap">
                          <span className="text-xs text-rose-800 font-bold">
                            {(() => {
                              const hours = hoursUntilShift(shift?.date, shift?.timeRange);
                              return hours !== null && hours >= 0 && hours < SUBSTITUTION_NOTICE_HOURS
                                ? `距離開始${timeUntilLabel(hours)}，依規章請改為找人代班`
                                : '確定取消此班次？名額會重新釋出。';
                            })()}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              onCancelSignup(app.id);
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
          /* Everything on this document comes from the volunteer's own record.
             It used to be filled in with invented values -- three hard-coded
             skills, a joining date of 2025-06-15, an emergency contact called
             林媽媽, and a completed-shift count with eight added to it. This is
             a document a volunteer can export as proof of service, so a number
             on it that nobody can trace is worse than no number at all. */
          volunteer={{
            id: currentUser?.id || '',
            name: volunteerName,
            email: currentUser?.email || '',
            phone: currentUser?.phone || '',
            lineId: currentUser?.lineId || '',
            avatar: '',
            skills: currentUser?.skills || [],
            preferredZones: [],
            totalHours: totalCompletedHours,
            // The server keeps this count, incrementing it as each check-out is
            // confirmed. Falling back to the attendance rows covers a session
            // stored before the field was carried through.
            completedShiftsCount: currentUser?.completedShiftsCount ?? completedAttendance.length,
            tier: currentUser?.tier || '新進志工',
            joinedDate: currentUser?.joinedDate || '',
            emergencyContact: ''
          }}
          onClose={() => setShowCertificateModal(false)}
        />
      )}

    </div>
  );
};
