import { ShelterLocation, ZoneConfig, PositionShift, ShiftSignup, VolunteerProfile, AttendanceRecord, LineOfficialAccount } from '../types';

// Seed value only -- db.ts writes this into the shelter_location table on
// first run. After that, the admin-edited + server-geocoded row in the
// database is the source of truth (see /api/shelter-location).
export const DEFAULT_SHELTER_LOCATION: ShelterLocation = {
  name: '浪浪家園 PawRescue',
  address: '新北市新店區安興路88號 (浪浪之丘)',
  googleMapsUrl: 'https://maps.google.com/?q=24.9620,121.5300',
  openHours: '10:00 - 17:00 (每週一休館)',
  image: 'https://images.unsplash.com/photo-1548767797-d8c844163c4c?auto=format&fit=crop&w=800&q=80',
  lat: 24.9620,
  lng: 121.5300,
  geocoded: false
};

export const DEFAULT_LINE_OFFICIAL_ACCOUNT: LineOfficialAccount = {
  basicId: '@233bvcuk',
  displayName: '浪浪家園 PawRescue',
  avatarUrl: ''
};

export const ZONE_CONFIGS: Record<string, ZoneConfig> = {
  cat: {
    id: 'cat',
    name: '貓舍區 (A棟)',
    code: 'CAT',
    color: '#EF4444', // Red / Rose
    bgLight: 'bg-rose-50 dark:bg-rose-950/40',
    borderClass: 'border-rose-200 dark:border-rose-800',
    textClass: 'text-rose-700 dark:text-rose-300',
    badgeBg: 'bg-rose-100 text-rose-800 dark:bg-rose-900/60 dark:text-rose-200',
    icon: '🐱',
    description: '負責貓咪餵食、鏟貓砂、貓房清潔、親人社會化訓練與陪伴。'
  },
  dog: {
    id: 'dog',
    name: '大狗運動場 (B區)',
    code: 'DOG',
    color: '#10B981', // Green
    bgLight: 'bg-emerald-50 dark:bg-emerald-950/40',
    borderClass: 'border-emerald-200 dark:border-emerald-800',
    textClass: 'text-emerald-700 dark:text-emerald-300',
    badgeBg: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200',
    icon: '🐕',
    description: '負責大型犬牽繩放風散步、洗澡吹乾、戶外大運動場放電與體能訓練。'
  },
  puppy: {
    id: 'puppy',
    name: '幼犬育幼區 (C棟)',
    code: 'PUPPY',
    color: '#F59E0B', // Amber / Yellow
    bgLight: 'bg-amber-50 dark:bg-amber-950/40',
    borderClass: 'border-amber-200 dark:border-amber-800',
    textClass: 'text-amber-700 dark:text-amber-300',
    badgeBg: 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200',
    icon: '🐾',
    description: '負責幼犬泡奶泡泡糧、定時陪伴、保暖監測與基礎衛教。'
  },
  medical: {
    id: 'medical',
    name: '醫療與隔離區 (M棟)',
    code: 'MED',
    color: '#3B82F6', // Blue
    bgLight: 'bg-sky-50 dark:bg-sky-950/40',
    borderClass: 'border-sky-200 dark:border-sky-800',
    textClass: 'text-sky-700 dark:text-sky-300',
    badgeBg: 'bg-sky-100 text-sky-800 dark:bg-sky-900/60 dark:text-sky-200',
    icon: '🏥',
    description: '協助駐院獸醫餵藥、術後照護記錄、深度環境消毒（需資深志工）。'
  },
  logistics: {
    id: 'logistics',
    name: '物資與行政導覽 (L區)',
    code: 'LOG',
    color: '#8B5CF6', // Purple
    bgLight: 'bg-purple-50 dark:bg-purple-950/40',
    borderClass: 'border-purple-200 dark:border-purple-800',
    textClass: 'text-purple-700 dark:text-purple-300',
    badgeBg: 'bg-purple-100 text-purple-800 dark:bg-purple-900/60 dark:text-purple-200',
    icon: '📦',
    description: '民眾捐贈罐頭飼料拆箱分類、參訪導覽解說與義賣現場協助。'
  }
};

// Get today formatted as YYYY-MM-DD
const today = new Date();
const formatDate = (offsetDays: number) => {
  const d = new Date(today);
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().split('T')[0];
};

export const INITIAL_SHIFTS: PositionShift[] = [
  {
    id: 'shift-01',
    title: '早班大狗運動場牽繩放風與洗澡',
    zone: 'dog',
    date: formatDate(0),
    timeRange: '10:00 - 13:00',
    shiftType: 'morning',
    requiredCount: 5,
    currentCount: 3,
    skillRequired: 'intermediate',
    description: '協助園區 25 隻中大型犬輪流至戶外草地散步放電，需能掌控犬隻牽繩拉力。',
    tasks: ['分組帶狗狗放風', '陪伴狗狗社會化', '戶外便便清理', '毛髮梳理'],
    locationDetails: '總部園區 B棟 outdoor大草坪入口處集合',
    attachmentUrl: 'https://example.com/shelter-map-zone-b.pdf',
    status: 'active',
    createdAt: '2026-08-01'
  },
  {
    id: 'shift-02',
    title: '貓舍區午班鏟砂與親人撫摸訓練',
    zone: 'cat',
    date: formatDate(0),
    timeRange: '13:30 - 16:30',
    shiftType: 'afternoon',
    requiredCount: 4,
    currentCount: 4,
    skillRequired: 'beginner',
    description: '協助 A 棟貓舍 12 間貓房進行貓砂盆清潔、補充新鮮主食罐與溫和梳毛。',
    tasks: ['清理貓砂盆', '補充乾糧與水', '零食獎勵親人訓練', '記錄貓咪進食狀況'],
    locationDetails: '總部園區 A棟2樓 幼貓與貓舍大廳',
    attachmentUrl: 'https://example.com/cat-care-guide.pdf',
    status: 'full',
    createdAt: '2026-08-02'
  },
  {
    id: 'shift-03',
    title: '幼犬育幼區餵奶與環境保暖小組',
    zone: 'puppy',
    date: formatDate(1),
    timeRange: '10:00 - 13:00',
    shiftType: 'morning',
    requiredCount: 3,
    currentCount: 1,
    skillRequired: 'beginner',
    description: '剛救援入園的 6 隻小幼犬需要細心照料，補充幼犬奶粉與定時安撫。',
    tasks: ['泡奶粉與定量餵食', '體重量測登記', '更換保暖墊紙巾', '記錄便便形狀'],
    locationDetails: '總部園區 C棟1樓 育幼溫室',
    status: 'active',
    createdAt: '2026-08-03'
  },
  {
    id: 'shift-04',
    title: '醫療隔離區資深志工餵藥與復健紀錄',
    zone: 'medical',
    date: formatDate(1),
    timeRange: '14:00 - 17:00',
    shiftType: 'afternoon',
    requiredCount: 2,
    currentCount: 1,
    skillRequired: 'experienced',
    description: '協助獸醫護理師為術後浪浪包紮更換、給予膠囊藥物，需有 10 小時以上志工經驗。',
    tasks: ['輔助獸醫投藥', '傷口紀錄照相', '隔離舍深度清消', '心理安撫'],
    locationDetails: '總部園區 M棟醫療診所 2號治療室',
    status: 'active',
    createdAt: '2026-08-03'
  },
  {
    id: 'shift-05',
    title: '淡水貓島分院 - 親人貓陪伴與環境清潔',
    zone: 'cat',
    date: formatDate(2),
    timeRange: '11:00 - 15:00',
    shiftType: 'full_day',
    requiredCount: 3,
    currentCount: 1,
    skillRequired: 'beginner',
    description: '淡水分院假日參訪人潮多，需協助維持互動空間乾淨並引導民眾溫和摸貓。',
    tasks: ['維持現場衛生', '輔助民眾互動體驗', '補充貓草與玩具', '送養單發放'],
    locationDetails: '淡水館 2樓觀海貓咪互動區',
    status: 'active',
    createdAt: '2026-08-04'
  },
  {
    id: 'shift-06',
    title: '物資倉儲箱整理與罐頭分類整理',
    zone: 'logistics',
    date: formatDate(2),
    timeRange: '10:00 - 13:00',
    shiftType: 'morning',
    requiredCount: 4,
    currentCount: 2,
    skillRequired: 'beginner',
    description: '週末收到來自全台愛心民眾的箱裝飼料與物資，需要隊伍協助快速分類與歸位。',
    tasks: ['核對捐贈清單', '罐頭按效期排架', '尿布與毯子摺疊整理', '填寫感謝卡'],
    locationDetails: '總部園區 L大樓 1樓愛心資材館',
    status: 'active',
    createdAt: '2026-08-04'
  },
  {
    id: 'shift-07',
    title: '愛心物資緊急卸貨與飼料箱分裝',
    zone: 'logistics',
    date: formatDate(0),
    timeRange: '11:00 - 14:00',
    shiftType: 'morning',
    requiredCount: 5,
    currentCount: 2,
    skillRequired: 'beginner',
    description: '當天大批物資箱到園，需要熱血志工連同放風空檔協助搬運分裝。',
    tasks: ['物資箱卸貨', '罐頭效期清點', '物資分類架上', '盤點登記'],
    locationDetails: '總部園區 L區資材庫大廳',
    status: 'active',
    createdAt: '2026-08-05'
  }
];

export const INITIAL_SHIFT_SIGNUPS: ShiftSignup[] = [
  {
    id: 'app-101',
    shiftId: 'shift-01',
    volunteerName: '陳明宏',
    volunteerEmail: 'chen.mh@gmail.com',
    volunteerPhone: '0912-345-678',
    lineId: 'chen_mh99',
    experienceLevel: 'intermediate',
    appliedZone: 'dog',
    status: 'pending',
    appliedAt: '2026-08-04 14:20',
    notes: '家中有養中型米克斯，具備良好牽繩拉力控制經驗！希望能來幫忙放風。',
    syncToCalendar: true,
    syncToLine: true
  },
  {
    id: 'app-102',
    shiftId: 'shift-03',
    volunteerName: '林雅婷',
    volunteerEmail: 'yating.lin@yahoo.com.tw',
    volunteerPhone: '0988-765-432',
    lineId: 'yating_catlove',
    experienceLevel: 'beginner',
    appliedZone: 'puppy',
    status: 'pending',
    appliedAt: '2026-08-04 16:45',
    notes: '第一次參加志工服務，對幼犬照護非常有熱情！',
    syncToCalendar: true,
    syncToLine: true
  },
  {
    id: 'app-103',
    shiftId: 'shift-04',
    volunteerName: '張志豪',
    volunteerEmail: 'chihhao.chang@outlook.com',
    volunteerPhone: '0933-221-100',
    lineId: 'hao_volunteer',
    experienceLevel: 'experienced',
    appliedZone: 'medical',
    status: 'pending',
    appliedAt: '2026-08-05 08:10',
    notes: '現職獸醫助理，有 20+ 小時浪浪醫療區服務時數證明。',
    syncToCalendar: true,
    syncToLine: true
  },
  {
    id: 'app-104',
    shiftId: 'shift-01',
    volunteerName: '黃秀玲',
    volunteerEmail: 'xiuling.huang@gmail.com',
    volunteerPhone: '0955-112-233',
    lineId: 'xiuling_h',
    experienceLevel: 'intermediate',
    appliedZone: 'dog',
    status: 'approved',
    appliedAt: '2026-08-03 10:00',
    reviewedAt: '2026-08-03 11:30',
    notes: '固定每月份假日出班。',
    reviewNotes: '經驗豐富，審核通過！已同步至 LINE 機器人提醒。',
    syncToCalendar: true,
    syncToLine: true
  },
  {
    id: 'app-105',
    shiftId: 'shift-02',
    volunteerName: '王嘉偉',
    volunteerEmail: 'chiawei.wang@gmail.com',
    volunteerPhone: '0922-888-999',
    lineId: 'wang_cw',
    experienceLevel: 'beginner',
    appliedZone: 'cat',
    status: 'approved',
    appliedAt: '2026-08-02 09:15',
    reviewedAt: '2026-08-02 10:00',
    notes: '養貓 5 年，熟悉貓砂鏟除與親人訓練。',
    syncToCalendar: true,
    syncToLine: true
  },
  {
    id: 'app-106',
    shiftId: 'shift-07',
    volunteerName: '陳明宏',
    volunteerEmail: 'chen.mh@gmail.com',
    volunteerPhone: '0912-345-678',
    lineId: 'chen_mh99',
    experienceLevel: 'intermediate',
    appliedZone: 'logistics',
    status: 'pending',
    appliedAt: '2026-08-05 07:30',
    notes: '如果狗狗放風完有空檔，我也希望能順便支援搬貨分裝。',
    syncToCalendar: true,
    syncToLine: true
  }
];

export const VOLUNTEER_PROFILES: VolunteerProfile[] = [
  {
    id: 'vol-001',
    name: '黃秀玲',
    email: 'xiuling.huang@gmail.com',
    phone: '0955-112-233',
    lineId: 'xiuling_h',
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=300&q=80',
    skills: ['大型犬牽繩', '犬隻社會化', '戶外洗狗'],
    preferredZones: ['dog', 'puppy'],
    totalHours: 48,
    completedShiftsCount: 16,
    tier: '資深志工',
    joinedDate: '2025-03-15',
    emergencyContact: '黃大明 (父親) 0911-222-333'
  },
  {
    id: 'vol-002',
    name: '張志豪',
    email: 'chihhao.chang@outlook.com',
    phone: '0933-221-100',
    lineId: 'hao_volunteer',
    avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=300&q=80',
    skills: ['獸醫助理專業', '術後給藥', '深層消毒', '傷口包紮'],
    preferredZones: ['medical', 'dog'],
    totalHours: 85,
    completedShiftsCount: 28,
    tier: '志工隊長',
    joinedDate: '2024-11-01',
    emergencyContact: '張夫人 0933-221-101'
  },
  {
    id: 'vol-003',
    name: '王嘉偉',
    email: 'chiawei.wang@gmail.com',
    phone: '0922-888-999',
    lineId: 'wang_cw',
    avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=300&q=80',
    skills: ['親人貓撫摸', '貓砂盆清潔', '現場導覽'],
    preferredZones: ['cat', 'logistics'],
    totalHours: 12,
    completedShiftsCount: 4,
    tier: '新進志工',
    joinedDate: '2026-06-10',
    emergencyContact: '王媽媽 0922-888-000'
  }
];

export const INITIAL_ATTENDANCE_RECORDS: AttendanceRecord[] = [
  {
    id: 'att-201',
    signupId: 'app-104',
    volunteerName: '黃秀玲',
    volunteerPhone: '0955-112-233',
    lineId: 'xiuling_h',
    shiftId: 'shift-01',
    shiftTitle: '早班大狗運動場牽繩放風與洗澡',
    zone: 'dog',
    date: formatDate(0),
    checkInTime: `${formatDate(0)} 09:55:12`,
    status: 'checked_in',
    locationVerified: true,
    qrCodeToken: 'LINE-QR-98234-SH1'
  },
  {
    id: 'att-200',
    signupId: 'app-105',
    volunteerName: '王嘉偉',
    volunteerPhone: '0922-888-999',
    lineId: 'wang_cw',
    shiftId: 'shift-02',
    shiftTitle: '貓舍區午班鏟砂與親人撫摸訓練',
    zone: 'cat',
    date: formatDate(-1),
    checkInTime: `${formatDate(-1)} 13:25:00`,
    checkOutTime: `${formatDate(-1)} 16:30:15`,
    status: 'completed',
    hoursLogged: 3,
    locationVerified: true,
    qrCodeToken: 'LINE-QR-76123-SH2',
    rating: 5,
    feedbackComment: '社工說明非常清晰，貓咪環境通風又乾淨！希望能增加自動貓砂盆的使用說明。',
    feedbackSubmittedAt: `${formatDate(-1)} 16:32:40`,
    lineReminderSent: true
  },
  {
    id: 'att-199',
    signupId: 'app-102',
    volunteerName: '張志豪',
    volunteerPhone: '0933-221-100',
    lineId: 'hao_volunteer',
    shiftId: 'shift-04',
    shiftTitle: '醫療隔離區資深志工餵藥與復健紀錄',
    zone: 'medical',
    date: formatDate(-2),
    checkInTime: `${formatDate(-2)} 13:50:00`,
    checkOutTime: `${formatDate(-2)} 17:05:00`,
    status: 'completed',
    hoursLogged: 3,
    locationVerified: true,
    qrCodeToken: 'LINE-QR-54321-MED',
    rating: 5,
    feedbackComment: '獸醫師跟護理師帶得很好，衛教流程很完整，傷口包紮實作收穫很多！',
    feedbackSubmittedAt: `${formatDate(-2)} 17:08:10`,
    lineReminderSent: true
  },
  {
    id: 'att-198',
    signupId: 'app-101',
    volunteerName: '陳美玲',
    volunteerPhone: '0912-345-678',
    lineId: 'meiling_c',
    shiftId: 'shift-05',
    shiftTitle: '淡水貓島分院 - 親人貓陪伴與環境清潔',
    zone: 'cat',
    date: formatDate(-3),
    checkInTime: `${formatDate(-3)} 10:55:00`,
    checkOutTime: `${formatDate(-3)} 15:00:00`,
    status: 'completed',
    hoursLogged: 4,
    locationVerified: true,
    qrCodeToken: 'LINE-QR-88991-CAT',
    rating: 4,
    feedbackComment: '貓島風景很棒，假日遊客蠻多的，建議可以在入口多設置志工專屬置物櫃與水杯區。',
    feedbackSubmittedAt: `${formatDate(-3)} 15:02:50`,
    lineReminderSent: true
  },
  {
    id: 'att-197',
    signupId: 'app-103',
    volunteerName: '林哲銘',
    volunteerPhone: '0988-776-655',
    lineId: 'zheming_l',
    shiftId: 'shift-03',
    shiftTitle: '幼犬溫室照顧與奶粉泡製',
    zone: 'puppy',
    date: formatDate(-4),
    checkInTime: `${formatDate(-4)} 09:58:00`,
    checkOutTime: `${formatDate(-4)} 13:00:00`,
    status: 'completed',
    hoursLogged: 3,
    locationVerified: true,
    qrCodeToken: 'LINE-QR-33221-PUP',
    rating: 5,
    feedbackComment: '小狗超級可愛！洗滌奶瓶區的消毒設備標示很清楚，體驗滿分！',
    feedbackSubmittedAt: `${formatDate(-4)} 13:05:12`,
    lineReminderSent: true
  }
];

