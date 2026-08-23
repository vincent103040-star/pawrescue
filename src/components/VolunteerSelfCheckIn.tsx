import React, { useState, useMemo } from 'react';
import { X, MapPin, KeyRound, Loader2, CheckCircle2, AlertCircle, Navigation } from 'lucide-react';
import { PositionShift, VolunteerApplication, VolunteerUserSession, ShelterLocation } from '../types';
import { authFetch } from '../utils/session';

interface VolunteerSelfCheckInProps {
  shifts: PositionShift[];
  applications: VolunteerApplication[];
  shelterLocation: ShelterLocation;
  currentUser: VolunteerUserSession | null;
  onClose: () => void;
  onCheckedIn: () => void;
  onSendLineToast: (msg: string) => void;
}

/** Taiwan-local YYYY-MM-DD, matching how the server decides what "today" is. */
function taiwanToday(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
}

/**
 * Check-in from the volunteer's own phone.
 *
 * The old flow had a coordinator pick a name from a dropdown on the office
 * machine and press a button labelled "simulate scanning a QR code" -- the
 * geofence it displayed measured the office, not the volunteer. Here the phone
 * doing the checking in is the phone that's actually at the shelter, and every
 * check is repeated server-side (see POST /api/attendance/check-in): the
 * six-digit code, the GPS distance, the shift date, and whether this volunteer
 * was even accepted onto the shift.
 */
export const VolunteerSelfCheckIn: React.FC<VolunteerSelfCheckInProps> = ({
  shifts,
  applications,
  shelterLocation,
  currentUser,
  onClose,
  onCheckedIn,
  onSendLineToast
}) => {
  const today = taiwanToday();

  // Only shifts this volunteer was actually approved for, happening today --
  // the same set the server will accept, so the UI can't offer an option that
  // is going to be rejected.
  const todayShifts = useMemo(() => {
    const email = (currentUser?.email || '').trim().toLowerCase();
    const approvedShiftIds = new Set(
      applications
        .filter(a => a.status === 'approved' && (a.volunteerEmail || '').trim().toLowerCase() === email)
        .map(a => a.shiftId)
    );
    return shifts.filter(s => s.date === today && approvedShiftIds.has(s.id));
  }, [shifts, applications, currentUser, today]);

  const [selectedShiftId, setSelectedShiftId] = useState<string>(todayShifts[0]?.id || '');
  const [code, setCode] = useState('');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const requestLocation = () => {
    if (!navigator.geolocation) {
      setLocationError('您的裝置不支援定位功能，可以只用簽到碼完成簽到。');
      return;
    }
    setIsLocating(true);
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      pos => {
        setIsLocating(false);
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      err => {
        setIsLocating(false);
        setLocationError(
          err.code === err.PERMISSION_DENIED
            ? '您拒絕了定位權限。仍可用簽到碼簽到，但紀錄會標記為待督導確認。'
            : `無法取得定位（${err.message}）。仍可用簽到碼簽到。`
        );
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  const handleSubmit = async () => {
    if (!selectedShiftId || code.trim().length !== 6) return;
    setIsSubmitting(true);
    setResult(null);
    try {
      const res = await authFetch('/api/attendance/check-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shiftId: selectedShiftId,
          siteCode: code.trim(),
          ...(coords ? { lat: coords.lat, lng: coords.lng } : {})
        })
      });
      const data = await res.json();
      if (data.success) {
        setResult({ ok: true, message: data.note || '簽到成功！服務時數會在您簽退後自動計算。' });
        onCheckedIn();
        onSendLineToast('🟢 簽到成功！感謝您今天來陪伴浪浪 🐾');
      } else {
        setResult({ ok: false, message: data.error || '簽到失敗，請再試一次。' });
      }
    } catch {
      setResult({ ok: false, message: '網路連線異常，請確認手機訊號後再試一次。' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#716053]/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <div className="bg-white w-full max-w-md rounded-[28px] border border-[#716053] shadow-md my-6 overflow-hidden font-sans">

        <div className="p-5 border-b border-[#716053] flex items-start justify-between gap-3">
          <div>
            <h3 className="font-bold font-serif text-slate-900 text-base flex items-center gap-2">
              <MapPin className="w-4 h-4 text-rose-600" />
              <span>現場簽到 🐾</span>
            </h3>
            <p className="text-[11px] text-slate-500 mt-1">
              請在園區現場，用您自己的手機完成簽到。
            </p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:bg-slate-100 p-1.5 rounded-lg cursor-pointer shrink-0" aria-label="關閉">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 text-xs">

          {todayShifts.length === 0 ? (
            <div className="bg-amber-50 border border-[#716053] rounded-2xl p-4 flex gap-2">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-slate-700">
                <p className="font-bold mb-1">今天沒有可簽到的班次</p>
                <p className="text-slate-500">
                  只有「已錄取」且日期是今天（{today}）的班次才能簽到。如果您剛報名，請等社工審核通過。
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Step 1 -- which shift */}
              <div>
                <label className="block font-bold text-[#716053] mb-1.5">1️⃣ 選擇今天要簽到的班次</label>
                <select
                  value={selectedShiftId}
                  onChange={e => setSelectedShiftId(e.target.value)}
                  className="w-full p-3 bg-[#FAF6EE] border border-[#716053] rounded-2xl font-medium focus:outline-none focus:ring-2 focus:ring-amber-400"
                >
                  {todayShifts.map(s => (
                    <option key={s.id} value={s.id}>{s.title}（{s.timeRange}）</option>
                  ))}
                </select>
              </div>

              {/* Step 2 -- GPS */}
              <div>
                <label className="block font-bold text-[#716053] mb-1.5">2️⃣ 確認您人在園區</label>
                {coords ? (
                  <div className="bg-emerald-50 border border-[#716053] rounded-2xl p-3 flex items-center gap-2 text-emerald-800 font-bold">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>已取得定位，送出時會由伺服器核對距離</span>
                  </div>
                ) : (
                  <button
                    onClick={requestLocation}
                    disabled={isLocating}
                    className="w-full bg-[#716053] hover:bg-[#5A4A3F] disabled:opacity-60 text-white font-bold px-4 py-3 rounded-2xl flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {isLocating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Navigation className="w-4 h-4 text-amber-300" />}
                    <span>{isLocating ? '定位中...' : '允許取得我的位置'}</span>
                  </button>
                )}
                {locationError && (
                  <p className="text-[11px] text-amber-700 mt-1.5 leading-relaxed">⚠️ {locationError}</p>
                )}
              </div>

              {/* Step 3 -- the code on the station screen */}
              <div>
                <label className="block font-bold text-[#716053] mb-1.5">
                  3️⃣ 輸入櫃台螢幕上的 6 位數簽到碼
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  className="w-full p-3 bg-[#FAF6EE] border border-[#716053] rounded-2xl text-center text-2xl font-bold tracking-[0.4em] focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
                <p className="text-[10px] text-slate-400 mt-1.5">
                  這組數字每 60 秒換一次，只有站在櫃台前才看得到，所以不能事先拿到。
                </p>
              </div>

              {result && (
                <div className={`rounded-2xl p-3 flex gap-2 border border-[#716053] ${result.ok ? 'bg-emerald-50' : 'bg-rose-50'}`}>
                  {result.ok
                    ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    : <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />}
                  <p className={`leading-relaxed ${result.ok ? 'text-emerald-800' : 'text-rose-800'}`}>{result.message}</p>
                </div>
              )}

              {!result?.ok && (
                <button
                  onClick={handleSubmit}
                  disabled={isSubmitting || code.length !== 6 || !selectedShiftId}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-extrabold px-4 py-3.5 rounded-2xl flex items-center justify-center gap-2 cursor-pointer"
                >
                  {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4 text-amber-300" />}
                  <span>{isSubmitting ? '簽到中...' : '完成簽到'}</span>
                </button>
              )}

              {result?.ok && (
                <button
                  onClick={onClose}
                  className="w-full bg-[#716053] hover:bg-[#5A4A3F] text-white font-extrabold px-4 py-3.5 rounded-2xl cursor-pointer"
                >
                  關閉
                </button>
              )}
            </>
          )}

          <p className="text-[10px] text-slate-400 text-center pt-1">
            📍 打卡範圍：{shelterLocation.name} 方圓 500 公尺內
          </p>
        </div>
      </div>
    </div>
  );
};
