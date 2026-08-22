export type ZoneCategory = 'cat' | 'dog' | 'puppy' | 'medical' | 'logistics';

// The shelter has a single physical location (previously modeled as 3 fixed
// "branches" -- collapsed to this after that multi-branch architecture was
// removed). Admin-editable; the address is what the admin types, lat/lng/
// googleMapsUrl are server-geocoded from it (see PUT /api/admin/shelter-location).
export interface ShelterLocation {
  name: string;
  address: string;
  googleMapsUrl: string;
  openHours: string;
  image: string;
  lat: number;
  lng: number;
  geocoded: boolean; // false if GOOGLE_MAPS_API_KEY isn't set / geocoding hasn't succeeded yet
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
  situationalQuestion?: string;
  situationalAnswer?: string;
  aiReadinessAssessment?: {
    score: number; // 1-5
    feedback: string; // shown to the applicant, encouraging tone
    flags: string[]; // objective observations shown to the reviewer only
    isFallback?: boolean;
  };
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
  zone: ZoneCategory;
  rating: number; // 1 - 5 stars
  comment: string;
  submittedAt: string;
  lineReminderSent: boolean;
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
  zone: ZoneCategory;
  date: string; // YYYY-MM-DD
  checkInTime: string; // e.g., "2026-08-05 09:58:20"
  checkOutTime?: string; // e.g., "2026-08-05 13:02:15"
  status: 'checked_in' | 'completed';
  hoursLogged?: number;
  locationVerified: boolean;
  distanceMeters?: number;
  qrCodeToken: string;
  // Service Feedback Fields
  rating?: number; // 1 - 5 stars
  feedbackComment?: string;
  feedbackSubmittedAt?: string;
  lineReminderSent?: boolean; // whether a real LINE push confirming the feedback was sent
  photoUrl?: string; // relative URL to the AI-captioned check-out photo, if one was attached
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
}

export interface VolunteerUserSession {
  name: string;
  phone: string;
  email: string;
  lineId: string;
  tier: '新進志工' | '正式志工' | '資深志工' | '志工隊長';
  totalHours: number;
}

// Volunteer rulebook / SOP content -- admin-editable, and the single source of
// truth for both the volunteer-facing SOP guide page and the RAG Q&A corpus
// (each section's text gets re-embedded whenever an admin saves).
export interface SopSectionItem {
  label: string;
  text: string;
}

export interface SopSection {
  id: string;
  icon: string; // emoji
  colorTheme: 'emerald' | 'rose' | 'amber' | 'sky' | 'purple';
  title: string;
  subtitle: string;
  items: SopSectionItem[];
}

export interface SopContent {
  bannerTitle: string;
  bannerSubtitle: string;
  sections: SopSection[];
  emergencyTitle: string;
  emergencyText: string;
  emergencyPhone: string;
}

export interface SopDocument {
  id: string;
  title: string;
  fileUrl: string;
  uploadedAt: string;
}

export interface SopVideo {
  id: string;
  title: string;
  description?: string;
  fileUrl: string;
  uploadedAt: string;
}

// A volunteer's request to be reviewed for tier promotion (e.g. 正式志工 ->
// 資深志工), submitted once their growth checklist hits 100%. Previously this
// was just a client-side toast with nothing persisted anywhere an admin could
// actually see it -- now a real record an admin approves or rejects.
export type PromotionStatus = 'pending' | 'approved' | 'rejected';

export interface PromotionRequest {
  id: string;
  volunteerEmail: string;
  volunteerName: string;
  currentTier: string;
  requestedTier: string;
  completedItems: string[];
  status: PromotionStatus;
  requestedAt: string;
  reviewedAt?: string;
  reviewNote?: string;
}

// A reusable "班次" (shift) template, auto-saved every time an admin publishes
// a new shift (keyed/deduped by title -- republishing a recurring shift like
// "大狗運動場假日牽繩放風" just refreshes its template instead of piling up
// duplicates). Lets the create-shift form offer "套用過去班次範本" instead of
// retyping every field from scratch each time.
export interface ShiftTemplate {
  id: string;
  title: string;
  zone: ZoneCategory;
  timeRange: string;
  requiredCount: number;
  skillRequired: SkillLevel;
  description: string;
  tasks: string[];
  locationDetails: string;
  attachmentUrl?: string;
  updatedAt: string;
}

