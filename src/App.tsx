/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { LoginPortal } from './components/LoginPortal';
import { AdminNavbar } from './components/AdminNavbar';
import { VolunteerNavbar, VolunteerActiveTab } from './components/VolunteerNavbar';
import { Dashboard } from './components/Dashboard';
import { PositionManager } from './components/PositionManager';
import { ApplicantReview } from './components/ApplicantReview';
import { VolunteerPortal } from './components/VolunteerPortal';
import { VolunteerMyShifts } from './components/VolunteerMyShifts';
import { VolunteerSopGuide } from './components/VolunteerSopGuide';
import { IntegrationHub } from './components/IntegrationHub';
import { VolunteerRoster } from './components/VolunteerRoster';
import { AiPostModal } from './components/AiPostModal';
import { VolunteerCheckInModal } from './components/VolunteerCheckInModal';
import { RulebookManualModal } from './components/RulebookManualModal';

import { 
  UserRole, 
  AdminUserSession, 
  VolunteerUserSession, 
  BranchId, 
  PositionShift, 
  VolunteerApplication, 
  VolunteerProfile, 
  ApplicationStatus, 
  AttendanceRecord 
} from './types';
import { BRANCHES, INITIAL_SHIFTS, INITIAL_APPLICATIONS, VOLUNTEER_PROFILES, INITIAL_ATTENDANCE_RECORDS, ZONE_CONFIGS } from './data/mockData';
import { MessageSquare, X, Bell, Clock, MapPin, QrCode, ArrowUpRight } from 'lucide-react';
import { sendLinePush } from './utils/linePush';

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

  const [volunteerSession, setVolunteerSession] = useState<VolunteerUserSession | null>(() => {
    const saved = localStorage.getItem('paw_volunteer_session');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { /* ignore */ }
    }
    return {
      id: 'vol-01',
      name: localStorage.getItem('volunteer_profile_name') || '林小明',
      email: localStorage.getItem('volunteer_profile_email') || 'xiaoming@gmail.com',
      phone: localStorage.getItem('volunteer_profile_phone') || '0912-345-678',
      lineId: localStorage.getItem('volunteer_profile_lineid') || 'xiaoming_line',
      tier: '資深志工',
      totalHours: 24
    };
  });

  // Tab states for separate roles
  const [adminActiveTab, setAdminActiveTab] = useState<'dashboard' | 'positions' | 'applications' | 'integration' | 'roster'>('dashboard');
  const [volunteerActiveTab, setVolunteerActiveTab] = useState<VolunteerActiveTab>('shifts');
  const [selectedBranch, setSelectedBranch] = useState<BranchId | 'all'>('all');

  // Core Data Persistence
  const [shifts, setShifts] = useState<PositionShift[]>(() => {
    const saved = localStorage.getItem('paw_shifts');
    return saved ? JSON.parse(saved) : INITIAL_SHIFTS;
  });

  const [applications, setApplications] = useState<VolunteerApplication[]>(() => {
    const saved = localStorage.getItem('paw_applications');
    return saved ? JSON.parse(saved) : INITIAL_APPLICATIONS;
  });

  const [volunteers, setVolunteers] = useState<VolunteerProfile[]>(() => {
    const saved = localStorage.getItem('paw_volunteers');
    return saved ? JSON.parse(saved) : VOLUNTEER_PROFILES;
  });

  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>(() => {
    const saved = localStorage.getItem('paw_attendance');
    return saved ? JSON.parse(saved) : INITIAL_ATTENDANCE_RECORDS;
  });

  // Load the authoritative volunteer roster from the backend (SQLite) once on mount,
  // replacing whatever was cached in localStorage / seeded from mock data.
  useEffect(() => {
    fetch('/api/volunteers')
      .then(res => res.json())
      .then(data => {
        if (data.success && Array.isArray(data.volunteers)) {
          setVolunteers(data.volunteers);
        }
      })
      .catch(() => { /* keep the locally cached roster if the backend is unreachable */ });
  }, []);

  // Same idea for attendance records: they used to live only in this browser's
  // localStorage, so a volunteer checking in on their phone (via LIFF) and an admin
  // looking at the dashboard on a desktop never saw each other's data.
  useEffect(() => {
    fetch('/api/attendance')
      .then(res => res.json())
      .then(data => {
        if (data.success && Array.isArray(data.records)) {
          setAttendanceRecords(data.records);
        }
      })
      .catch(() => { /* keep the locally cached records if the backend is unreachable */ });
  }, []);

  // Modals state
  const [aiModalShift, setAiModalShift] = useState<PositionShift | null>(null);
  const [isCheckInModalOpen, setIsCheckInModalOpen] = useState(false);
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

  useEffect(() => {
    localStorage.setItem('paw_shifts', JSON.stringify(shifts));
  }, [shifts]);

  useEffect(() => {
    localStorage.setItem('paw_applications', JSON.stringify(applications));
  }, [applications]);

  useEffect(() => {
    localStorage.setItem('paw_volunteers', JSON.stringify(volunteers));
  }, [volunteers]);

  useEffect(() => {
    localStorage.setItem('paw_attendance', JSON.stringify(attendanceRecords));
  }, [attendanceRecords]);

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
    setVolunteerActiveTab('shifts');
    setDismissedReminderShiftId(null);
    showToast(`🐾 歡迎回來，${volunteer.name} 志工夥伴！已進入志工服務專區。`);
  };

  // Check if volunteer has an approved shift starting within 24 hours
  const [dismissedReminderShiftId, setDismissedReminderShiftId] = useState<string | null>(null);

  const upcomingApprovedShiftReminder = useMemo(() => {
    if (userRole !== 'volunteer' || !volunteerSession) return null;

    const vName = volunteerSession.name || localStorage.getItem('volunteer_profile_name') || '林小明';
    const vEmail = volunteerSession.email || localStorage.getItem('volunteer_profile_email') || 'xiaoming@gmail.com';
    const vPhone = volunteerSession.phone || localStorage.getItem('volunteer_profile_phone') || '0912-345-678';
    const vLineId = volunteerSession.lineId || localStorage.getItem('volunteer_profile_lineid') || 'xiaoming_line';

    // Find approved applications for this volunteer
    const myApprovedAppShiftIds = applications
      .filter(a =>
        a.status === 'approved' && (
          (a.volunteerName && a.volunteerName.trim().toLowerCase() === vName.trim().toLowerCase()) ||
          (a.volunteerEmail && a.volunteerEmail.trim().toLowerCase() === vEmail.trim().toLowerCase()) ||
          (a.volunteerPhone && a.volunteerPhone.trim() === vPhone.trim()) ||
          (a.lineId && a.lineId.trim() === vLineId.trim())
        )
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
  }, [userRole, volunteerSession, applications, shifts]);

  const handleLogout = () => {
    setUserRole(null);
    localStorage.removeItem('paw_user_role');
    showToast('👋 已成功登出，返回身分選擇登入首頁');
  };

  const handleSwitchToVolunteer = () => {
    setUserRole('volunteer');
    setVolunteerActiveTab('shifts');
    showToast('🔄 已快速切換為「志工夥伴」服務視角');
  };

  const handleSwitchToAdmin = () => {
    setUserRole('admin');
    setAdminActiveTab('dashboard');
    showToast('🔄 已切換為「管理者 / 社工督導」工作站');
  };

  // Attendance Handlers
  const handleCheckInSubmit = (newRecordData: Omit<AttendanceRecord, 'id'>) => {
    const newRecord: AttendanceRecord = {
      ...newRecordData,
      id: `att-${Date.now()}`
    };
    setAttendanceRecords(prev => [newRecord, ...prev]);

    if (newRecord.applicationId) {
      setApplications(prev => prev.map(a => a.id === newRecord.applicationId ? { ...a, status: 'attended' } : a));
    }

    fetch('/api/attendance/check-in', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newRecord)
    }).catch(() => { /* best-effort backend sync -- local state already has it */ });
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
          smsSent: true
        };
      }
      return r;
    }));

    fetch(`/api/attendance/${recordId}/check-out`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        checkOutTime,
        hoursLogged,
        rating,
        feedbackComment: comment,
        photoBase64: photo?.base64,
        mimeType: photo?.mimeType
      })
    })
      .then(res => res.json())
      .then(data => {
        // Pick up the server-assigned photoUrl once the photo is actually saved to disk.
        if (data.success && data.record?.photoUrl) {
          setAttendanceRecords(prev => prev.map(r => r.id === recordId ? { ...r, photoUrl: data.record.photoUrl } : r));
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

      fetch('/api/volunteers/log-hours', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: checkedOutName, hoursLogged })
      }).catch(() => { /* best-effort backend sync */ });
    }
  };

  // Handlers for Shifts
  const handleCreateShift = (newShiftData: Omit<PositionShift, 'id' | 'createdAt'>) => {
    const newShift: PositionShift = {
      ...newShiftData,
      id: `shift-${Date.now()}`,
      createdAt: new Date().toISOString().split('T')[0]
    };

    setShifts(prev => [newShift, ...prev]);
    showToast(`✅ 成功發布班次【${newShift.title}】！已有對應 Google 地圖定位與 LINE 預約卡片。`);
  };

  const handleUpdateShift = (updated: PositionShift) => {
    const original = shifts.find(s => s.id === updated.id);
    setShifts(prev => prev.map(s => s.id === updated.id ? updated : s));

    const hasScheduleChange = original && (
      original.date !== updated.date ||
      original.timeRange !== updated.timeRange ||
      original.locationDetails !== updated.locationDetails
    );

    if (hasScheduleChange) {
      const affected = applications.filter(a => a.shiftId === updated.id && (a.status === 'approved' || a.status === 'pending'));
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

    const newApp: VolunteerApplication = {
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

    setApplications(prev => [newApp, ...prev]);

    // Update recruitment count on the shift immediately
    setShifts(sPrev => sPrev.map(s => {
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

    const updatedCount = Math.min(shift.requiredCount, shift.currentCount + 1);
    showToast(`🎉【${name}】報名【${shift.title}】成功！招募名額已更新（已報名 ${updatedCount}/${shift.requiredCount} 人），並自動同步至 Google 日曆與出勤清單。`);
  };

  const handleCancelVolunteerApplication = (appId: string) => {
    const targetApp = applications.find(a => a.id === appId);
    if (!targetApp) return;

    setApplications(prev => prev.filter(a => a.id !== appId));

    if (targetApp.status !== 'rejected') {
      setShifts(sPrev => sPrev.map(s => {
        if (s.id === targetApp.shiftId) {
          const newCount = Math.max(0, s.currentCount - 1);
          return {
            ...s,
            currentCount: newCount,
            status: newCount < s.requiredCount ? 'active' : s.status
          };
        }
        return s;
      }));
    }

    showToast('🗑️ 已成功取消該班次報名，名額已重新釋出。');
  };

  const handleUpdateAppStatus = (id: string, newStatus: ApplicationStatus, reviewNotes?: string) => {
    setApplications(prev => prev.map(app => {
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
  };

  const handleAssignVolunteerToShift = (shiftId: string, volunteer: VolunteerProfile) => {
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

    const newApp: VolunteerApplication = {
      id: `app-ai-${Date.now()}`,
      shiftId,
      volunteerName: volunteer.name,
      volunteerEmail: volunteer.email,
      volunteerPhone: volunteer.phone,
      lineId: volunteer.lineId,
      experienceLevel: volunteer.tier === '志工隊長' ? 'experienced' : volunteer.tier === '資深志工' ? 'intermediate' : 'beginner',
      appliedZone: 'dog',
      status: 'approved',
      appliedAt: new Date().toLocaleString('zh-TW', { hour12: false }),
      notes: '🤖 AI 自動排班建議智慧直錄名單',
      syncToCalendar: true,
      syncToLine: true
    };
    setApplications(prev => [newApp, ...prev]);
  };

  const pendingCount = applications.filter(a => a.status === 'pending').length;
  const myApplicationsCount = applications.filter(a => 
    a.volunteerName === (volunteerSession?.name || '林小明') ||
    (volunteerSession?.phone && a.volunteerPhone === volunteerSession.phone)
  ).length;

  // 1. IF NOT LOGGED IN -> RENDER LOGIN PORTAL
  if (!userRole) {
    return (
      <LoginPortal
        onLoginAsAdmin={handleLoginAsAdmin}
        onLoginAsVolunteer={handleLoginAsVolunteer}
        pendingApplicationsCount={pendingCount}
        openShiftsCount={shifts.filter(s => s.status === 'active').length}
        totalVolunteersCount={volunteers.length}
        totalServiceHours={volunteers.reduce((sum, v) => sum + v.totalHours, 0)}
      />
    );
  }

  // 2. IF LOGGED IN -> RENDER INDEPENDENT ROLE INTERFACE
  return (
    <div className="min-h-screen bg-[#f5f5f0] text-[#333333] font-sans antialiased selection:bg-[#E6E2D3] selection:text-[#5A5A40]">
      
      {/* Toast Alert Notification */}
      {toastMessage && (
        <div className="fixed top-20 right-4 z-50 bg-[#5A5A40] text-white p-4 rounded-2xl shadow-xl border border-[#E6E2D3]/30 flex items-center space-x-3 max-w-md animate-in slide-in-from-top-5 duration-300">
          <MessageSquare className="w-5 h-5 text-[#E6E2D3] shrink-0" />
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
            selectedBranch={selectedBranch}
            setSelectedBranch={setSelectedBranch}
            branches={BRANCHES}
            pendingCount={pendingCount}
            openCreateModal={() => setAdminActiveTab('positions')}
            openCheckInModal={() => setIsCheckInModalOpen(true)}
            openRulebookModal={() => setIsRulebookModalOpen(true)}
            currentUser={adminSession}
            onSwitchToVolunteer={handleSwitchToVolunteer}
            onLogout={handleLogout}
          />

          <main className="pb-16">
            {adminActiveTab === 'dashboard' && (
              <Dashboard
                shifts={shifts}
                applications={applications}
                branches={BRANCHES}
                selectedBranch={selectedBranch}
                attendanceRecords={attendanceRecords}
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
              <PositionManager
                shifts={shifts}
                branches={BRANCHES}
                selectedBranch={selectedBranch}
                volunteers={volunteers}
                applications={applications}
                onCreateShift={handleCreateShift}
                onUpdateShift={handleUpdateShift}
                onDeleteShift={handleDeleteShift}
                onOpenAiGenerator={(shift) => setAiModalShift(shift)}
                onSendLineToast={showToast}
                onAssignVolunteer={handleAssignVolunteerToShift}
                onUpdateApplicationStatus={handleUpdateAppStatus}
              />
            )}

            {adminActiveTab === 'applications' && (
              <ApplicantReview
                applications={applications}
                shifts={shifts}
                branches={BRANCHES}
                onUpdateStatus={handleUpdateAppStatus}
                onSendLineToast={showToast}
              />
            )}

            {adminActiveTab === 'integration' && (
              <IntegrationHub
                branches={BRANCHES}
                shifts={shifts}
              />
            )}

            {adminActiveTab === 'roster' && (
              <VolunteerRoster
                volunteers={volunteers}
              />
            )}
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
            selectedBranch={selectedBranch}
            setSelectedBranch={setSelectedBranch}
            branches={BRANCHES}
            openCheckInModal={() => setIsCheckInModalOpen(true)}
            openRulebookModal={() => setIsRulebookModalOpen(true)}
            currentUser={volunteerSession}
            myApplicationsCount={myApplicationsCount}
            onSwitchToAdmin={handleSwitchToAdmin}
            onLogout={handleLogout}
          />

          <main className="pb-16">
            {volunteerActiveTab === 'shifts' && (
              <VolunteerPortal
                shifts={shifts}
                branches={BRANCHES}
                selectedBranch={selectedBranch}
                onApplySubmit={handleVolunteerApply}
                onSendLineToast={showToast}
                onOpenCheckInModal={() => setIsCheckInModalOpen(true)}
                activeSection="shifts"
                currentUser={volunteerSession}
                attendanceRecords={attendanceRecords}
                applications={applications}
                onNavigateToTab={(tab) => setVolunteerActiveTab(tab as any)}
                onUpdateProfile={(updates) => setVolunteerSession(prev => prev ? { ...prev, ...updates } : prev)}
                onCancelApplication={handleCancelVolunteerApplication}
              />
            )}

            {volunteerActiveTab === 'myshifts' && (
              <VolunteerMyShifts
                shifts={shifts}
                applications={applications}
                branches={BRANCHES}
                attendanceRecords={attendanceRecords}
                currentUser={volunteerSession}
                onOpenCheckInModal={() => setIsCheckInModalOpen(true)}
                onSendLineToast={showToast}
                onCancelApplication={handleCancelVolunteerApplication}
              />
            )}

            {volunteerActiveTab === 'growth' && (
              <VolunteerPortal
                shifts={shifts}
                branches={BRANCHES}
                selectedBranch={selectedBranch}
                onApplySubmit={handleVolunteerApply}
                onSendLineToast={showToast}
                onOpenCheckInModal={() => setIsCheckInModalOpen(true)}
                activeSection="growth"
                currentUser={volunteerSession}
                attendanceRecords={attendanceRecords}
                applications={applications}
                onNavigateToTab={(tab) => setVolunteerActiveTab(tab as any)}
                onUpdateProfile={(updates) => setVolunteerSession(prev => prev ? { ...prev, ...updates } : prev)}
              />
            )}

            {volunteerActiveTab === 'settings' && (
              <VolunteerPortal
                shifts={shifts}
                branches={BRANCHES}
                selectedBranch={selectedBranch}
                onApplySubmit={handleVolunteerApply}
                onSendLineToast={showToast}
                onOpenCheckInModal={() => setIsCheckInModalOpen(true)}
                activeSection="settings"
                currentUser={volunteerSession}
                attendanceRecords={attendanceRecords}
                applications={applications}
                onNavigateToTab={(tab) => setVolunteerActiveTab(tab as any)}
                onUpdateProfile={(updates) => setVolunteerSession(prev => prev ? { ...prev, ...updates } : prev)}
              />
            )}

            {volunteerActiveTab === 'sop' && (
              <VolunteerSopGuide
                onOpenRulebookModal={() => setIsRulebookModalOpen(true)}
              />
            )}
          </main>
        </>
      )}

      {/* Volunteer Check-In / Check-Out QR Modal */}
      {isCheckInModalOpen && (
        <VolunteerCheckInModal
          shifts={shifts}
          applications={applications}
          volunteers={volunteers}
          branches={BRANCHES}
          attendanceRecords={attendanceRecords}
          onClose={() => setIsCheckInModalOpen(false)}
          onCheckInSubmit={handleCheckInSubmit}
          onCheckOutSubmit={handleCheckOutSubmit}
          onSendLineToast={showToast}
        />
      )}

      {/* AI Post Generation Modal (Admin) */}
      {aiModalShift && (
        <AiPostModal
          shift={aiModalShift}
          branch={BRANCHES.find(b => b.id === aiModalShift.branchId)}
          onClose={() => setAiModalShift(null)}
          onShareToLine={() => {
            showToast('已成功推播廣播文案至 LINE 志工群組！');
            if (userRole === 'admin') {
              setAdminActiveTab('integration');
            }
          }}
        />
      )}

      {/* Rulebook & User Manual Modal */}
      {isRulebookModalOpen && (
        <RulebookManualModal
          onClose={() => setIsRulebookModalOpen(false)}
          onSendLineToast={showToast}
        />
      )}

      {/* Floating 24h Upcoming Shift Reminder Card for Volunteer */}
      {userRole === 'volunteer' && upcomingApprovedShiftReminder && dismissedReminderShiftId !== upcomingApprovedShiftReminder.shift.id && (
        <div
          id="upcoming-shift-reminder-card"
          className="fixed bottom-6 right-6 z-50 max-w-sm sm:max-w-md w-[calc(100vw-3rem)] bg-white/95 backdrop-blur-md rounded-3xl border-2 border-[#5A5A40]/30 shadow-2xl overflow-hidden transition-all duration-300 animate-in fade-in slide-in-from-bottom-5"
        >
          {/* Top Banner with pulsating indicator */}
          <div className="bg-[#5A5A40] text-white px-4 sm:px-5 py-3 flex items-center justify-between">
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

            <div className="space-y-2 bg-[#FAF8F5] p-3.5 rounded-2xl border border-[#5A5A40]/10 text-xs text-slate-700">
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
                    {BRANCHES.find(b => b.id === upcomingApprovedShiftReminder.shift.branchId)?.name || '總部園區'}
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

              {BRANCHES.find(b => b.id === upcomingApprovedShiftReminder.shift.branchId)?.googleMapsUrl && (
                <a
                  href={BRANCHES.find(b => b.id === upcomingApprovedShiftReminder.shift.branchId)?.googleMapsUrl}
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
                className="py-2 px-3 bg-[#5A5A40]/10 hover:bg-[#5A5A40]/20 text-[#5A5A40] rounded-xl text-xs font-bold transition flex items-center justify-center gap-1 cursor-pointer"
              >
                <span>我的排班</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="bg-[#5A5A40] text-white/80 py-6 text-center text-xs border-t border-[#5A5A40]/20 shadow-xs">
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
