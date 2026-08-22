import React, { useState, useEffect } from 'react';
import { AttendanceRecord, PositionShift, VolunteerApplication, VolunteerProfile, ShelterLocation } from '../types';
import { ZONE_CONFIGS } from '../data/mockData';
import { QrCode, Camera, CheckCircle2, Clock, MapPin, AlertCircle, LogOut, LogIn, UserCheck, ShieldCheck, Sparkles, RefreshCw, X, Compass, Navigation, Radio, AlertTriangle, Star, Send, MessageSquare, ThumbsUp, Heart } from 'lucide-react';

interface VolunteerCheckInModalProps {
  shifts: PositionShift[];
  applications: VolunteerApplication[];
  volunteers: VolunteerProfile[];
  shelterLocation: ShelterLocation;
  attendanceRecords: AttendanceRecord[];
  onClose: () => void;
  onCheckInSubmit: (record: Omit<AttendanceRecord, 'id'>) => void;
  onCheckOutSubmit: (recordId: string, checkOutTime: string, hoursLogged: number, rating?: number, comment?: string, photo?: { base64: string; mimeType: string }) => void;
  onSendLineToast: (msg: string) => void;
}

// Parses a shift's "HH:MM - HH:MM" timeRange into a duration in hours, e.g.
// "10:00 - 13:00" -> 3. Handles an overnight shift (end time earlier than start)
// by rolling the end time to the next day. Returns null if the format doesn't match.
function parseTimeRangeHours(timeRange: string): number | null {
  const match = timeRange.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const [, h1, m1, h2, m2] = match.map(Number);
  const startMin = h1 * 60 + m1;
  let endMin = h2 * 60 + m2;
  if (endMin <= startMin) endMin += 24 * 60;
  return Math.round(((endMin - startMin) / 60) * 10) / 10;
}

// Haversine formula to calculate exact distance between two lat/lng points in meters
function calculateDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3; // Earth radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(R * c);
}

export const VolunteerCheckInModal: React.FC<VolunteerCheckInModalProps> = ({
  shifts,
  applications,
  volunteers,
  shelterLocation,
  attendanceRecords,
  onClose,
  onCheckInSubmit,
  onCheckOutSubmit,
  onSendLineToast
}) => {
  const [activeTab, setActiveTab] = useState<'scan' | 'records'>('scan');
  
  // Selection state for manual/simulated scan
  const [selectedVolunteerName, setSelectedVolunteerName] = useState<string>('');
  const [selectedLineId, setSelectedLineId] = useState<string>('');
  const [selectedShiftId, setSelectedShiftId] = useState<string>('');
  
  // Simulator animation states
  const [isScanning, setIsScanning] = useState(false);
  const [scanSuccess, setScanSuccess] = useState(false);
  const [scannedResult, setScannedResult] = useState<string | null>(null);

  // Feedback + LINE reminder state upon check-out
  const [pendingFeedbackRecord, setPendingFeedbackRecord] = useState<AttendanceRecord | null>(null);
  const [feedbackRating, setFeedbackRating] = useState<number>(5);
  const [hoverRating, setHoverRating] = useState<number>(0);
  const [feedbackComment, setFeedbackComment] = useState<string>('');
  const [isLineReminderNotificationShown, setIsLineReminderNotificationShown] = useState(false);

  // Check-out photo + AI caption state
  const [checkoutPhoto, setCheckoutPhoto] = useState<{ previewUrl: string; base64: string; mimeType: string } | null>(null);
  const [isCaptioning, setIsCaptioning] = useState(false);

  // Downscale to keep the upload small and fast on mobile data, since a raw
  // phone photo can be several MB -- we only need enough detail for the AI
  // caption, not full resolution.
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
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.75);
        setCheckoutPhoto({
          previewUrl: dataUrl,
          base64: dataUrl.split(',')[1],
          mimeType: 'image/jpeg'
        });
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleAiCaptionPhoto = async (shiftTitle: string, zone: string) => {
    if (!checkoutPhoto || isCaptioning) return;
    setIsCaptioning(true);
    try {
      const res = await fetch('/api/ai/caption-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: checkoutPhoto.base64, mimeType: checkoutPhoto.mimeType, shiftTitle, zone })
      });
      const data = await res.json();
      if (data.caption) setFeedbackComment(data.caption);
    } catch (err) {
      console.warn('AI photo caption failed', err);
    } finally {
      setIsCaptioning(false);
    }
  };

  // Geofencing states
  const [presetLocationMode, setPresetLocationMode] = useState<'on_site' | 'nearby' | 'far'>('on_site');
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [isLocatingGPS, setIsLocatingGPS] = useState(false);

  const GEOFENCE_RADIUS_METERS = 500;

  // Set default selected values when modal opens
  useEffect(() => {
    // Default shift: first active shift
    if (shifts.length > 0) {
      setSelectedShiftId(shifts[0].id);
    }
    // Default volunteer: from approved apps or profiles
    const approvedApp = applications.find(a => a.status === 'approved' || a.status === 'pending');
    if (approvedApp) {
      setSelectedVolunteerName(approvedApp.volunteerName);
      setSelectedLineId(approvedApp.lineId || 'line_vol_01');
    } else if (volunteers.length > 0) {
      setSelectedVolunteerName(volunteers[0].name);
      setSelectedLineId(volunteers[0].lineId);
    }
  }, [shifts, applications, volunteers]);

  const currentShift = shifts.find(s => s.id === selectedShiftId) || shifts[0];

  // Sync userCoords based on the shelter's single location and preset location mode
  useEffect(() => {
    if (presetLocationMode === 'on_site') {
      setUserCoords({
        lat: shelterLocation.lat + 0.0006,
        lng: shelterLocation.lng + 0.0005
      });
    } else if (presetLocationMode === 'nearby') {
      setUserCoords({
        lat: shelterLocation.lat + 0.0028,
        lng: shelterLocation.lng + 0.0022
      });
    } else if (presetLocationMode === 'far') {
      setUserCoords({
        lat: shelterLocation.lat + 0.0145,
        lng: shelterLocation.lng + 0.0115
      });
    }
  }, [shelterLocation, presetLocationMode]);

  // Calculated distance in meters
  const currentDistanceMeters = userCoords
    ? calculateDistanceMeters(userCoords.lat, userCoords.lng, shelterLocation.lat, shelterLocation.lng)
    : 85;

  const isWithinGeofence = currentDistanceMeters <= GEOFENCE_RADIUS_METERS;

  // Real GPS fetch handler
  const handleGetRealGPS = () => {
    if (!navigator.geolocation) {
      onSendLineToast('⚠️ 您的裝置或瀏覽器不支援 GPS 定位服務');
      return;
    }
    setIsLocatingGPS(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setIsLocatingGPS(false);
        setUserCoords({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude
        });
        const dist = calculateDistanceMeters(
          pos.coords.latitude,
          pos.coords.longitude,
          shelterLocation.lat,
          shelterLocation.lng
        );
        onSendLineToast(`📡 已取得您真實 GPS 定位！距離【${shelterLocation.name}】相距 ${dist} 公尺 (${dist <= GEOFENCE_RADIUS_METERS ? '🟢 圍欄內' : '🔴 超出圍欄'})`);
      },
      (err) => {
        setIsLocatingGPS(false);
        onSendLineToast(`⚠️ 無法定位 (錯誤: ${err.message})，已為您切換至模擬位置。`);
      },
      { enableHighAccuracy: true, timeout: 5000 }
    );
  };

  // Current checked-in count
  const checkedInCount = attendanceRecords.filter(r => r.status === 'checked_in').length;
  const completedCount = attendanceRecords.filter(r => r.status === 'completed').length;

  // Helper to get formatted current datetime
  const getCurrentDateTimeStr = () => {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toTimeString().split(' ')[0];
    return `${dateStr} ${timeStr}`;
  };

  // Simulate scanning QR Code
  const handleSimulateQRScan = () => {
    if (!selectedVolunteerName || !selectedShiftId) {
      onSendLineToast('⚠️ 請選擇或輸入志工姓名與簽到班次');
      return;
    }

    if (!isWithinGeofence) {
      onSendLineToast(`🔴 簽到失敗！您當前與據點相距 ${currentDistanceMeters}m，超過 500m 地理圍欄防偽限制！`);
      return;
    }

    setIsScanning(true);
    setScanSuccess(false);

    setTimeout(() => {
      setIsScanning(false);
      setScanSuccess(true);
      const token = `LINE-QR-${Math.floor(10000 + Math.random() * 90000)}`;
      setScannedResult(`LINE://pawrescue.org/checkin?token=${token}&vol=${encodeURIComponent(selectedVolunteerName)}`);
    }, 1200);
  };

  // Confirm Check-In (抵達簽到)
  const handleConfirmCheckIn = () => {
    if (!selectedVolunteerName.trim() || !selectedShiftId) return;

    if (!isWithinGeofence) {
      onSendLineToast(`🔴 簽到失敗！打卡位置距離據點 ${currentDistanceMeters}m (上限 500m)，未在地理圍欄範圍內！`);
      return;
    }

    // Check if volunteer is already checked in for this shift
    const existing = attendanceRecords.find(
      r => r.volunteerName === selectedVolunteerName && r.shiftId === selectedShiftId && r.status === 'checked_in'
    );
    if (existing) {
      onSendLineToast(`⚠️【${selectedVolunteerName}】已在【${existing.shiftTitle}】簽到中，請勿重複簽到！`);
      return;
    }

    const checkInTimeStr = getCurrentDateTimeStr();

    const newRecord: Omit<AttendanceRecord, 'id'> = {
      applicationId: applications.find(a => a.volunteerName === selectedVolunteerName)?.id,
      volunteerName: selectedVolunteerName,
      lineId: selectedLineId || `line_${selectedVolunteerName}`,
      shiftId: currentShift.id,
      shiftTitle: currentShift.title,
      zone: currentShift.zone,
      date: currentShift.date,
      checkInTime: checkInTimeStr,
      status: 'checked_in',
      locationVerified: isWithinGeofence,
      distanceMeters: currentDistanceMeters,
      qrCodeToken: scannedResult || `LINE-QR-${Date.now()}`
    };

    onCheckInSubmit(newRecord);
    setScanSuccess(false);
    onSendLineToast(`🟢 簽到成功！【${selectedVolunteerName}】完成【${currentShift.title}】到場簽到 (距離據點 ${currentDistanceMeters}m，圍欄驗證 OK)。`);
  };

  // Open Service Feedback Collection Dialog upon Check-Out
  const handleOpenCheckOutFeedback = (record: AttendanceRecord) => {
    setPendingFeedbackRecord(record);
    setFeedbackRating(5);
    setHoverRating(0);
    setFeedbackComment('');
    setIsLineReminderNotificationShown(true);
  };

  // Perform Final Check-Out Submission with Feedback (離場簽退與回饋)
  const handleFinalizeCheckOut = (includeFeedback: boolean = true) => {
    if (!pendingFeedbackRecord) return;

    const checkOutTimeStr = getCurrentDateTimeStr();

    // Service hours should reflect the shift the volunteer actually signed up for
    // (e.g. a 3-hour "10:00 - 13:00" block), not the raw wall-clock gap between
    // tapping check-in and check-out -- a late/forgotten check-out (even a day
    // later) would otherwise log wildly inflated hours that have nothing to do
    // with how long the volunteer was actually there.
    const matchedShift = shifts.find(s => s.id === pendingFeedbackRecord.shiftId);
    const shiftHours = matchedShift ? parseTimeRangeHours(matchedShift.timeRange) : null;

    let hours = shiftHours ?? 3.0;
    if (shiftHours === null) {
      // Fallback only for the rare case a matching shift/timeRange can't be found
      // -- still clamp to a sane range so a stale check-in can't blow this up.
      try {
        const start = new Date(pendingFeedbackRecord.checkInTime.replace(' ', 'T')).getTime();
        const end = new Date().getTime();
        const diffHours = (end - start) / (1000 * 60 * 60);
        if (diffHours > 0.1) {
          hours = Math.round(Math.min(diffHours, 8) * 10) / 10;
        }
      } catch {
        hours = 3.0;
      }
    }

    const finalRating = includeFeedback ? feedbackRating : 5;
    const finalComment = includeFeedback ? (feedbackComment.trim() || '志工完成服務，流程順暢。') : '已透過 LINE 發送服務回饋提醒（等待志工回應）';

    onCheckOutSubmit(
      pendingFeedbackRecord.id,
      checkOutTimeStr,
      hours,
      finalRating,
      finalComment,
      checkoutPhoto ? { base64: checkoutPhoto.base64, mimeType: checkoutPhoto.mimeType } : undefined
    );

    onSendLineToast(
      `✅ 離場核銷成功！已透過 LINE 通知【${pendingFeedbackRecord.volunteerName}】並收集 ${finalRating} 星評分：「${finalComment}」，資料已彙整至管理員後台。`
    );

    setPendingFeedbackRecord(null);
    setCheckoutPhoto(null);
  };

  // Resend the LINE feedback reminder for a completed record
  const handleResendFeedbackLineReminder = (record: AttendanceRecord) => {
    onSendLineToast(`💬 [LINE 提醒已重發] 已向【${record.volunteerName}】補發服務回饋提醒訊息！`);
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#5A5A40]/50 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto font-sans">
      <div className="bg-white rounded-[32px] max-w-2xl w-full shadow-2xl border border-[#5A5A40]/20 overflow-hidden my-6 animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header Bar */}
        <div className="bg-[#5A5A40] text-white p-6 flex items-center justify-between relative">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500 text-white flex items-center justify-center shadow-md">
              <QrCode className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="font-bold font-serif text-lg text-white italic">
                  LINE 掃碼志工簽到與離場核銷系統
                </h3>
                <span className="text-[10px] bg-emerald-400 text-slate-900 px-2.5 py-0.5 rounded-full font-extrabold tracking-wide uppercase">
                  LINE LIFF 驗證
                </span>
              </div>
              <p className="text-xs text-[#E6E2D3] mt-0.5">
                模擬志工抵達園區後使用 LINE 相機掃描 QR Code 簽到 / 離場核銷時數
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-white/70 hover:text-white p-2 rounded-full hover:bg-white/10 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Navigation Tabs */}
        <div className="bg-[#f5f5f0] p-2 border-b border-[#5A5A40]/12 flex justify-between items-center px-6">
          <div className="flex space-x-2">
            <button
              onClick={() => setActiveTab('scan')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer ${
                activeTab === 'scan'
                  ? 'bg-white text-[#5A5A40] shadow-xs'
                  : 'text-slate-600 hover:text-[#5A5A40]'
              }`}
            >
              <Camera className="w-4 h-4 text-emerald-600" />
              <span>📱 QR Code 掃描簽到框</span>
            </button>
            <button
              onClick={() => setActiveTab('records')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer ${
                activeTab === 'records'
                  ? 'bg-white text-[#5A5A40] shadow-xs'
                  : 'text-slate-600 hover:text-[#5A5A40]'
              }`}
            >
              <Clock className="w-4 h-4 text-sky-600" />
              <span>📋 簽到紀錄與服務時數表 ({attendanceRecords.length})</span>
            </button>
          </div>

          <div className="hidden sm:flex items-center gap-2 text-[11px] font-bold">
            <span className="bg-emerald-100 text-emerald-800 px-2.5 py-1 rounded-full">
              在場中: {checkedInCount} 人
            </span>
            <span className="bg-slate-200 text-slate-700 px-2.5 py-1 rounded-full">
              已離場: {completedCount} 人
            </span>
          </div>
        </div>

        {/* Body Content */}
        <div className="p-6">
          {activeTab === 'scan' ? (
            <div className="space-y-6">
              
              {/* Geofencing Location Verification Card */}
              <div className="bg-[#f5f5f0] border border-[#5A5A40]/20 rounded-2xl p-4 text-xs space-y-3 font-sans shadow-2xs">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-[#5A5A40]/15">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-xl bg-[#5A5A40] text-[#E6E2D3] flex items-center justify-center shrink-0">
                      <Compass className="w-4 h-4 animate-spin-slow" />
                    </div>
                    <div>
                      <div className="font-bold text-[#5A5A40] text-sm flex items-center gap-1.5">
                        <span>📡 地理圍欄 (Geofencing) 500m 防偽驗證</span>
                        {isWithinGeofence ? (
                          <span className="bg-emerald-100 text-emerald-800 text-[10px] font-extrabold px-2 py-0.5 rounded-full border border-emerald-300 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping"></span>
                            圍欄驗證合格
                          </span>
                        ) : (
                          <span className="bg-rose-100 text-rose-800 text-[10px] font-extrabold px-2 py-0.5 rounded-full border border-rose-300 flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3 text-rose-600" />
                            超出圍欄範圍
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500">
                        目標據點：<strong className="text-slate-800">{shelterLocation.name}</strong> (座標: {shelterLocation.lat.toFixed(4)}, {shelterLocation.lng.toFixed(4)})
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={handleGetRealGPS}
                    disabled={isLocatingGPS}
                    className="bg-sky-600 hover:bg-sky-700 text-white font-bold px-3 py-1.5 rounded-xl transition shadow-2xs flex items-center justify-center gap-1.5 shrink-0 text-[11px] cursor-pointer disabled:opacity-50"
                  >
                    <Navigation className={`w-3.5 h-3.5 ${isLocatingGPS ? 'animate-spin' : ''}`} />
                    <span>{isLocatingGPS ? '定位中...' : '📡 讀取手機實時 GPS'}</span>
                  </button>
                </div>

                {/* Distance Meter Gauge */}
                <div className="bg-white rounded-xl p-3 border border-[#5A5A40]/12 space-y-2">
                  <div className="flex justify-between items-center font-bold">
                    <span className="text-slate-600 flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5 text-[#5A5A40]" />
                      當前測得直線距離：
                    </span>
                    <span className={`text-sm ${isWithinGeofence ? 'text-emerald-700' : 'text-rose-600'}`}>
                      {currentDistanceMeters.toLocaleString()} 公尺
                      <span className="text-[10px] text-slate-400 font-normal ml-1">(圍欄上限: 500m)</span>
                    </span>
                  </div>

                  {/* Meter Progress Bar */}
                  <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden relative">
                    {/* 500m threshold indicator marker */}
                    <div className="absolute top-0 bottom-0 left-[25%] border-r-2 border-slate-400 z-10" title="500m 圍欄邊界"></div>
                    
                    <div
                      className={`h-full transition-all duration-500 ${
                        isWithinGeofence ? 'bg-gradient-to-r from-emerald-400 to-emerald-600' : 'bg-gradient-to-r from-amber-500 to-rose-600'
                      }`}
                      style={{ width: `${Math.min(100, Math.max(5, (currentDistanceMeters / 2000) * 100))}%` }}
                    ></div>
                  </div>

                  {/* Geofencing Quick Simulation Selector Buttons */}
                  <div className="flex flex-wrap items-center justify-between gap-1.5 pt-1 text-[11px]">
                    <span className="text-slate-400 font-medium">切換地理位置模擬測試：</span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setPresetLocationMode('on_site')}
                        className={`px-2.5 py-1 rounded-lg font-bold transition cursor-pointer border ${
                          presetLocationMode === 'on_site'
                            ? 'bg-emerald-600 text-white border-emerald-700 shadow-2xs'
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border-slate-200'
                        }`}
                      >
                        📍 現場簽到 (85m)
                      </button>
                      <button
                        onClick={() => setPresetLocationMode('nearby')}
                        className={`px-2.5 py-1 rounded-lg font-bold transition cursor-pointer border ${
                          presetLocationMode === 'nearby'
                            ? 'bg-emerald-600 text-white border-emerald-700 shadow-2xs'
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border-slate-200'
                        }`}
                      >
                        🚗 園區週邊 (380m)
                      </button>
                      <button
                        onClick={() => setPresetLocationMode('far')}
                        className={`px-2.5 py-1 rounded-lg font-bold transition cursor-pointer border ${
                          presetLocationMode === 'far'
                            ? 'bg-rose-600 text-white border-rose-700 shadow-2xs'
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border-slate-200'
                        }`}
                      >
                        ❌ 遠端打卡 (1,850m)
                      </button>
                    </div>
                  </div>
                </div>

                {!isWithinGeofence && (
                  <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-rose-800 text-[11px] flex items-start gap-2 animate-in fade-in">
                    <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    <div>
                      <strong className="font-bold">⚠️ 無法打卡：地理圍欄驗證未通過</strong>
                      <p className="mt-0.5 text-rose-700">
                        目前測得距離【{shelterLocation.name}】相距 <strong>{currentDistanceMeters}m</strong>，超過 500 公尺打卡範圍限制。請至現場園區後再進行 LINE 掃碼打卡。
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* QR Scanner Frame Graphic Simulation */}
              <div className="bg-slate-900 rounded-3xl p-6 text-white text-center relative overflow-hidden shadow-inner border-2 border-slate-700">
                
                {/* Scanner laser animation */}
                {isScanning && (
                  <div className="absolute inset-x-0 h-1 bg-emerald-400 shadow-[0_0_15px_#10B981] animate-pulse z-20 top-1/2 -translate-y-1/2"></div>
                )}

                <div className="relative z-10 max-w-sm mx-auto space-y-4">
                  
                  {/* Camera viewport frame */}
                  <div className={`relative w-48 h-48 mx-auto border-4 border-dashed rounded-3xl flex flex-col items-center justify-center bg-slate-800/80 p-4 transition-all duration-300 ${
                    isWithinGeofence ? 'border-emerald-400/70' : 'border-rose-500/70'
                  }`}>
                    
                    <div className="absolute top-2 left-2 text-[10px] font-mono flex items-center gap-1">
                      {isWithinGeofence ? (
                        <span className="text-emerald-400">🟢 GEOFENCE OK</span>
                      ) : (
                        <span className="text-rose-400">🔴 OUT OF FENCE</span>
                      )}
                    </div>
                    <div className="absolute top-2 right-2 text-[10px] text-[#E6E2D3] font-mono">LINE API</div>
                    
                    <QrCode className={`w-24 h-24 transition-transform duration-300 ${
                      isWithinGeofence ? 'text-emerald-400' : 'text-slate-500 opacity-60'
                    } ${isScanning ? 'scale-110 animate-pulse' : ''}`} />
                    
                    <span className="text-[11px] text-slate-300 font-mono mt-2 bg-slate-900/80 px-2 py-0.5 rounded">
                      [{shelterLocation.name || '浪浪家園'}]
                    </span>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-center space-x-2 text-xs font-bold">
                      {isWithinGeofence ? (
                        <div className="flex items-center space-x-1.5 text-emerald-300">
                          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
                          <span>📍 圍欄驗證成功：距 {shelterLocation.name} {currentDistanceMeters}m (≤ 500m)</span>
                        </div>
                      ) : (
                        <div className="flex items-center space-x-1.5 text-rose-400">
                          <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                          <span>❌ 距離據點 {currentDistanceMeters}m (已超過 500m 圍欄範圍)</span>
                        </div>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400">
                      LINE 條碼包含：班次 ID、志工辨別 Token 與實時防偽時間戳記
                    </p>
                  </div>

                  {/* Trigger Simulation Button */}
                  <button
                    onClick={handleSimulateQRScan}
                    disabled={isScanning || !isWithinGeofence}
                    className={`w-full font-extrabold py-3 px-6 rounded-full text-xs transition shadow-lg flex items-center justify-center space-x-2 cursor-pointer disabled:opacity-50 ${
                      isWithinGeofence
                        ? 'bg-emerald-500 hover:bg-emerald-600 text-slate-950'
                        : 'bg-slate-700 text-slate-400 cursor-not-allowed'
                    }`}
                  >
                    <RefreshCw className={`w-4 h-4 ${isScanning ? 'animate-spin' : ''}`} />
                    <span>
                      {isScanning
                        ? 'LINE 相機對焦中...'
                        : isWithinGeofence
                        ? '一鍵模擬 LINE 手機相機掃描 QR Code'
                        : '超出 500m 地理圍欄 (無法打卡)'}
                    </span>
                  </button>

                </div>
              </div>

              {/* Scanned Result & Check-In Action Form */}
              {scanSuccess && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 text-xs space-y-3 animate-in fade-in slide-in-from-top-2">
                  <div className="flex items-center space-x-2 text-emerald-800 font-bold text-sm">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                    <span>條碼辨識成功！請核對簽到資訊：</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-slate-700 font-sans">
                    <div><span className="text-slate-500">志工姓名：</span><strong className="text-slate-900">{selectedVolunteerName}</strong></div>
                    <div><span className="text-slate-500">LINE ID：</span><strong>@{selectedLineId}</strong></div>
                    <div><span className="text-slate-500">簽到班次：</span><strong className="text-[#5A5A40]">{currentShift?.title}</strong></div>
                    <div><span className="text-slate-500">預計時段：</span><strong>{currentShift?.timeRange}</strong></div>
                  </div>
                  <div className="pt-2 flex justify-end">
                    <button
                      onClick={handleConfirmCheckIn}
                      className="bg-emerald-700 hover:bg-emerald-800 text-white font-bold py-2.5 px-6 rounded-full text-xs shadow-xs transition flex items-center space-x-1.5 cursor-pointer"
                    >
                      <LogIn className="w-4 h-4" />
                      <span>確認完成【抵達簽到】紀錄</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Manual Selection Form (for admins & testing) */}
              <div className="bg-[#f5f5f0] rounded-2xl p-5 border border-[#5A5A40]/15 space-y-4 text-xs font-sans">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[#5A5A40] flex items-center gap-1">
                    <UserCheck className="w-4 h-4 text-[#5A5A40]" />
                    <span>手動選擇簽到人員與對應班次 (社工協助備用)</span>
                  </span>
                  <span className="text-[11px] text-slate-500">若手機沒電時適用</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Volunteer Name */}
                  <div>
                    <label className="block font-bold text-[#5A5A40] mb-1">志工姓名 / LINE 名稱 *</label>
                    <select
                      value={selectedVolunteerName}
                      onChange={e => {
                        setSelectedVolunteerName(e.target.value);
                        const app = applications.find(a => a.volunteerName === e.target.value);
                        if (app?.lineId) setSelectedLineId(app.lineId);
                      }}
                      className="w-full p-2.5 bg-white border border-[#5A5A40]/20 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#5A5A40]"
                    >
                      {applications.map(app => (
                        <option key={app.id} value={app.volunteerName}>
                          {app.volunteerName} (LINE: {app.lineId || '已連接'}) - {app.appliedZone}
                        </option>
                      ))}
                      {volunteers.map(vol => (
                        <option key={vol.id} value={vol.name}>
                          {vol.name} ({vol.tier})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Shift Selection */}
                  <div>
                    <label className="block font-bold text-[#5A5A40] mb-1">簽到班次 *</label>
                    <select
                      value={selectedShiftId}
                      onChange={e => setSelectedShiftId(e.target.value)}
                      className="w-full p-2.5 bg-white border border-[#5A5A40]/20 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#5A5A40]"
                    >
                      {shifts.map(shift => (
                        <option key={shift.id} value={shift.id}>
                          {shift.title} ({shift.date} {shift.timeRange})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="flex justify-end pt-2 border-t border-[#5A5A40]/10">
                  <button
                    onClick={handleConfirmCheckIn}
                    disabled={!isWithinGeofence}
                    className={`font-bold py-2 px-5 rounded-full text-xs shadow-xs transition flex items-center space-x-1.5 cursor-pointer disabled:opacity-50 ${
                      isWithinGeofence
                        ? 'bg-[#5A5A40] hover:bg-[#484833] text-white'
                        : 'bg-rose-700 text-white cursor-not-allowed'
                    }`}
                  >
                    <LogIn className="w-4 h-4 text-[#E6E2D3]" />
                    <span>{isWithinGeofence ? '直接進行【抵達簽到】' : '超出 500m 圍欄 (無法簽到)'}</span>
                  </button>
                </div>
              </div>

              {/* Quick Check-Out Panel for currently checked-in volunteers */}
              {checkedInCount > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-xs space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-amber-900 flex items-center gap-1.5">
                      <Clock className="w-4 h-4 text-amber-700" />
                      <span>目前在場服務中志工 (點擊離場簽退)：</span>
                    </span>
                    <span className="text-[11px] text-amber-700 font-semibold">{checkedInCount} 人在場</span>
                  </div>

                  <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                    {attendanceRecords
                      .filter(r => r.status === 'checked_in')
                      .map(rec => (
                        <div key={rec.id} className="bg-white p-3 rounded-xl border border-amber-200 flex justify-between items-center shadow-2xs">
                          <div>
                            <span className="font-bold text-slate-900">{rec.volunteerName}</span>
                            <span className="text-[11px] text-slate-500 ml-2">({rec.shiftTitle})</span>
                            <div className="text-[10px] text-emerald-700 font-medium">
                              🟢 抵達時間: {rec.checkInTime}
                            </div>
                          </div>

                          <button
                            onClick={() => handleOpenCheckOutFeedback(rec)}
                            className="bg-[#5A5A40] hover:bg-[#484833] text-white font-bold px-3 py-1.5 rounded-lg text-xs transition flex items-center gap-1 cursor-pointer shadow-2xs"
                          >
                            <LogOut className="w-3.5 h-3.5 text-amber-300" />
                            <span>離場簽退 & 收集回饋</span>
                          </button>
                        </div>
                      ))}
                  </div>
                </div>
              )}

            </div>
          ) : (
            /* Records Table View */
            <div className="space-y-4">
              <div className="flex justify-between items-center text-xs">
                <span className="font-bold text-[#5A5A40]">歷史簽到與時數紀錄冊：</span>
                <span className="text-slate-500">共 {attendanceRecords.length} 筆簽到簽退數據</span>
              </div>

              <div className="border border-[#5A5A40]/15 rounded-2xl overflow-hidden text-xs">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-[#f5f5f0] text-[#5A5A40] font-bold border-b border-[#5A5A40]/15">
                    <tr>
                      <th className="p-3">志工姓名</th>
                      <th className="p-3">對應班次 / 場域</th>
                      <th className="p-3">圍欄距離</th>
                      <th className="p-3">抵達簽到時間</th>
                      <th className="p-3">離場簽退時間</th>
                      <th className="p-3">服務時數</th>
                      <th className="p-3 text-right">狀態與核銷</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#5A5A40]/10 bg-white">
                    {attendanceRecords.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="p-6 text-center text-slate-400 italic">
                          尚無簽到紀錄，請至「QR Code 掃描簽到框」進行第一次簽到！
                        </td>
                      </tr>
                    ) : (
                      attendanceRecords.map(rec => {
                        const zoneConf = ZONE_CONFIGS[rec.zone];
                        const isCheckedIn = rec.status === 'checked_in';

                        return (
                          <tr key={rec.id} className="hover:bg-[#f5f5f0]/50 transition">
                            <td className="p-3 font-bold text-slate-900">
                              {rec.volunteerName}
                              <div className="text-[10px] text-slate-400 font-normal">LINE: @{rec.lineId || '無'}</div>
                            </td>
                            <td className="p-3">
                              <p className="font-semibold text-slate-800">{rec.shiftTitle}</p>
                              {zoneConf && (
                                <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full mt-0.5 ${zoneConf.badgeBg}`}>
                                  {zoneConf.icon} {zoneConf.name}
                                </span>
                              )}
                            </td>
                            <td className="p-3">
                              <span className="inline-flex items-center gap-1 text-[10px] font-extrabold bg-emerald-50 text-emerald-800 border border-emerald-200 px-2 py-0.5 rounded-full">
                                <Compass className="w-3 h-3 text-emerald-600" />
                                <span>{rec.distanceMeters ? `${rec.distanceMeters}m` : '< 100m'}</span>
                              </span>
                            </td>
                            <td className="p-3 text-slate-700 font-mono text-[11px]">
                              {rec.checkInTime}
                            </td>
                            <td className="p-3 text-slate-700 font-mono text-[11px]">
                              {rec.checkOutTime ? rec.checkOutTime : <span className="text-amber-600 italic">服務中...</span>}
                            </td>
                            <td className="p-3 font-bold text-[#5A5A40]">
                              <div>{rec.hoursLogged ? `${rec.hoursLogged} 小時` : '--'}</div>
                              {rec.rating && (
                                <div className="flex items-center gap-0.5 text-amber-500 mt-1" title={`${rec.rating} 星評分`}>
                                  {[1, 2, 3, 4, 5].map(star => (
                                    <Star
                                      key={star}
                                      className={`w-3 h-3 ${star <= rec.rating! ? 'fill-amber-400 text-amber-400' : 'text-slate-200'}`}
                                    />
                                  ))}
                                </div>
                              )}
                            </td>
                            <td className="p-3 text-right">
                              {isCheckedIn ? (
                                <button
                                  onClick={() => handleOpenCheckOutFeedback(rec)}
                                  className="bg-[#5A5A40] hover:bg-[#484833] text-white text-[11px] font-bold px-3 py-1 rounded-full shadow-2xs transition inline-flex items-center gap-1 cursor-pointer"
                                >
                                  <LogOut className="w-3 h-3 text-amber-300" />
                                  <span>簽退 & 送出 LINE 提醒</span>
                                </button>
                              ) : (
                                <div className="flex flex-col items-end gap-1">
                                  <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded-full inline-flex items-center gap-1">
                                    <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                    <span>已核銷簽退</span>
                                  </span>
                                  <button
                                    onClick={() => handleResendFeedbackLineReminder(rec)}
                                    className="text-[10px] text-emerald-700 font-bold hover:underline inline-flex items-center gap-0.5 cursor-pointer"
                                  >
                                    <MessageSquare className="w-3 h-3 text-emerald-600" />
                                    <span>重發 LINE 提醒</span>
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer info */}
        <div className="bg-[#f5f5f0] p-4 border-t border-[#5A5A40]/10 flex justify-between items-center text-xs text-slate-500 font-sans">
          <div className="flex items-center space-x-1.5 text-[#5A5A40]">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span className="font-medium">LINE 官方帳號 Rich Menu 與自動簽到整合完畢</span>
          </div>
          <button
            onClick={onClose}
            className="px-5 py-2 bg-[#5A5A40] text-white rounded-full font-bold hover:bg-[#484833] cursor-pointer"
          >
            關閉視窗
          </button>
        </div>

      </div>

      {/* 💬 志工離場簽退 - 服務回饋與滿意度調查彈窗 (透過 LINE 發送提醒) */}
      {pendingFeedbackRecord && (
        <div className="fixed inset-0 z-60 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-amber-500/30 space-y-5 animate-in zoom-in-95">

            {/* Modal Header */}
            <div className="flex justify-between items-start border-b border-slate-100 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-amber-500 text-slate-950 flex items-center justify-center font-bold text-lg shadow-md shrink-0">
                  <MessageSquare className="w-6 h-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold font-serif text-slate-900 text-base">
                      服務回饋與滿意度調查 (LINE)
                    </h3>
                    <span className="bg-amber-100 text-amber-900 text-[10px] font-extrabold px-2 py-0.5 rounded-full border border-amber-300">
                      離場簽退
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    志工：<strong className="text-slate-800">{pendingFeedbackRecord.volunteerName}</strong> ｜ 班次：<strong className="text-[#5A5A40]">{pendingFeedbackRecord.shiftTitle}</strong>
                  </p>
                </div>
              </div>

              <button
                onClick={() => { setPendingFeedbackRecord(null); setCheckoutPhoto(null); }}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-full hover:bg-slate-100 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* LINE Reminder Message Preview -- actually sent via the real Messaging
                API once submitted (see /api/attendance/:id/check-out), if this
                volunteer has completed real LINE Login; otherwise this is silently
                skipped server-side, same fallback as the app's other LINE pushes. */}
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-3.5 text-xs space-y-2">
              <div className="flex items-center justify-between text-emerald-900 font-bold">
                <span className="flex items-center gap-1.5">
                  <Send className="w-4 h-4 text-emerald-600 animate-pulse" />
                  <span>💬 LINE 提醒訊息預覽</span>
                </span>
                <span className="text-[10px] bg-emerald-200 text-emerald-800 px-2 py-0.5 rounded-full">
                  已連結 LINE 帳號者將真的收到
                </span>
              </div>
              <div className="bg-white p-3 rounded-xl border border-emerald-200 text-slate-700 font-mono text-[11px] leading-relaxed shadow-2xs">
                【浪浪家園】親愛的 <strong>{pendingFeedbackRecord.volunteerName}</strong> 您好，感謝您完成本次志工服務（{pendingFeedbackRecord.shiftTitle}）！我們已收到您本次服務的回饋評分，再次感謝您的付出 🐾
              </div>
            </div>

            {/* 1 - 5 Star Rating Selection */}
            <div className="space-y-2 bg-[#fdfdfb] p-4 rounded-2xl border border-[#5A5A40]/15">
              <label className="block text-xs font-bold text-slate-800 flex justify-between items-center">
                <span className="flex items-center gap-1.5">
                  <Star className="w-4 h-4 text-amber-500 fill-amber-400" />
                  <span>本次服務體驗總評分 (1 至 5 星)：</span>
                </span>
                <span className="text-amber-600 font-extrabold text-sm">
                  {feedbackRating === 5 && '⭐⭐⭐⭐⭐ 5.0 (非常滿意)'}
                  {feedbackRating === 4 && '⭐⭐⭐⭐ 4.0 (滿意流暢)'}
                  {feedbackRating === 3 && '⭐⭐⭐ 3.0 (服務普通)'}
                  {feedbackRating === 2 && '⭐⭐ 2.0 (尚有改善空間)'}
                  {feedbackRating === 1 && '⭐ 1.0 (亟待改進)'}
                </span>
              </label>

              {/* Interactive Stars */}
              <div className="flex items-center justify-center gap-3 py-2">
                {[1, 2, 3, 4, 5].map(star => {
                  const isFilled = (hoverRating || feedbackRating) >= star;
                  return (
                    <button
                      key={star}
                      type="button"
                      onMouseEnter={() => setHoverRating(star)}
                      onMouseLeave={() => setHoverRating(0)}
                      onClick={() => setFeedbackRating(star)}
                      className="p-1.5 rounded-xl hover:bg-amber-100 transition transform hover:scale-115 cursor-pointer focus:outline-none"
                    >
                      <Star
                        className={`w-8 h-8 transition-colors ${
                          isFilled ? 'text-amber-400 fill-amber-400 shadow-xs' : 'text-slate-300'
                        }`}
                      />
                    </button>
                  );
                })}
              </div>

              {/* Quick Preset Tags */}
              <div className="pt-2">
                <span className="text-[11px] text-slate-400 block font-medium mb-1">快速填入推薦標籤：</span>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    '園區環境乾淨 🧼',
                    '督導指導親切 👩‍⚕️',
                    '動線與工具齊全 📋',
                    '毛孩照護收穫多 🐾',
                    '建議增加休憩補水點 🚰'
                  ].map(tag => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => {
                        setFeedbackComment(prev => prev ? `${prev} / ${tag}` : tag);
                      }}
                      className="bg-white hover:bg-amber-50 text-slate-700 hover:text-amber-900 border border-slate-200 hover:border-amber-300 text-[11px] px-2.5 py-1 rounded-lg font-medium transition cursor-pointer"
                    >
                      + {tag}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Check-out Photo + AI Caption */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-700">今天的服務照片 (選填)：</label>
              {checkoutPhoto ? (
                <div className="flex items-start gap-3">
                  <img src={checkoutPhoto.previewUrl} alt="服務照片預覽" className="w-20 h-20 object-cover rounded-xl border border-slate-200 shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <button
                      type="button"
                      onClick={() => pendingFeedbackRecord && handleAiCaptionPhoto(pendingFeedbackRecord.shiftTitle, pendingFeedbackRecord.zone)}
                      disabled={isCaptioning}
                      className="w-full bg-[#5A5A40] hover:bg-[#484833] text-white text-[11px] font-bold py-2 rounded-xl flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                      <span>{isCaptioning ? 'AI 看照片寫心得中...' : '請 AI 幫我看照片寫心得'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setCheckoutPhoto(null)}
                      className="text-[10px] text-slate-400 hover:text-slate-600 cursor-pointer"
                    >
                      移除照片重新選擇
                    </button>
                  </div>
                </div>
              ) : (
                <label className="flex items-center justify-center gap-2 border-2 border-dashed border-slate-300 hover:border-[#5A5A40]/40 rounded-xl py-4 text-xs text-slate-500 cursor-pointer transition">
                  <Camera className="w-4 h-4" />
                  <span>拍照或選擇一張今天的服務照片</span>
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={e => e.target.files?.[0] && handlePhotoSelected(e.target.files[0])}
                  />
                </label>
              )}
            </div>

            {/* Feedback Comment Textarea */}
            <div className="space-y-1">
              <label className="block text-xs font-bold text-slate-700 flex justify-between">
                <span>簡單文字建議與心得 (選填)：</span>
                <span className="text-slate-400 text-[10px]">將同步彙整至管理員後台</span>
              </label>
              <textarea
                value={feedbackComment}
                onChange={e => setFeedbackComment(e.target.value)}
                placeholder="例如：今天幼犬溫室照護流程很清晰，督導說明的餵量剛好，希望能繼續參與下一期班次！"
                rows={3}
                className="w-full p-3 bg-white border border-slate-300 rounded-xl text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#5A5A40] resize-none"
              />
            </div>

            {/* Modal Actions */}
            <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => handleFinalizeCheckOut(true)}
                className="flex-1 bg-amber-500 hover:bg-amber-600 text-slate-950 font-extrabold py-2.5 px-4 rounded-xl text-xs shadow-md transition flex items-center justify-center gap-1.5 cursor-pointer transform hover:scale-[1.02]"
              >
                <Send className="w-4 h-4 text-slate-950" />
                <span>💬 模擬志工送出評分並完成簽退</span>
              </button>

              <button
                type="button"
                onClick={() => handleFinalizeCheckOut(false)}
                className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-2.5 px-4 rounded-xl text-xs transition flex items-center justify-center gap-1 cursor-pointer"
              >
                <MessageSquare className="w-4 h-4 text-slate-500" />
                <span>僅發送 LINE 提醒 (事後填寫)</span>
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
};
