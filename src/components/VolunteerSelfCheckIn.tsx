import React, { useState, useMemo } from 'react';
import { X, MapPin, KeyRound, Loader2, CheckCircle2, AlertCircle, Navigation, LogOut, Star, Camera, Sparkles } from 'lucide-react';
import { PositionShift, ShiftSignup, VolunteerUserSession, ShelterLocation, AttendanceRecord } from '../types';
import { authFetch } from '../utils/session';

interface VolunteerSelfCheckInProps {
  shifts: PositionShift[];
  shiftSignups: ShiftSignup[];
  shelterLocation: ShelterLocation;
  attendanceRecords: AttendanceRecord[];
  currentUser: VolunteerUserSession | null;
  onClose: () => void;
  onCheckedIn: () => void;
  /** Signed token from a scanned printed poster; replaces the on-screen code. */
  posterCode?: string;
  onCheckOutSubmit: (
    recordId: string,
    checkOutTime: string,
    hoursLogged: number,
    rating?: number,
    comment?: string,
    photo?: { base64: string; mimeType: string }
  ) => void;
  onSendLineToast: (msg: string) => void;
}

/** Hours the shift was scheduled for, so a late check-out doesn't inflate them. */
function scheduledHours(timeRange: string): number | null {
  const m = timeRange.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const [, h1, m1, h2, m2] = m.map(Number);
  const start = h1 * 60 + m1;
  let end = h2 * 60 + m2;
  if (end <= start) end += 24 * 60;
  return Math.round(((end - start) / 60) * 10) / 10;
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
  shiftSignups,
  shelterLocation,
  attendanceRecords,
  currentUser,
  onClose,
  onCheckedIn,
  posterCode,
  onCheckOutSubmit,
  onSendLineToast
}) => {
  const today = taiwanToday();

  // Only shifts this volunteer was actually approved for, happening today --
  // the same set the server will accept, so the UI can't offer an option that
  // is going to be rejected.
  const todayShifts = useMemo(() => {
    const email = (currentUser?.email || '').trim().toLowerCase();
    const approvedShiftIds = new Set(
      shiftSignups
        .filter(a => a.status === 'approved' && (a.volunteerEmail || '').trim().toLowerCase() === email)
        .map(a => a.shiftId)
    );
    return shifts.filter(s => s.date === today && approvedShiftIds.has(s.id));
  }, [shifts, shiftSignups, currentUser, today]);

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
    if (!selectedShiftId) return;
    if (!posterCode && code.trim().length !== 6) return;
    if (posterCode && !coords) {
      setResult({ ok: false, message: '用海報 QR 簽到時必須開啟定位，請先允許取得位置。' });
      return;
    }
    setIsSubmitting(true);
    setResult(null);
    try {
      const res = await authFetch('/api/attendance/check-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shiftId: selectedShiftId,
          ...(posterCode ? { posterCode } : { siteCode: code.trim() }),
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

  // ------------------------------------------------------------------
  // Check-out: hours, a short reflection, and a photo.
  //
  // This lives on the volunteer's own phone for the same reason check-in
  // does -- they're the one who was there, and the photo is coming off
  // their camera. The reflections and photos collected here are what the
  // coordinator reads on the dashboard's feedback wall.
  // ------------------------------------------------------------------
  const myOpenRecords = useMemo(() => {
    const name = (currentUser?.name || '').trim().toLowerCase();
    return attendanceRecords.filter(
      r => r.status === 'checked_in' && (r.volunteerName || '').trim().toLowerCase() === name
    );
  }, [attendanceRecords, currentUser]);

  const [checkingOut, setCheckingOut] = useState<AttendanceRecord | null>(null);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [photo, setPhoto] = useState<{ previewUrl: string; base64: string; mimeType: string } | null>(null);
  const [isCaptioning, setIsCaptioning] = useState(false);
  const [isCheckingOut, setIsCheckingOut] = useState(false);

  // Shrink before upload -- a raw phone photo is several MB and the caption
  // only needs enough detail to describe the scene.
  const handlePhotoSelected = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxDim = 1024;
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.75);
        setPhoto({ previewUrl: dataUrl, base64: dataUrl.split(',')[1], mimeType: 'image/jpeg' });
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleAiCaption = async () => {
    if (!photo || !checkingOut || isCaptioning) return;
    setIsCaptioning(true);
    try {
      const res = await authFetch('/api/ai/caption-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: photo.base64, mimeType: photo.mimeType,
          shiftTitle: checkingOut.shiftTitle, zone: checkingOut.zone
        })
      });
      const data = await res.json();
      if (data.caption) setComment(data.caption);
    } catch {
      onSendLineToast('⚠️ AI 產生說明失敗，您可以自己寫幾句話。');
    } finally {
      setIsCaptioning(false);
    }
  };

  const handleFinishCheckOut = () => {
    if (!checkingOut || isCheckingOut) return;
    setIsCheckingOut(true);
    const shift = shifts.find(sh => sh.id === checkingOut.shiftId);
    const hours = (shift && scheduledHours(shift.timeRange)) || 3;
    onCheckOutSubmit(
      checkingOut.id,
      new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Taipei' }),
      hours,
      rating,
      comment.trim(),
      photo ? { base64: photo.base64, mimeType: photo.mimeType } : undefined
    );
    onSendLineToast(`✅ 簽退完成！本次服務 ${hours} 小時，感謝您的回饋 🐾`);
    setCheckingOut(null);
    setPhoto(null);
    setComment('');
    setRating(5);
    setIsCheckingOut(false);
    onClose();
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

          {posterCode && (
            <div className="bg-emerald-50 border border-[#716053] rounded-2xl p-3 text-[11px] text-emerald-800">
              📷 已掃描現場簽到海報，不需要輸入簽到碼 —— 但請務必允許取得位置。
            </div>
          )}

          {/* Already checked in? Then the job now is to check out. */}
          {myOpenRecords.length > 0 && !checkingOut && (
            <div className="bg-amber-50 border border-[#716053] rounded-2xl p-4 space-y-3">
              <p className="font-bold text-[#716053] flex items-center gap-1.5">
                <LogOut className="w-4 h-4" />
                <span>您目前正在服務中</span>
              </p>
              {myOpenRecords.map(rec => (
                <div key={rec.id} className="flex items-center justify-between gap-2 bg-white border border-[#716053] rounded-xl p-3">
                  <div className="min-w-0">
                    <p className="font-bold text-slate-900 truncate">{rec.shiftTitle}</p>
                    <p className="text-[11px] text-slate-500">簽到於 {rec.checkInTime}</p>
                  </div>
                  <button
                    onClick={() => setCheckingOut(rec)}
                    className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold px-3.5 py-2 rounded-xl shrink-0 cursor-pointer"
                  >
                    離場簽退
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Check-out form: rating, reflection, photo. */}
          {checkingOut && (
            <div className="space-y-4">
              <div className="bg-[#FFFDF7] border border-[#716053] rounded-2xl p-3">
                <p className="font-bold text-slate-900">{checkingOut.shiftTitle}</p>
                <p className="text-[11px] text-slate-500">簽到於 {checkingOut.checkInTime}</p>
              </div>

              <div>
                <label className="block font-bold text-[#716053] mb-1.5">⭐ 今天的服務體驗</label>
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map(n => (
                    <button
                      key={n}
                      onClick={() => setRating(n)}
                      className="p-1 cursor-pointer"
                      aria-label={`${n} 星`}
                    >
                      <Star className={`w-7 h-7 ${n <= rating ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}`} />
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block font-bold text-[#716053] mb-1.5">📷 今天的照片（選填）</label>
                {photo ? (
                  <div className="space-y-2">
                    <img src={photo.previewUrl} alt="服務照片" className="w-full rounded-2xl border border-[#716053] object-cover max-h-48" />
                    <div className="flex gap-2">
                      <button
                        onClick={handleAiCaption}
                        disabled={isCaptioning}
                        className="flex-1 bg-[#716053] hover:bg-[#5A4A3F] disabled:opacity-60 text-white font-bold py-2 rounded-xl flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        {isCaptioning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 text-amber-300" />}
                        <span>{isCaptioning ? '產生中...' : 'AI 幫我寫心得'}</span>
                      </button>
                      <button onClick={() => setPhoto(null)} className="px-3 py-2 rounded-xl font-bold text-slate-500 hover:bg-slate-100 cursor-pointer">
                        移除
                      </button>
                    </div>
                  </div>
                ) : (
                  <label className="flex items-center justify-center gap-2 border border-dashed border-[#716053] rounded-2xl py-4 cursor-pointer hover:bg-[#FAF6EE] font-bold text-[#716053]">
                    <Camera className="w-4 h-4" />
                    <span>拍照或選擇照片</span>
                    <input type="file" accept="image/*" className="hidden" onChange={e => e.target.files?.[0] && handlePhotoSelected(e.target.files[0])} />
                  </label>
                )}
              </div>

              <div>
                <label className="block font-bold text-[#716053] mb-1.5">✍️ 服務心得（選填）</label>
                <textarea
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                  rows={4}
                  placeholder="今天遇到哪隻浪浪？有什麼想跟社工說的？"
                  className="w-full p-3 bg-[#FAF6EE] border border-[#716053] rounded-2xl focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
                />
                <p className="text-[10px] text-slate-400 mt-1">您的心得與照片會出現在督導後台的回饋牆上。</p>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setCheckingOut(null)}
                  className="px-4 py-3 rounded-2xl font-bold text-slate-500 hover:bg-slate-100 cursor-pointer"
                >
                  返回
                </button>
                <button
                  onClick={handleFinishCheckOut}
                  disabled={isCheckingOut}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-extrabold px-4 py-3 rounded-2xl flex items-center justify-center gap-2 cursor-pointer"
                >
                  <LogOut className="w-4 h-4 text-amber-300" />
                  <span>{isCheckingOut ? '送出中...' : '完成簽退並送出回饋'}</span>
                </button>
              </div>
            </div>
          )}

          {!checkingOut && (todayShifts.length === 0 ? (
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
                <label className="block font-bold text-[#716053] mb-1.5">2️⃣ 確認您人在園區{posterCode ? '（必要）' : ''}</label>
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

              {/* Step 3 -- the code on the station screen. Skipped entirely when
                  the volunteer got here by scanning the printed poster, which
                  carries its own signed token. */}
              <div className={posterCode ? 'hidden' : ''}>
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
                  disabled={isSubmitting || !selectedShiftId || (posterCode ? !coords : code.length !== 6)}
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
          ))}

          {!checkingOut && (
            <p className="text-[10px] text-slate-400 text-center pt-1">
              📍 打卡範圍：{shelterLocation.name} 方圓 500 公尺內
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
