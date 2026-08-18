export type BranchId = 'main' | 'cat_island' | 'halfway';

export type ZoneCategory = 'cat' | 'dog' | 'puppy' | 'medical' | 'logistics';

export interface Branch {
  id: BranchId;
  name: string;
  address: string;
  googleMapsUrl: string;
  openHours: string;
  image: string;
  zones: string[];
  lat: number;
  lng: number;
}

export interface ZoneConfig {
  id: ZoneCategory;
  name: string;
  code: string;
  color: string; // Hex or Tailwind color class
  bgLight: string;
  borderClass: string;
  textClass: string;
  badgeBg: string;
  icon: string;
  description: string;
}

export type SkillLevel = 'beginner' | 'intermediate' | 'experienced';

export interface PositionShift {
  id: string;
  title: string;
  branchId: BranchId;
  zone: ZoneCategory;
  date: string; // YYYY-MM-DD
  timeRange: string; // e.g., "10:00 - 13:00"
  shiftType: 'morning' | 'afternoon' | 'full_day';
  requiredCount: number;
  currentCount: number;
  skillRequired: SkillLevel;
  description: string;
  tasks: string[];
  locationDetails: string; // e.g. "A棟2樓貓捨 / B戶外草坪"
  attachmentUrl?: string; // e.g. Cloud map photo or guide PDF
  status: 'active' | 'full' | 'cancelled';
  createdAt: string;
}

export type ApplicationStatus = 'pending' | 'approved' | 'rejected' | 'attended' | 'absent';

export interface VolunteerApplication {
  id: string;
  shiftId: string;
  volunteerName: string;
  volunteerEmail: string;
  volunteerPhone: string;
  lineId: string;
  experienceLevel: SkillLevel;
  appliedZone: ZoneCategory;
  status: ApplicationStatus;
  appliedAt: string;
  notes?: string;
  reviewNotes?: string;
  reviewedAt?: string;
  syncToCalendar: boolean;
  syncToLine: boolean;
}

export interface LineNotificationPreferences {
  shiftChanges: boolean;      // 班次異動推播
  urgentRecruitment: boolean; // 緊急招募推播
  checkInReminder: boolean;   // 簽到提醒推播
  reminderTimingHours?: number; // 出班前提醒時數 (預設 1 小時)
}

export interface VolunteerProfile {
  id: string;
  name: string;
  email: string;
  phone: string;
  lineId: string;
  avatar: string;
  skills: string[];
  preferredZones: ZoneCategory[];
  totalHours: number;
  completedShiftsCount: number;
  tier: '新進志工' | '正式志工' | '資深志工' | '志工隊長';
  joinedDate: string;
  emergencyContact: string;
  linePreferences?: LineNotificationPreferences;
  lineLinked?: boolean;
  lineDisplayName?: string;
}

export interface ServiceFeedback {
  id: string;
  attendanceRecordId: string;
  volunteerName: string;
  volunteerPhone?: string;
  lineId?: string;
  shiftId: string;
  shiftTitle: string;
  branchId: BranchId;
  zone: ZoneCategory;
  rating: number; // 1 - 5 stars
  comment: string;
  submittedAt: string;
  smsSent: boolean;
  adminReplied?: boolean;
  adminReplyText?: string;
}

export interface AttendanceRecord {
  id: string;
  applicationId?: string;
  volunteerName: string;
  volunteerPhone?: string;
  lineId?: string;
  shiftId: string;
  shiftTitle: string;
  branchId: BranchId;
  zone: ZoneCategory;
  date: string; // YYYY-MM-DD
  checkInTime: string; // e.g., "2026-08-05 09:58:20"
  checkOutTime?: string; // e.g., "2026-08-05 13:02:15"
  status: 'checked_in' | 'completed';
  hoursLogged?: number;
  locationVerified: boolean;
  distanceMeters?: number;
  qrCodeToken: string;
  // Service Feedback SMS Fields
  rating?: number; // 1 - 5 stars
  feedbackComment?: string;
  feedbackSubmittedAt?: string;
  smsSent?: boolean;
}

export interface LineMessage {
  id: string;
  sender: 'user' | 'bot';
  text: string;
  time: string;
  quickReplies?: string[];
  card?: {
    title: string;
    description: string;
    buttonText: string;
    buttonAction: string;
    imageUrl?: string;
  };
}

export type UserRole = 'admin' | 'volunteer' | null;

export interface AdminUserSession {
  name: string;
  roleTitle: string;
  email: string;
  branchId: BranchId | 'all';
}

export interface VolunteerUserSession {
  name: string;
  phone: string;
  email: string;
  lineId: string;
  tier: '新進志工' | '正式志工' | '資深志工' | '志工隊長';
  totalHours: number;
}

