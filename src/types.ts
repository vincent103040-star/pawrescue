/**
 * A zone id.
 *
 * This was a union of the five areas that happened to exist when the project
 * started. Areas are now rows in a table an admin edits, so the set is not
 * known at compile time and this can only be a string.
 *
 * The checking did not disappear, it moved: the server refuses to file a shift
 * under a zone that does not exist or is disabled, and resolveZone in
 * data/zones renders a neutral placeholder rather than crashing when an old
 * record points at an area that has since been removed.
 */
export type ZoneCategory = string;

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

// The LINE official account (Messaging API channel) volunteers add as a
// friend for push notifications / rich menu check-in. Admin-editable so the
// account showing in the UI is never a hardcoded value someone forgot to
// update after switching channels.
export interface LineOfficialAccount {
  basicId: string;       // e.g. "@233bvcuk" -- what people search for in LINE
  displayName: string;
  avatarUrl: string;     // '' if not set; UI falls back to a generic icon
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

export type SignupStatus = 'pending' | 'approved' | 'rejected' | 'attended' | 'absent';

export interface ShiftSignup {
  id: string;
  shiftId: string;
  volunteerName: string;
  volunteerEmail: string;
  volunteerPhone: string;
  lineId: string;
  experienceLevel: SkillLevel;
  appliedZone: ZoneCategory;
  status: SignupStatus;
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
  /**
   * This volunteer's user id in the StrayHub CRM, once the two accounts have
   * been paired. Absent until then -- and it stays absent unless the volunteer
   * pairs deliberately. Matching on email instead would silently join two
   * people who share a mailbox, and nothing downstream could tell.
   */
  strayhubUserId?: string;
  /** Which shelter this record belongs to. See currentOrganizationId in db.ts. */
  organizationId?: string;
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
  signupId?: string;
  volunteerName: string;
  volunteerPhone?: string;
  lineId?: string;
  shiftId: string;
  shiftTitle: string;
  zone: ZoneCategory;
  date: string; // YYYY-MM-DD
  checkInTime: string; // Taipei wall clock, for display -- e.g. "2026-08-05 09:58:20"
  checkOutTime?: string; // Taipei wall clock, for display -- e.g. "2026-08-05 13:02:15"
  /**
   * The same two moments as UTC instants. The strings above read well but carry
   * no timezone, so they cannot be compared, subtracted or handed to another
   * system; these can. Absent on rows too malformed to convert.
   */
  checkInAt?: string;  // ISO-8601 UTC, e.g. "2026-08-05T01:58:20.000Z"
  checkOutAt?: string; // ISO-8601 UTC
  status: 'checked_in' | 'completed';
  hoursLogged?: number;
  locationVerified: boolean;
  distanceMeters?: number;
  qrCodeToken: string;
  /** 'self' = volunteer's own phone, GPS + on-site code verified server-side.
      'staff' = a coordinator recorded it on their behalf. */
  checkInMethod?: 'self' | 'staff';
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
  /** Bytes on disk. Used to label the download before someone taps it on mobile data. */
  fileSize?: number;
  /** True when the manual's text was extracted at upload time, so it can be read online. */
  hasText?: boolean;
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

