/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Suspense, useState, useEffect, useMemo } from 'react';
import { LoginPortal } from './components/LoginPortal';
import { lazyScreen } from './components/lazyScreen';

const Dashboard = lazyScreen(() => import('./components/Dashboard').then(m => ({ default: m.Dashboard })));

/** 首次進入某個畫面時的載入提示。 */
const ScreenLoading: React.FC = () => (
  <div className="py-24 flex items-center justify-center text-sm text-[#716053] font-sans">
    載入中...
  </div>
);
const PositionManager = lazyScreen(() => import('./components/PositionManager').then(m => ({ default: m.PositionManager })));
const ApplicantReview = lazyScreen(() => import('./components/ApplicantReview').then(m => ({ default: m.ApplicantReview })));
const VolunteerPortal = lazyScreen(() => import('./components/VolunteerPortal').then(m => ({ default: m.VolunteerPortal })));
import { AdminNavbar } from './components/AdminNavbar';
import { VolunteerNavbar, VolunteerActiveTab } from './components/VolunteerNavbar';




import { VolunteerMyShifts } from './components/VolunteerMyShifts';
import { VolunteerSopGuide } from './components/VolunteerSopGuide';
import { AdminSopManager } from './components/AdminSopManager';
import { AiServiceStatus } from './components/AiServiceStatus';
import { ZoneManager } from './components/ZoneManager';
import { DutyItemManager } from './components/DutyItemManager';
import { AnimalStatusManager } from './components/AnimalStatusManager';
import { RollCallPanel } from './components/RollCallPanel';
import { VolunteerRoster } from './components/VolunteerRoster';
import { SubstitutionBoard, OpenSubstitution } from './components/SubstitutionBoard';
import { SubstitutionWatchlist } from './components/SubstitutionWatchlist';
import { PeriodRosterPanel } from './components/PeriodRosterPanel';
import { VolunteerDutyBoard } from './components/VolunteerDutyBoard';
import { AiPostModal } from './components/AiPostModal';
import { VolunteerCheckInModal } from './components/VolunteerCheckInModal';
import { VolunteerSelfCheckIn } from './components/VolunteerSelfCheckIn';
import { CheckInPosterModal } from './components/CheckInPosterModal';
import { RulebookManualModal } from './components/RulebookManualModal';

import {
  UserRole,
  AdminUserSession,
  VolunteerUserSession,
  ShelterLocation,
  PositionShift,
  ShiftSignup,
  VolunteerProfile,
  SignupStatus,
  AttendanceRecord
} from './types';
import { INITIAL_SHIFTS, VOLUNTEER_PROFILES, ZONE_CONFIGS, DEFAULT_SHELTER_LOCATION } from './data/mockData';
import { applyZones, type ZoneRecord } from './data/zones';
import { MessageSquare, X, Bell, Clock, MapPin, QrCode, ArrowUpRight } from 'lucide-react';
import { sendLinePush } from './utils/linePush';
import { setToken, clearToken, authFetch, fetchCurrentSession, logout as serverLogout } from './utils/session';
import { subscribeToLiveUpdates } from './utils/liveUpdates';
import { startLineBinding, exchangeLineLoginTicket } from './utils/lineLogin';

export default function App() {
  // Authentication & Role State
  const [userRole, setUserRole] = useState<UserRole>(() => {
    const saved = localStorage.getItem('paw_user_role');
    return (saved as UserRole) || null;
  });

  const [adminSession, setAdminSession] = useState<AdminUserSession | null>(() => {
    const saved = localStorage.getItem('paw_admin_session');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { /* ignore */ }
    }
    return {
      id: 'admin-01',
      name: '蔡督導',
      email: 'supervisor@pawrescue.org.tw',
      roleTitle: '社工督導長 / 系統管理員',
      branch: 'taipei'
    };
  });

  /**
   * Null until somebody actually signs in.
   *
   * This used to fall back to a made-up volunteer -- 林小明, phone
   * 0912-345-678 -- and that phone number is also carried by two of the sample
   * bookings and one of the sample attendance rows the app ships with. So any
   * screen that asked "which of these are mine?" by phone was handed a
   * stranger's shifts. An absent session now matches nothing, which is the
   * truthful answer.
   */
  const [volunteerSession, setVolunteerSession] = useState<VolunteerUserSession | null>(() => {
    const saved = localStorage.getItem('paw_volunteer_session');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { /* ignore */ }
    }
    return null;
  });

  // Tab states for separate roles
  const [adminActiveTab, setAdminActiveTab] = useState<'dashboard' | 'positions' | 'signups' | 'roster' | 'sopManager' | 'smartStaffing'>('dashboard');
  const [volunteerActiveTab, setVolunteerActiveTab] = useState<VolunteerActiveTab>('shifts');

  // The shelter's single physical location (previously 3 fixed hardcoded
  // "branches" -- see /api/shelter-location). Fetched once and kept live in
  // state so an admin's edit (ShiftCalendarView's inline editor) is
  // immediately reflected everywhere it's read (check-in geofence, maps
  // links, dashboard).
  const [shelterLocation, setShelterLocation] = useState<ShelterLocation>(DEFAULT_SHELTER_LOCATION);

  useEffect(() => {
    fetch('/api/shelter-location')
      .then(res => res.json())
      .then(data => { if (data.success) setShelterLocation(data.location); })
      .catch(() => { /* keep the default seed if the backend is unreachable */ });
  }, []);

  // Core Data Persistence
  // Seeded from the mock data purely so the first paint isn't empty; the effects
  // below immediately replace all four with the server's copy.
  const [shifts, setShifts] = useState<PositionShift[]>(INITIAL_SHIFTS);
  // Personal lists start empty rather than pre-filled with the sample rows.
  // Every loader below keeps what is on screen when a fetch fails, which is
  // right for a dropped connection and wrong at first paint: it left demo
  // bookings sitting on the page looking exactly like real ones.
  const [shiftSignups, setShiftSignups] = useState<ShiftSignup[]>([]);
  const [volunteers, setVolunteers] = useState<VolunteerProfile[]>(VOLUNTEER_PROFILES);
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);

  // The live-updates subscription below is created once and therefore closes
  // over the first render's values; this ref is how it can still see the
  // current role.
  const roleRef = React.useRef(userRole);
  roleRef.current = userRole;

  // Shifts and signups now live server-side too. They used to be
  // localStorage-only, which meant a shift published on the coordinator's
  // desktop didn't exist for a volunteer on their phone. Re-fetching them is
  // how every mutation below stays consistent across devices.
  const refreshShifts = () =>
    authFetch('/api/shifts')
      .then(res => res.json())
      .then(data => { if (data.success && Array.isArray(data.shifts)) setShifts(data.shifts); })
      .catch(() => { /* keep what's on screen if the backend is unreachable */ });

  const refreshShiftSignups = () =>
    authFetch('/api/shift-signups')
      .then(res => res.json())
      .then(data => { if (data.success && Array.isArray(data.shiftSignups)) setShiftSignups(data.shiftSignups); })
      .catch(() => { /* keep what's on screen if the backend is unreachable */ });

  // The full roster is admin-only on the server now -- it carries every
  // volunteer's phone number and emergency contact, and only the admin roster
  // page ever shows it. Asking as a volunteer would just collect a 403.
  const refreshVolunteers = () => {
    if (roleRef.current !== 'admin') return Promise.resolve();
    return authFetch('/api/volunteers')
      .then(res => res.json())
      .then(data => { if (data.success && Array.isArray(data.volunteers)) setVolunteers(data.volunteers); })
      .catch(() => { /* keep what's on screen if the backend is unreachable */ });
  };

  // Shifts other volunteers cannot make. Everyone signed in may read these --
  // answering one is the whole point -- so unlike the roster there is no role
  // guard here.
  const [substitutions, setSubstitutions] = useState<OpenSubstitution[]>([]);

  const refreshSubstitutions = () =>
    authFetch('/api/substitutions')
      .then(res => res.json())
      .then(data => { if (data.success && Array.isArray(data.requests)) setSubstitutions(data.requests); })
      .catch(() => { /* keep what's on screen if the backend is unreachable */ });

  // The shelter's areas, which used to be five values compiled into the
  // frontend. applyZones updates the module-level lookup that sixteen
  // components already read from; the state below exists so that updating it
  // re-renders the tree, at which point those components see the new values.
  const [zones, setZones] = useState<ZoneRecord[]>([]);

  const refreshZones = () =>
    authFetch('/api/zones')
      .then(res => res.json())
      .then(data => {
        if (data.success && Array.isArray(data.zones)) {
          applyZones(data.zones);
          setZones(data.zones);
        }
      })
      .catch(() => { /* the seeded five stay on screen if this fails */ });

  const refreshAttendance = () =>
    authFetch('/api/attendance')
      .then(res => res.json())
      .then(data => { if (data.success && Array.isArray(data.records)) setAttendanceRecords(data.records); })
      .catch(() => { /* keep what's on screen if the backend is unreachable */ });

  // None of these endpoints is public any more, and what they return is scoped
  // to whoever signed in -- an admin gets the whole board, a volunteer gets
  // their own bookings and their own attendance. So the load waits for a role
  // and runs again when it changes, instead of firing once on mount at the
  // login screen where there is no session to scope it by.
  useEffect(() => {
    if (!userRole) return;
    refreshZones();
    refreshShifts();
    refreshShiftSignups();
    refreshAttendance();
    refreshVolunteers();
    refreshSubstitutions();

    // A sign-in builds the session out of what the login screen knows, which is
    // the profile and nothing else. The record on file carries more -- the
    // credited hours, the completed shift count, the skills -- and the service
    // certificate prints those, so fetch them rather than leaving the document
    // to guess.
    if (userRole === 'volunteer') {
      fetchCurrentSession().then(session => {
        if (session?.role === 'volunteer' && session.volunteer) {
          setVolunteerSession(prev => ({ ...(prev as any), ...session.volunteer }));
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userRole]);

  // Live updates: the server pushes "this changed" and the page re-fetches just
  // that slice, so a check-in on someone's phone shows up on the coordinator's
  // dashboard without anyone reloading. Falls back to polling automatically --
  // see subscribeToLiveUpdates.
  useEffect(() => {
    const stop = subscribeToLiveUpdates(kind => {
      if (kind === 'attendance') refreshAttendance();
      else if (kind === 'shifts') refreshShifts();
      else if (kind === 'signups') { refreshShiftSignups(); refreshSubstitutions(); }
      else if (kind === 'volunteers') refreshVolunteers();
      else if (kind === 'promotions') setPromotionsRevision(n => n + 1);
      else if (kind === 'zones') refreshZones();
    });
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Bumped when the server says a promotion request changed; the roster watches
  // this to re-pull its review queue (it owns that fetch, not App).
  const [promotionsRevision, setPromotionsRevision] = useState(0);

  // Validate the stored session token against the server on load. The signed-in
  // role used to be believed purely because localStorage said so, which meant it
  // survived being revoked -- or edited by hand. If the server doesn't recognise
  // the token, the UI drops straight back to the login page.
  useEffect(() => {
    if (!userRole) return;
    let cancelled = false;
    fetchCurrentSession().then(session => {
      if (cancelled) return;
      if (!session) {
        clearToken();
        setUserRole(null);
        localStorage.removeItem('paw_user_role');
        return;
      }
      // Trust the server's answer over whatever the browser had stored.
      if (session.role !== userRole) {
        setUserRole(session.role);
        localStorage.setItem('paw_user_role', session.role);
      }
      if (session.role === 'volunteer' && session.volunteer) {
        setVolunteerSession(prev => ({
          ...(prev as any),
          name: session.volunteer.name,
          email: session.volunteer.email,
          phone: session.volunteer.phone,
          lineId: session.volunteer.lineId,
          tier: session.volunteer.tier,
          totalHours: session.volunteer.totalHours,
          completedShiftsCount: session.volunteer.completedShiftsCount,
          skills: session.volunteer.skills,
          joinedDate: session.volunteer.joinedDate
        }));
      }
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  // Deep-link support for the LINE Rich Menu: tapping a menu tile opens this app
  // with e.g. ?tab=sop or ?checkin=1. If the volunteer is already logged in on this
  // device (persisted session from a past real Google login), jump immediately;
  // otherwise stash the destination and apply it once handleLoginAsVolunteer runs.
  const [pendingDeepLinkTab, setPendingDeepLinkTab] = useState<VolunteerActiveTab | null>(null);
  const [pendingDeepLinkCheckIn, setPendingDeepLinkCheckIn] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get('tab');
    const checkinParam = params.get('checkin') === '1';
    const validTabs: VolunteerActiveTab[] = ['shifts', 'myshifts', 'growth', 'settings', 'sop'];
    const tab = validTabs.includes(tabParam as VolunteerActiveTab) ? (tabParam as VolunteerActiveTab) : null;
    if (!tab && !checkinParam) return;

    if (userRole === 'volunteer') {
      if (tab) setVolunteerActiveTab(tab);
      if (checkinParam) setIsCheckInModalOpen(true);
    } else {
      if (tab) setPendingDeepLinkTab(tab);
      if (checkinParam) setPendingDeepLinkCheckIn(true);
    }
    // Drop the query string so refreshing or re-sharing this tab doesn't re-trigger it.
    window.history.replaceState({}, '', window.location.pathname);
  }, []);

  // Returning from a LINE *sign-in* (as opposed to a LINE binding). The redirect
  // carries only an opaque one-time ticket -- never the volunteer's email or name,
  // which would otherwise be left sitting in browser history -- so exchange it for
  // the real profile here.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('lineLoggedIn')) return;

    const ticket = params.get('ticket') || '';
    const succeeded = params.get('lineLoggedIn') === '1';
    const errorCode = params.get('error') || '';
    window.history.replaceState({}, '', window.location.pathname);

    if (!succeeded || !ticket) {
      showToast(
        errorCode === 'line_not_registered'
          ? '⚠️ 這個 LINE 帳號還沒綁定過志工資料，請先用 Google 帳號登入並完成綁定。'
          : `⚠️ LINE 登入失敗（${errorCode || 'unknown'}），請改用 Google 帳號登入。`
      );
      return;
    }

    exchangeLineLoginTicket(ticket).then(volunteer => {
      if (!volunteer) {
        showToast('⚠️ LINE 登入憑證已失效，請重新登入一次。');
        return;
      }
      localStorage.setItem('volunteer_profile_name', volunteer.name || '');
      localStorage.setItem('volunteer_profile_email', volunteer.email || '');
      localStorage.setItem('volunteer_profile_phone', volunteer.phone || '');
      handleLoginAsVolunteer({
        name: volunteer.name,
        email: volunteer.email,
        phone: volunteer.phone,
        lineId: volunteer.lineId,
        tier: volunteer.tier,
        totalHours: volunteer.totalHours
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Prompt a signed-in volunteer who hasn't bound LINE yet. Binding is what makes
  // push notifications and later LINE-only sign-in possible, so this keeps asking
  // on each login rather than only once at registration -- but stays skippable, so
  // a LINE outage or a failed authorization can never block someone out of the
  // system entirely.
  const [lineBindPrompt, setLineBindPrompt] = useState<{ email: string; name: string } | null>(null);

  useEffect(() => {
    if (userRole !== 'volunteer' || !volunteerSession?.email) return;
    if (sessionStorage.getItem('paw_line_bind_dismissed') === '1') return;

    let cancelled = false;
    authFetch(`/api/volunteers/line-status?email=${encodeURIComponent(volunteerSession.email)}`)
      .then(res => res.json())
      .then(data => {
        if (cancelled) return;
        if (data.success && !data.linked) {
          setLineBindPrompt({ email: volunteerSession.email, name: volunteerSession.name });
        }
      })
      .catch(() => { /* best-effort -- never block the portal on this */ });
    return () => { cancelled = true; };
  }, [userRole, volunteerSession?.email, volunteerSession?.name]);

  // Modals state
  const [aiModalShift, setAiModalShift] = useState<PositionShift | null>(null);
  const [isCheckInModalOpen, setIsCheckInModalOpen] = useState(false);
  const [isPosterModalOpen, setIsPosterModalOpen] = useState(false);

  // Arriving from a scanned check-in poster: /?checkin=<signed token>. Held in
  // state (and the URL cleaned up) so a refresh mid-sign-in doesn't lose it.
  const [posterCode, setPosterCode] = useState<string>('');
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('c') || params.get('checkin');
    if (!token) return;
    setPosterCode(token);
    setIsCheckInModalOpen(true);
    window.history.replaceState({}, '', window.location.pathname);
  }, []);
  const [isRulebookModalOpen, setIsRulebookModalOpen] = useState(false);

  // Toast State
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Save to localStorage
  useEffect(() => {
    if (userRole) {
      localStorage.setItem('paw_user_role', userRole);
    } else {
      localStorage.removeItem('paw_user_role');
    }
  }, [userRole]);

  useEffect(() => {
    if (adminSession) {
      localStorage.setItem('paw_admin_session', JSON.stringify(adminSession));
    }
  }, [adminSession]);

  useEffect(() => {
    if (volunteerSession) {
      localStorage.setItem('paw_volunteer_session', JSON.stringify(volunteerSession));
    }
  }, [volunteerSession]);

  // Shifts, signups, volunteers and attendance are no longer mirrored into
  // localStorage: the server owns them, and a stale local copy would silently
  // win over fresher data on the next page load. They're re-fetched on mount and
  // after every mutation instead.

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  // Auth Handlers
  const handleLoginAsAdmin = (admin: AdminUserSession) => {
    setUserRole('admin');
    setAdminSession(admin);
    setAdminActiveTab('dashboard');
    showToast(`🛡️ 歡迎回來，${admin.name} 社工督導！已登入管理者工作站。`);
  };

  const handleLoginAsVolunteer = (volunteer: VolunteerUserSession) => {
    setUserRole('volunteer');
    setVolunteerSession(volunteer);
    setVolunteerActiveTab(pendingDeepLinkTab || 'shifts');
    setDismissedReminderShiftId(null);
    if (pendingDeepLinkCheckIn) setIsCheckInModalOpen(true);
    setPendingDeepLinkTab(null);
    setPendingDeepLinkCheckIn(false);
    showToast(`🐾 歡迎回來，${volunteer.name} 志工夥伴！已進入志工服務專區。`);
  };

  // Check if volunteer has an approved shift starting within 24 hours
  const [dismissedReminderShiftId, setDismissedReminderShiftId] = useState<string | null>(null);

  const upcomingApprovedShiftReminder = useMemo(() => {
    if (userRole !== 'volunteer' || !volunteerSession) return null;

    // Email only: it is what the server issues the session against and what it
    // scopes this list by. Matching on a phone number as well is how somebody
    // else's shift ended up in here.
    const vEmail = (volunteerSession.email || '').trim().toLowerCase();
    if (!vEmail) return null;

    const myApprovedAppShiftIds = shiftSignups
      .filter(a =>
        a.status === 'approved' &&
        (a.volunteerEmail || '').trim().toLowerCase() === vEmail
      )
      .map(a => a.shiftId);

    if (myApprovedAppShiftIds.length === 0) return null;

    const now = new Date();

    const candidateShifts = shifts
      .filter(s => myApprovedAppShiftIds.includes(s.id))
      .map(s => {
        // Parse start time e.g. "10:00 - 13:00" -> "10:00"
        const startTimeStr = s.timeRange ? s.timeRange.split('-')[0].trim() : '10:00';
        let shiftDateTime = new Date(`${s.date}T${startTimeStr}:00`);
        if (isNaN(shiftDateTime.getTime())) {
          shiftDateTime = new Date(s.date);
        }
        const diffMs = shiftDateTime.getTime() - now.getTime();
        const diffHours = diffMs / (1000 * 60 * 60);
        return { shift: s, shiftDateTime, diffHours };
      })
      // Within 24 hours (including shifts starting soon or earlier today within buffer)
      .filter(item => item.diffHours > -4 && item.diffHours <= 24)
      .sort((a, b) => a.shiftDateTime.getTime() - b.shiftDateTime.getTime());

    if (candidateShifts.length === 0) return null;

    return candidateShifts[0];
  }, [userRole, volunteerSession, shiftSignups, shifts]);

  const handleLogout = () => {
    // Revoke the token on the server too, so logging out actually ends the
    // session rather than just hiding the UI on this device.
    serverLogout();
    setUserRole(null);
    localStorage.removeItem('paw_user_role');
    showToast('👋 已成功登出，返回身分選擇登入首頁');
  };

  const handleSwitchToVolunteer = () => {
    setUserRole('volunteer');
    setVolunteerActiveTab('shifts');
    showToast('🔄 已快速切換為「志工夥伴」服務視角');
  };

  // Attendance Handlers
  // The record now comes back from the server, which is what created and
  // verified it (see POST /api/attendance/check-in). This just folds it into
  // local state; the SSE broadcast handles every other open device.
  const handleCheckInSubmit = (newRecord: AttendanceRecord) => {
    setAttendanceRecords(prev => [newRecord, ...prev]);
    if (newRecord.signupId) {
      setShiftSignups(prev => prev.map(a => a.id === newRecord.signupId ? { ...a, status: 'attended' } : a));
    }
  };

  const handleCheckOutSubmit = (
    recordId: string,
    checkOutTime: string,
    hoursLogged: number,
    rating?: number,
    comment?: string,
    photo?: { base64: string; mimeType: string }
  ) => {
    let checkedOutName = '';

    setAttendanceRecords(prev => prev.map(r => {
      if (r.id === recordId) {
        checkedOutName = r.volunteerName;
        const nowStr = new Date().toLocaleString('zh-TW', { hour12: false });
        return {
          ...r,
          checkOutTime,
          hoursLogged,
          status: 'completed',
          rating: rating || r.rating || 5,
          feedbackComment: comment !== undefined ? comment : (r.feedbackComment || '服務體驗良好！感謝督導細心指導。'),
          feedbackSubmittedAt: nowStr,
          lineReminderSent: true
        };
      }
      return r;
    }));

    // The check-out time and the hours are no longer sent: the server reads its
    // own clock and takes the hours from the shift's schedule, because both are
    // facts it already holds and neither should be an assertion by the caller.
    // What comes back is authoritative, so reconcile against it rather than
    // leaving the optimistic guess above on screen.
    authFetch(`/api/attendance/${recordId}/check-out`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rating,
        feedbackComment: comment,
        photoBase64: photo?.base64,
        mimeType: photo?.mimeType
      })
    })
      .then(res => res.json())
      .then(data => {
        if (!data.success || !data.record) return;
        setAttendanceRecords(prev => prev.map(r => (r.id === recordId ? data.record : r)));
        // Same for the roster total: if the server credited different hours
        // from the ones guessed below, this is the number that is real.
        if (checkedOutName && typeof data.record.hoursLogged === 'number' && data.record.hoursLogged !== hoursLogged) {
          const correction = data.record.hoursLogged - hoursLogged;
          setVolunteers(prev => prev.map(v =>
            v.name === checkedOutName ? { ...v, totalHours: v.totalHours + correction } : v
          ));
        }
      })
      .catch(() => { /* best-effort backend sync -- local state already has the text feedback */ });

    if (checkedOutName) {
      setVolunteers(prev => prev.map(v => {
        if (v.name === checkedOutName) {
          return {
            ...v,
            totalHours: v.totalHours + hoursLogged,
            completedShiftsCount: v.completedShiftsCount + 1
          };
        }
        return v;
      }));

      // The hours themselves are credited by the check-out request above --
      // the server does it from the record it just closed, so there is nothing
      // to post here. This used to be a separate call that took a name and a
      // number, which meant the totals could be moved by anyone who could
      // reach the URL. The local update above is just the optimistic paint;
      // the next refresh reconciles it with what the server recorded.
    }
  };

  // Handlers for Shifts
  const handleCreateShift = (newShiftData: Omit<PositionShift, 'id' | 'createdAt'>) => {
    const newShift: PositionShift = {
      ...newShiftData,
      id: `shift-${Date.now()}`,
      createdAt: new Date().toISOString().split('T')[0]
    };

    setShifts(prev => [newShift, ...prev]); // optimistic, reconciled by refreshShifts below
    showToast(`✅ 成功發布班次【${newShift.title}】！已有對應 Google 地圖定位與 LINE 預約卡片。`);

    authFetch('/api/shifts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newShift)
    })
      .then(() => refreshShifts())
      .catch(() => showToast('⚠️ 班次已顯示在畫面上，但儲存到伺服器失敗，重新整理後可能會消失。'));

    // Best-effort: keep the reusable "班次範本" library (see AdminSopManager)
    // up to date so future shifts of the same title can be applied from the
    // create-shift form's template dropdown instead of retyped from scratch.
    authFetch('/api/shift-templates/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: newShift.title,
        zone: newShift.zone,
        timeRange: newShift.timeRange,
        requiredCount: newShift.requiredCount,
        skillRequired: newShift.skillRequired,
        description: newShift.description,
        tasks: newShift.tasks,
        locationDetails: newShift.locationDetails,
        attachmentUrl: newShift.attachmentUrl
      })
    }).catch(() => { /* best-effort, ignore failures */ });
  };

  const handleUpdateShift = (updated: PositionShift) => {
    const original = shifts.find(s => s.id === updated.id);
    setShifts(prev => prev.map(s => s.id === updated.id ? updated : s));

    authFetch(`/api/shifts/${encodeURIComponent(updated.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated)
    })
      .then(() => refreshShifts())
      .catch(() => showToast('⚠️ 班次修改未能存到伺服器，請重新整理確認。'));

    const hasScheduleChange = original && (
      original.date !== updated.date ||
      original.timeRange !== updated.timeRange ||
      original.locationDetails !== updated.locationDetails
    );

    if (hasScheduleChange) {
      const affected = shiftSignups.filter(a => a.shiftId === updated.id && (a.status === 'approved' || a.status === 'pending'));
      if (affected.length > 0) {
        const text = `🔄【班次異動通知】您報名的【${updated.title}】時間或地點已更新：\n📅 ${updated.date} (${updated.timeRange})\n📍 ${updated.locationDetails}`;

        Promise.all(affected.map(a => sendLinePush(a.volunteerEmail, text, 'shiftChanges'))).then(results => {
          const realCount = results.filter(r => r.ok && !r.simulated).length;
          showToast(
            realCount > 0
              ? `📲 已真的通知 ${realCount}/${affected.length} 位已報名志工班次異動！`
              : `📲 已排入通知 ${affected.length} 位已報名志工班次異動（模擬效果 — 志工尚未連結 LINE 或未設定 Token）`
          );
        });
      }
    }
  };

  const handleDeleteShift = (id: string) => {
    setShifts(prev => prev.filter(s => s.id !== id));
    showToast('🗑️ 已成功刪除該班次');

    // The server also drops this shift's signups, so pull both back.
    authFetch(`/api/shifts/${encodeURIComponent(id)}`, { method: 'DELETE' })
      .then(() => { refreshShifts(); refreshShiftSignups(); })
      .catch(() => showToast('⚠️ 刪除未能同步到伺服器，請重新整理確認。'));
  };

  // Handlers for Volunteer Applications
  const handleVolunteerApply = (
    shiftId: string,
    name: string,
    email: string,
    phone: string,
    lineId: string,
    notes: string,
    situational?: {
      question: string;
      answer: string;
      assessment?: { score: number; feedback: string; flags: string[]; isFallback?: boolean };
    }
  ) => {
    const shift = shifts.find(s => s.id === shiftId);
    if (!shift) return;

    const newApp: ShiftSignup = {
      id: `app-${Date.now()}`,
      shiftId,
      volunteerName: name,
      volunteerEmail: email,
      volunteerPhone: phone,
      lineId,
      experienceLevel: 'beginner',
      appliedZone: shift.zone,
      status: 'approved',
      appliedAt: new Date().toLocaleString('zh-TW', { hour12: false }),
      notes,
      syncToCalendar: true,
      syncToLine: true,
      situationalQuestion: situational?.question,
      situationalAnswer: situational?.answer,
      aiReadinessAssessment: situational?.assessment
    };

    // Nothing is claimed until the server has stored it.
    //
    // This used to add the booking locally and announce 報名成功 before the
    // request had even been sent. An HTTP error does not reject a fetch, so a
    // refusal -- the shift filled up, the volunteer is suspended, the shift is
    // still a draft -- arrived as a 4xx that nothing looked at, leaving the
    // volunteer reading a success message about a booking that did not exist.
    // Same reasoning as the cancel path below, which was fixed earlier.
    authFetch('/api/shift-signups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newApp)
    })
      .then(async res => {
        const data = await res.json().catch(() => ({} as any));
        if (!res.ok || !data.success) {
          showToast(`⚠️ ${data.error || '報名沒有完成，請重新整理後再試一次。'}`);
          // Re-read either way: the refusal may be because somebody else took
          // the last place, and the board should show that.
          refreshShiftSignups();
          refreshShifts();
          return;
        }

        // The server owns the headcount -- it recomputes it from the signups
        // and hands back the shift, so two volunteers applying from different
        // devices can't overwrite each other's count.
        const saved = data.shift || shift;
        showToast(`🎉【${name}】報名【${shift.title}】成功！招募名額已更新（已報名 ${saved.currentCount}/${saved.requiredCount} 人），並自動同步至 Google 日曆與出勤清單。`);
        refreshShiftSignups();
        refreshShifts();
      })
      .catch(() => showToast('⚠️ 無法連線到伺服器，這次報名沒有送出。'));
  };

  // Waits for the server before claiming anything. The previous version removed
  // the row locally, announced success, then re-fetched -- so when the server
  // refused the delete, the booking silently reappeared under a "已成功取消"
  // toast, which is exactly as confusing as it sounds.
  const handleCancelShiftSignup = async (appId: string) => {
    const targetApp = shiftSignups.find(a => a.id === appId);
    if (!targetApp) return;

    try {
      const res = await authFetch(`/api/shift-signups/${encodeURIComponent(appId)}`, { method: 'DELETE' });
      const data = await res.json();

      if (!data.success) {
        // Inside the rulebook's notice period the server sends people to the
        // other route rather than just refusing, so say which one.
        showToast(data.needsSubstitution
          ? `🤝 ${data.error} 請在此班次上按「找人代班」。`
          : `⚠️ 取消報名失敗：${data.error || '未知錯誤'}`);
        return;
      }

      // The booking is not removed any more, it is marked cancelled -- so the
      // page re-reads rather than deleting the row it can see. Guessing the new
      // headcount locally is what the derived count exists to stop.
      showToast('🗑️ 已取消該班次報名，名額已重新釋出。');
      refreshShiftSignups();
      refreshShifts();
      refreshSubstitutions();
    } catch {
      showToast('⚠️ 取消報名失敗：無法連線到伺服器，請稍後再試。');
    }
  };

  const handleRequestSubstitution = async (appId: string, reason: string) => {
    try {
      const res = await authFetch(`/api/shift-signups/${encodeURIComponent(appId)}/substitution`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason })
      });
      const data = await res.json();
      if (!data.success) { showToast(`⚠️ ${data.error || '發起代班請求失敗'}`); return; }
      showToast(data.request?.raisedLate
        ? '🤝 已發出代班請求。距離班次不到 24 小時，這筆會標記為急件，也請一併在 LINE 群組說一聲。'
        : '🤝 已發出代班請求，其他夥伴看得到了。有人接手時會通知您。');
      refreshSubstitutions();
      refreshShiftSignups();
    } catch {
      showToast('⚠️ 無法連線，代班請求尚未送出。');
    }
  };

  const handleWithdrawSubstitution = async (requestId: string) => {
    try {
      const res = await authFetch(`/api/substitutions/${encodeURIComponent(requestId)}/withdraw`, {
        method: 'POST'
      });
      const data = await res.json();
      if (!data.success) { showToast(`⚠️ ${data.error || '撤回失敗'}`); return; }
      showToast('✅ 已撤回代班請求，這個班次仍然是您的。');
      refreshSubstitutions();
      refreshShiftSignups();
    } catch {
      showToast('⚠️ 無法連線，撤回尚未完成。');
    }
  };

  const [takingSubstitutionId, setTakingSubstitutionId] = useState<string | null>(null);

  const handleTakeSubstitution = async (requestId: string) => {
    if (takingSubstitutionId) return;
    setTakingSubstitutionId(requestId);
    try {
      const res = await authFetch(`/api/substitutions/${encodeURIComponent(requestId)}/take`, {
        method: 'POST'
      });
      const data = await res.json();
      if (!data.success) { showToast(`⚠️ ${data.error || '接手失敗'}`); refreshSubstitutions(); return; }
      showToast('🤝 已接下這個班次，已加入您的排班。請記得當天掃碼簽到！');
      refreshSubstitutions();
      refreshShiftSignups();
      refreshShifts();
    } catch {
      showToast('⚠️ 無法連線，接手尚未完成。');
    } finally {
      setTakingSubstitutionId(null);
    }
  };

  const handleUpdateAppStatus = (id: string, newStatus: SignupStatus, reviewNotes?: string) => {
    setShiftSignups(prev => prev.map(app => {
      if (app.id === id) {
        const updated = {
          ...app,
          status: newStatus,
          reviewNotes,
          reviewedAt: new Date().toLocaleString('zh-TW', { hour12: false })
        };

        if (newStatus === 'rejected' && app.status !== 'rejected') {
          // If rejected from active/approved, decrement count
          setShifts(sPrev => sPrev.map(s => {
            if (s.id === app.shiftId) {
              const newCount = Math.max(0, s.currentCount - 1);
              return {
                ...s,
                currentCount: newCount,
                status: newCount < s.requiredCount ? 'active' : s.status
              };
            }
            return s;
          }));
        } else if (app.status === 'rejected' && (newStatus === 'approved' || newStatus === 'pending')) {
          // If restored from rejected, increment count
          setShifts(sPrev => sPrev.map(s => {
            if (s.id === app.shiftId) {
              const newCount = Math.min(s.requiredCount, s.currentCount + 1);
              return {
                ...s,
                currentCount: newCount,
                status: newCount >= s.requiredCount ? 'full' : s.status
              };
            }
            return s;
          }));
        }

        return updated;
      }
      return app;
    }));

    authFetch(`/api/shift-signups/${encodeURIComponent(id)}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus, reviewNotes })
    })
      .then(() => { refreshShiftSignups(); refreshShifts(); })
      .catch(() => showToast('⚠️ 審核結果未能同步到伺服器，請重新整理確認。'));
  };

  const handleAssignVolunteerToShift = (shiftId: string, volunteer: VolunteerProfile) => {
    // The zone belongs to the shift being filled. It used to be a hardcoded
    // 'dog', so enrolling somebody straight into the cattery, the medical block
    // or the puppy unit filed them as having applied to the dog run. That value
    // is not only displayed: countZoneUsage counts it when reporting whether a
    // zone is still referenced before it is disabled, and a substitute taking
    // the shift over inherits it.
    const shift = shifts.find(s => s.id === shiftId);
    if (!shift) return;

    setShifts(prev => prev.map(s => {
      if (s.id === shiftId) {
        const newCount = Math.min(s.requiredCount, s.currentCount + 1);
        return {
          ...s,
          currentCount: newCount,
          status: newCount >= s.requiredCount ? 'full' : s.status
        };
      }
      return s;
    }));

    const newApp: ShiftSignup = {
      id: `app-ai-${Date.now()}`,
      shiftId,
      volunteerName: volunteer.name,
      volunteerEmail: volunteer.email,
      volunteerPhone: volunteer.phone,
      lineId: volunteer.lineId,
      experienceLevel: volunteer.tier === '志工隊長' ? 'experienced' : volunteer.tier === '資深志工' ? 'intermediate' : 'beginner',
      appliedZone: shift.zone,
      status: 'approved',
      appliedAt: new Date().toLocaleString('zh-TW', { hour12: false }),
      notes: '🤖 AI 自動排班建議智慧直錄名單',
      syncToCalendar: true,
      syncToLine: true
    };
    setShiftSignups(prev => [newApp, ...prev]);

    authFetch('/api/shift-signups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newApp)
    })
      .then(() => { refreshShiftSignups(); refreshShifts(); })
      .catch(() => showToast('⚠️ 直錄名單未能存到伺服器，請重新整理確認。'));
  };

  const pendingCount = shiftSignups.filter(a => a.status === 'pending').length;
  const myEmailLower = (volunteerSession?.email || '').trim().toLowerCase();
  const mySignupsCount = myEmailLower
    ? shiftSignups.filter(a => (a.volunteerEmail || '').trim().toLowerCase() === myEmailLower).length
    : 0;

  // 1. IF NOT LOGGED IN -> RENDER LOGIN PORTAL
  if (!userRole) {
    return (
      <LoginPortal
        onLoginAsAdmin={handleLoginAsAdmin}
        onLoginAsVolunteer={handleLoginAsVolunteer}
        pendingSignupsCount={pendingCount}
        openShiftsCount={shifts.filter(s => s.status === 'active').length}
        totalVolunteersCount={volunteers.length}
        totalServiceHours={volunteers.reduce((sum, v) => sum + v.totalHours, 0)}
        shelterLocationName={shelterLocation.name}
      />
    );
  }

  // 2. IF LOGGED IN -> RENDER INDEPENDENT ROLE INTERFACE
  return (
    <div className="min-h-screen bg-[#FAF6EE] text-[#716053] font-sans antialiased selection:bg-[#F5E6D0] selection:text-[#716053]">
      
      {/* Toast Alert Notification */}
      {toastMessage && (
        <div className="fixed top-20 right-4 z-50 bg-[#716053] text-white p-4 rounded-2xl shadow-xl border border-[#F5E6D0]/30 flex items-center space-x-3 max-w-md animate-in slide-in-from-top-5 duration-300">
          <MessageSquare className="w-5 h-5 text-[#F5E6D0] shrink-0" />
          <p className="text-xs font-semibold leading-relaxed flex-1">{toastMessage}</p>
          <button
            onClick={() => setToastMessage(null)}
            className="text-white/70 hover:text-white p-1 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ========================================================================= */}
      {/* ROLE 1: MANAGER / ADMIN VIEW                                              */}
      {/* ========================================================================= */}
      {userRole === 'admin' && (
        <>
          <AdminNavbar
            activeTab={adminActiveTab}
            setActiveTab={setAdminActiveTab}
            pendingCount={pendingCount}
            openCreateModal={() => setAdminActiveTab('positions')}
            openCheckInModal={() => setIsCheckInModalOpen(true)}
            openRulebookModal={() => setIsRulebookModalOpen(true)}
            currentUser={adminSession}
            onLogout={handleLogout}
          />

          <main className="pb-16">
            <Suspense fallback={<ScreenLoading />}>
            {adminActiveTab === 'dashboard' && (
              <Dashboard
                shifts={shifts}
                shiftSignups={shiftSignups}
                shelterLocation={shelterLocation}
                attendanceRecords={attendanceRecords}
                onAttendanceChanged={refreshAttendance}
                onNavigateToTab={(tab) => {
                  if (tab === 'portal') {
                    handleSwitchToVolunteer();
                  } else {
                    setAdminActiveTab(tab as any);
                  }
                }}
                onApplyForShift={() => handleSwitchToVolunteer()}
                onOpenCheckInModal={() => setIsCheckInModalOpen(true)}
                checkedInCount={attendanceRecords.filter(r => r.status === 'checked_in').length}
                onSendLineToast={showToast}
              />
            )}

            {adminActiveTab === 'positions' && (
              <div className="space-y-6">
                <div className="px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto pt-6">
                  <PeriodRosterPanel
                    onToast={showToast}
                    draftCount={shifts.filter(s => s.status === 'draft').length}
                    onChanged={() => { refreshShifts(); refreshShiftSignups(); }}
                  />
                </div>
              <PositionManager
                shifts={shifts}
                volunteers={volunteers}
                shiftSignups={shiftSignups}
                onCreateShift={handleCreateShift}
                onUpdateShift={handleUpdateShift}
                onDeleteShift={handleDeleteShift}
                onOpenAiGenerator={(shift) => setAiModalShift(shift)}
                onSendLineToast={showToast}
                onAssignVolunteer={handleAssignVolunteerToShift}
                onUpdateSignupStatus={handleUpdateAppStatus}
              />
              </div>
            )}

            {adminActiveTab === 'signups' && (
              <div className="space-y-6">
                <div className="px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto pt-6 space-y-6">
                  <SubstitutionWatchlist requests={substitutions} />
                  <RollCallPanel
                    onToast={showToast}
                    // Recording an absence can suspend the volunteer, and the
                    // toast sends the coordinator to the roster to undo it --
                    // so the roster has to know before they get there.
                    onChanged={() => {
                      refreshShiftSignups(); refreshShifts(); refreshAttendance(); refreshVolunteers();
                    }}
                  />
                </div>
                <ApplicantReview
                  shiftSignups={shiftSignups}
                  shifts={shifts}
                  onUpdateStatus={handleUpdateAppStatus}
                  onSendLineToast={showToast}
                />
              </div>
            )}

            {adminActiveTab === 'roster' && (
              <VolunteerRoster
                volunteers={volunteers}
                onSendLineToast={showToast}
                onVolunteersChanged={refreshVolunteers}
                promotionsRevision={promotionsRevision}
              />
            )}

            {adminActiveTab === 'smartStaffing' && (
              <div className="space-y-6 pt-6 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
                <DutyItemManager zones={zones} onToast={showToast} />
                <AnimalStatusManager onToast={showToast} />
              </div>
            )}

            {adminActiveTab === 'sopManager' && (
              <>
                <div className="space-y-6 pt-6 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
                  <ZoneManager onToast={showToast} onZonesChanged={() => { refreshZones(); refreshShifts(); }} />
                  <AiServiceStatus />
                </div>
                <AdminSopManager onSendLineToast={showToast} />
              </>
            )}
            </Suspense>
          </main>
        </>
      )}

      {/* ========================================================================= */}
      {/* ROLE 2: VOLUNTEER GUIDE VIEW                                              */}
      {/* ========================================================================= */}
      {userRole === 'volunteer' && (
        <>
          <VolunteerNavbar
            activeTab={volunteerActiveTab}
            setActiveTab={setVolunteerActiveTab}
            openCheckInModal={() => setIsCheckInModalOpen(true)}
            openRulebookModal={() => setIsRulebookModalOpen(true)}
            currentUser={volunteerSession}
            mySignupsCount={mySignupsCount}
            onLogout={handleLogout}
          />

          <main className="pb-16">
            <Suspense fallback={<ScreenLoading />}>
            {volunteerActiveTab === 'shifts' && (
              <VolunteerPortal
                shifts={shifts}
                shelterLocation={shelterLocation}
                onApplySubmit={handleVolunteerApply}
                onSendLineToast={showToast}
                onOpenCheckInModal={() => setIsCheckInModalOpen(true)}
                activeSection="shifts"
                currentUser={volunteerSession}
                attendanceRecords={attendanceRecords}
                shiftSignups={shiftSignups}
                onNavigateToTab={(tab) => setVolunteerActiveTab(tab as any)}
                onUpdateProfile={(updates) => setVolunteerSession(prev => prev ? { ...prev, ...updates } : prev)}
                onCancelSignup={handleCancelShiftSignup}
              />
            )}

            {volunteerActiveTab === 'myshifts' && (
              <div className="space-y-6">
                <div className="px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto pt-6">
                  <VolunteerDutyBoard onToast={showToast} />
                </div>
                <VolunteerMyShifts
                  shifts={shifts}
                  shiftSignups={shiftSignups}
                  shelterLocation={shelterLocation}
                  attendanceRecords={attendanceRecords}
                  currentUser={volunteerSession}
                  onOpenCheckInModal={() => setIsCheckInModalOpen(true)}
                  onSendLineToast={showToast}
                  onCancelSignup={handleCancelShiftSignup}
                  substitutions={substitutions}
                  onRequestSubstitution={handleRequestSubstitution}
                  onWithdrawSubstitution={handleWithdrawSubstitution}
                />
                <div className="px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto w-full">
                  <SubstitutionBoard
                    requests={substitutions}
                    myEmail={volunteerSession?.email || ''}
                    busyId={takingSubstitutionId}
                    onTake={handleTakeSubstitution}
                  />
                </div>
              </div>
            )}

            {volunteerActiveTab === 'growth' && (
              <VolunteerPortal
                shifts={shifts}
                shelterLocation={shelterLocation}
                onApplySubmit={handleVolunteerApply}
                onSendLineToast={showToast}
                onOpenCheckInModal={() => setIsCheckInModalOpen(true)}
                activeSection="growth"
                currentUser={volunteerSession}
                attendanceRecords={attendanceRecords}
                shiftSignups={shiftSignups}
                onNavigateToTab={(tab) => setVolunteerActiveTab(tab as any)}
                onUpdateProfile={(updates) => setVolunteerSession(prev => prev ? { ...prev, ...updates } : prev)}
              />
            )}

            {volunteerActiveTab === 'settings' && (
              <VolunteerPortal
                shifts={shifts}
                shelterLocation={shelterLocation}
                onApplySubmit={handleVolunteerApply}
                onSendLineToast={showToast}
                onOpenCheckInModal={() => setIsCheckInModalOpen(true)}
                activeSection="settings"
                currentUser={volunteerSession}
                attendanceRecords={attendanceRecords}
                shiftSignups={shiftSignups}
                onNavigateToTab={(tab) => setVolunteerActiveTab(tab as any)}
                onUpdateProfile={(updates) => setVolunteerSession(prev => prev ? { ...prev, ...updates } : prev)}
              />
            )}

            {volunteerActiveTab === 'sop' && (
              <VolunteerSopGuide
                onOpenRulebookModal={() => setIsRulebookModalOpen(true)}
              />
            )}
            </Suspense>
          </main>
        </>
      )}

      {/* First-login LINE binding prompt (skippable -- see the effect above) */}
      {lineBindPrompt && (
        <div className="fixed inset-0 z-60 bg-[#4A3D34]/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-[28px] max-w-md w-full p-6 border-4 border-[#716053] shadow-xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-[#06C755] text-white flex items-center justify-center shrink-0 border-3 border-[#716053]">
                <MessageSquare className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold font-serif text-lg text-[#716053]">
                  🎈 最後一步：綁定 LINE 帳號
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {lineBindPrompt.name} 你好，綁定後才能收到班次提醒喔！
                </p>
              </div>
            </div>

            <div className="bg-[#FAF6EE] border-3 border-[#716053] rounded-2xl p-4 text-xs text-slate-700 space-y-2">
              <p className="font-bold text-[#716053]">綁定後你將可以：</p>
              <p>🐾 收到班次異動、緊急招募、簽到提醒的 LINE 推播</p>
              <p>🌟 下次直接用 LINE 一鍵登入，不必再開 Google</p>
              <p>🎈 簽退後自動收到服務時數與回饋確認</p>
            </div>

            <div className="flex flex-col sm:flex-row gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  startLineBinding(lineBindPrompt.email).catch(err =>
                    showToast(`⚠️ 無法開啟 LINE 授權：${err.message || '請稍後再試'}`)
                  );
                }}
                className="flex-1 bg-[#06C755] hover:brightness-95 text-white font-extrabold py-3 px-4 rounded-2xl text-sm border-3 border-[#716053] shadow-sm transition cursor-pointer flex items-center justify-center gap-2"
              >
                <MessageSquare className="w-4 h-4" />
                <span>立即綁定 LINE</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  sessionStorage.setItem('paw_line_bind_dismissed', '1');
                  setLineBindPrompt(null);
                  showToast('👌 已略過 LINE 綁定，你隨時可以到「4. LINE 通知與個人設定」完成綁定。');
                }}
                className="bg-[#F2EAD9] hover:bg-[#E6DCCB] text-[#716053] font-bold py-3 px-4 rounded-2xl text-sm border-3 border-[#716053] transition cursor-pointer shrink-0"
              >
                稍後再綁
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Volunteers check in from their own phone (GPS + on-site code, both
          verified server-side). The station modal below is the coordinator's
          view: it shows the rotating code and handles check-outs. */}
      {isCheckInModalOpen && userRole === 'volunteer' && (
        <VolunteerSelfCheckIn
          shifts={shifts}
          shiftSignups={shiftSignups}
          shelterLocation={shelterLocation}
          attendanceRecords={attendanceRecords}
          currentUser={volunteerSession}
          onClose={() => setIsCheckInModalOpen(false)}
          onCheckedIn={refreshAttendance}
          posterCode={posterCode}
          onCheckOutSubmit={handleCheckOutSubmit}
          onSendLineToast={showToast}
        />
      )}

      {/* Coordinator station: rotating check-in code + check-out desk */}
      {isCheckInModalOpen && userRole !== 'volunteer' && (
        <VolunteerCheckInModal
          shifts={shifts}
          shiftSignups={shiftSignups}
          volunteers={volunteers}
          shelterLocation={shelterLocation}
          attendanceRecords={attendanceRecords}
          onClose={() => setIsCheckInModalOpen(false)}
          onCheckInSubmit={handleCheckInSubmit}
          onCheckOutSubmit={handleCheckOutSubmit}
          onSendLineToast={showToast}
          onOpenPoster={() => setIsPosterModalOpen(true)}
        />
      )}

      {isPosterModalOpen && <CheckInPosterModal onClose={() => setIsPosterModalOpen(false)} />}

      {/* AI Post Generation Modal (Admin) */}
      {aiModalShift && (
        <AiPostModal
          shift={aiModalShift}
          locationName={shelterLocation.name}
          onClose={() => setAiModalShift(null)}
          onShareToLine={() => {
            showToast('已成功推播廣播文案至 LINE 志工群組！');
            if (userRole === 'admin') {
              setAdminActiveTab('dashboard');
            }
          }}
        />
      )}

      {/* Rulebook & User Manual Modal */}
      {isRulebookModalOpen && (
        <RulebookManualModal
          onClose={() => setIsRulebookModalOpen(false)}
          onSendLineToast={showToast}
          role={userRole === 'admin' ? 'admin' : 'volunteer'}
        />
      )}

      {/* Floating 24h Upcoming Shift Reminder Card for Volunteer */}
      {userRole === 'volunteer' && upcomingApprovedShiftReminder && dismissedReminderShiftId !== upcomingApprovedShiftReminder.shift.id && (
        <div
          id="upcoming-shift-reminder-card"
          className="fixed bottom-6 right-6 z-50 max-w-sm sm:max-w-md w-[calc(100vw-3rem)] bg-white/95 backdrop-blur-md rounded-3xl border-2 border-[#716053] shadow-2xl overflow-hidden transition-all duration-300 animate-in fade-in slide-in-from-bottom-5"
        >
          {/* Top Banner with pulsating indicator */}
          <div className="bg-[#716053] text-white px-4 sm:px-5 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-400"></span>
              </span>
              <div className="flex items-center gap-1.5 font-serif font-bold text-sm tracking-wide text-white">
                <Bell className="w-4 h-4 text-amber-300" />
                <span>排班出勤提醒</span>
              </div>
              <span className="px-2 py-0.5 bg-amber-400/20 text-amber-300 text-[10px] font-black rounded-full border border-amber-300/30">
                {upcomingApprovedShiftReminder.diffHours > 0
                  ? `倒數約 ${Math.max(1, Math.round(upcomingApprovedShiftReminder.diffHours))} 小時`
                  : '即刻出勤'}
              </span>
            </div>
            <button
              onClick={() => setDismissedReminderShiftId(upcomingApprovedShiftReminder.shift.id)}
              className="p-1 rounded-full text-white/70 hover:text-white hover:bg-white/20 transition cursor-pointer"
              title="關閉提醒"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Card Body */}
          <div className="p-4 sm:p-5 space-y-3.5">
            <div>
              <div className="flex items-center justify-between gap-2">
                <h4 className="font-bold text-slate-900 text-sm sm:text-base font-serif line-clamp-1">
                  {upcomingApprovedShiftReminder.shift.title}
                </h4>
                {ZONE_CONFIGS[upcomingApprovedShiftReminder.shift.zone] && (
                  <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full shrink-0 ${ZONE_CONFIGS[upcomingApprovedShiftReminder.shift.zone].badgeBg}`}>
                    {ZONE_CONFIGS[upcomingApprovedShiftReminder.shift.zone].icon} {ZONE_CONFIGS[upcomingApprovedShiftReminder.shift.zone].name}
                  </span>
                )}
              </div>
            </div>

            <div className="space-y-2 bg-[#FAF8F5] p-3.5 rounded-2xl border border-[#716053] text-xs text-slate-700">
              {/* Date & Time */}
              <div className="flex items-start gap-2.5">
                <Clock className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold text-slate-900">報到時間：</span>
                  <span className="text-slate-800 font-semibold">{upcomingApprovedShiftReminder.shift.date} ({upcomingApprovedShiftReminder.shift.timeRange})</span>
                </div>
              </div>

              {/* Location */}
              <div className="flex items-start gap-2.5">
                <MapPin className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold text-slate-900">報到地點：</span>
                  <span className="text-slate-800 font-medium">
                    {shelterLocation.name}
                    {upcomingApprovedShiftReminder.shift.locationDetails ? ` • ${upcomingApprovedShiftReminder.shift.locationDetails}` : ''}
                  </span>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={() => setIsCheckInModalOpen(true)}
                className="flex-1 py-2 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-2xs transition flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <QrCode className="w-3.5 h-3.5" />
                <span>出勤簽到</span>
              </button>

              {shelterLocation.googleMapsUrl && (
                <a
                  href={shelterLocation.googleMapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="py-2 px-3 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-bold border border-slate-300 transition flex items-center justify-center gap-1"
                >
                  <MapPin className="w-3.5 h-3.5 text-rose-600" />
                  <span>導航</span>
                  <ArrowUpRight className="w-3 h-3" />
                </a>
              )}

              <button
                onClick={() => setVolunteerActiveTab('myshifts')}
                className="py-2 px-3 bg-[#716053]/10 hover:bg-[#716053]/20 text-[#716053] rounded-xl text-xs font-bold transition flex items-center justify-center gap-1 cursor-pointer"
              >
                <span>我的排班</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="bg-[#716053] text-white/80 py-6 text-center text-xs border-t border-[#716053] shadow-xs">
        <p className="font-semibold text-white tracking-wide font-serif italic text-sm">
          🐾 浪浪家園 PawRescue &bull; 流浪動物之家 志工招募與人力資源管理系統
        </p>
        <p className="mt-1 text-white/60 text-[11px] font-sans">
          {userRole === 'admin' ? '管理者 / 社工督導工作站' : '志工夥伴服務專區'} &bull; 整合 Google Maps 據點定位 &bull; Google Calendar 預約時間表 &bull; LINE 官方帳號自動排班
        </p>
      </footer>

    </div>
  );
}
