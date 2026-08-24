import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import { randomUUID, randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { VOLUNTEER_PROFILES, INITIAL_ATTENDANCE_RECORDS, INITIAL_SHIFTS, INITIAL_APPLICATIONS, DEFAULT_SHELTER_LOCATION, DEFAULT_LINE_OFFICIAL_ACCOUNT } from './src/data/mockData';
import { RULEBOOK_CORPUS } from './src/data/rulebookCorpus';
import type { VolunteerProfile, AttendanceRecord, PositionShift, VolunteerApplication, SopContent, SopSection, SopDocument, SopVideo, PromotionRequest, ShiftTemplate, ShelterLocation, LineOfficialAccount } from './src/types';

const dataDir = path.join(process.cwd(), 'data');
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, 'volunteers.db');
const db = new DatabaseSync(dbPath);

// WAL lets a reader carry on while a write is in progress, instead of the two
// blocking each other. node:sqlite's API is synchronous and runs on the event
// loop, so a write that waits is a whole server that waits -- the SSE stream
// and anyone mid-check-in included. busy_timeout covers the cases WAL doesn't
// (two writers): wait up to 5 seconds rather than failing the request outright.
// Switching journal mode needs a moment with no other connection to this file,
// so it can fail if a second copy of the server is already running. That is a
// reason to carry on in the old mode, not a reason to refuse to start.
try {
  db.exec('PRAGMA journal_mode = WAL');
} catch {
  console.warn('SQLite: could not switch to WAL (another process has the database open); continuing.');
}
db.exec('PRAGMA busy_timeout = 5000');
// WAL trades a little durability for speed by default; FULL puts it back, so a
// power cut can't lose an already-answered check-in.
db.exec('PRAGMA synchronous = FULL');

db.exec(`
  CREATE TABLE IF NOT EXISTS volunteers (
    email TEXT PRIMARY KEY,
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    lineId TEXT NOT NULL,
    avatar TEXT NOT NULL DEFAULT '',
    skills TEXT NOT NULL DEFAULT '[]',
    preferredZones TEXT NOT NULL DEFAULT '[]',
    totalHours INTEGER NOT NULL DEFAULT 0,
    completedShiftsCount INTEGER NOT NULL DEFAULT 0,
    tier TEXT NOT NULL DEFAULT '新進志工',
    joinedDate TEXT NOT NULL,
    emergencyContact TEXT NOT NULL DEFAULT '',
    providers TEXT NOT NULL DEFAULT '[]',
    status INTEGER NOT NULL DEFAULT 1,
    lastLoginAt TEXT NOT NULL
  )
`);

// Migration: add the lineUserId column for volunteers who have completed real LINE
// Login (as opposed to the human-typed "lineId" handle stored above). Safe to run
// every startup — SQLite errors on a duplicate column, which we just swallow.
try {
  db.exec(`ALTER TABLE volunteers ADD COLUMN lineUserId TEXT NOT NULL DEFAULT ''`);
} catch {
  // column already exists
}
try {
  db.exec(`ALTER TABLE volunteers ADD COLUMN lineDisplayName TEXT NOT NULL DEFAULT ''`);
} catch {
  // column already exists
}
// Migration: LINE notification preference toggles. These used to live only in the
// volunteer's own browser localStorage — which meant an admin's browser (editing a
// shift, approving an application) had no way to know a given volunteer had turned a
// notification type off. Storing them here lets the backend enforce them for real.
try {
  db.exec(`ALTER TABLE volunteers ADD COLUMN linePreferences TEXT NOT NULL DEFAULT ''`);
} catch {
  // column already exists
}

// Seed with the original mock roster on first run only
const seedCount = db.prepare('SELECT COUNT(*) AS c FROM volunteers').get() as { c: number };
if (seedCount.c === 0) {
  const insertSeed = db.prepare(`
    INSERT INTO volunteers
      (email, id, name, phone, lineId, avatar, skills, preferredZones, totalHours, completedShiftsCount, tier, joinedDate, emergencyContact, providers, status, lastLoginAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const nowIso = new Date().toISOString();
  for (const v of VOLUNTEER_PROFILES) {
    insertSeed.run(
      v.email.toLowerCase().trim(),
      v.id,
      v.name,
      v.phone,
      v.lineId,
      v.avatar,
      JSON.stringify(v.skills),
      JSON.stringify(v.preferredZones),
      v.totalHours,
      v.completedShiftsCount,
      v.tier,
      v.joinedDate,
      v.emergencyContact,
      JSON.stringify(['seed']),
      1,
      nowIso
    );
  }
}

function rowToProfile(row: any): VolunteerProfile {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    lineId: row.lineId,
    avatar: row.avatar || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(row.name)}`,
    skills: JSON.parse(row.skills),
    preferredZones: JSON.parse(row.preferredZones),
    totalHours: row.totalHours,
    completedShiftsCount: row.completedShiftsCount,
    tier: row.tier,
    joinedDate: row.joinedDate,
    emergencyContact: row.emergencyContact,
    lineLinked: !!row.lineUserId,
    lineDisplayName: row.lineDisplayName || undefined
  };
}

export function getAllVolunteers(): VolunteerProfile[] {
  const rows = db.prepare('SELECT * FROM volunteers ORDER BY totalHours DESC').all();
  return rows.map(rowToProfile);
}

export function getVolunteerByEmail(email: string): VolunteerProfile | null {
  const row = db.prepare('SELECT * FROM volunteers WHERE email = ?').get(email.toLowerCase().trim());
  return row ? rowToProfile(row) : null;
}

// Upsert triggered by Google login / profile self-edit. Only touches identity fields —
// tier, hours, skills, avatar etc. are left untouched on repeat logins so a volunteer's
// progression isn't reset just by signing back in.
export function upsertVolunteerFromLogin(params: {
  email: string;
  name: string;
  phone: string;
  lineId: string;
}): VolunteerProfile {
  const email = params.email.toLowerCase().trim();
  const existing = db.prepare('SELECT email FROM volunteers WHERE email = ?').get(email);
  const nowIso = new Date().toISOString();

  if (existing) {
    db.prepare(`
      UPDATE volunteers SET name = ?, phone = ?, lineId = ?, providers = ?, lastLoginAt = ?
      WHERE email = ?
    `).run(params.name, params.phone, params.lineId, JSON.stringify(['google.com']), nowIso, email);
  } else {
    db.prepare(`
      INSERT INTO volunteers
        (email, id, name, phone, lineId, avatar, skills, preferredZones, totalHours, completedShiftsCount, tier, joinedDate, emergencyContact, providers, status, lastLoginAt)
      VALUES (?, ?, ?, ?, ?, '', '[]', '[]', 0, 0, '新進志工', ?, '', ?, 1, ?)
    `).run(email, email, params.name, params.phone, params.lineId, nowIso.split('T')[0], JSON.stringify(['google.com']), nowIso);
  }

  return getVolunteerByEmail(email)!;
}

// Update the volunteer-self-editable "extras" that upsertVolunteerFromLogin
// deliberately leaves alone (see its comment) -- emergency contact text and an
// uploaded avatar photo. Only touches the fields actually passed in, and only
// for a volunteer that already has a row (Google login must have happened once
// already to create one).
export function updateVolunteerProfileExtras(
  email: string,
  updates: { emergencyContact?: string; avatar?: string }
): VolunteerProfile | null {
  const normalizedEmail = email.toLowerCase().trim();
  const existing = db.prepare('SELECT email FROM volunteers WHERE email = ?').get(normalizedEmail);
  if (!existing) return null;

  if (updates.emergencyContact !== undefined) {
    db.prepare('UPDATE volunteers SET emergencyContact = ? WHERE email = ?')
      .run(updates.emergencyContact, normalizedEmail);
  }
  if (updates.avatar !== undefined) {
    db.prepare('UPDATE volunteers SET avatar = ? WHERE email = ?')
      .run(updates.avatar, normalizedEmail);
  }

  return getVolunteerByEmail(normalizedEmail);
}

// Admin-side edit of a volunteer's roster details. Deliberately covers only the
// fields a coordinator legitimately maintains -- skills, preferred zones,
// emergency contact, and contact details. Hours, shift count and tier are NOT
// here: those are earned through check-outs and the promotion review flow, and
// letting them be typed in by hand would make the roster's stats meaningless.
// The honour badges shown on each card aren't stored at all; they're derived
// from hours/shifts/skills, so they update themselves once these do.
export function updateVolunteerDetails(
  email: string,
  updates: {
    name?: string;
    phone?: string;
    lineId?: string;
    skills?: string[];
    preferredZones?: string[];
    emergencyContact?: string;
  }
): VolunteerProfile | null {
  const normalizedEmail = email.toLowerCase().trim();
  const existing = db.prepare('SELECT email FROM volunteers WHERE email = ?').get(normalizedEmail);
  if (!existing) return null;

  const setField = (column: string, value: string) => {
    db.prepare(`UPDATE volunteers SET ${column} = ? WHERE email = ?`).run(value, normalizedEmail);
  };

  if (updates.name !== undefined) setField('name', updates.name);
  if (updates.phone !== undefined) setField('phone', updates.phone);
  if (updates.lineId !== undefined) setField('lineId', updates.lineId);
  if (updates.emergencyContact !== undefined) setField('emergencyContact', updates.emergencyContact);
  if (updates.skills !== undefined) setField('skills', JSON.stringify(updates.skills));
  if (updates.preferredZones !== undefined) setField('preferredZones', JSON.stringify(updates.preferredZones));

  return getVolunteerByEmail(normalizedEmail);
}

// Removes a volunteer entirely, so the same person can go through first-time
// registration again from scratch (which is how the LINE-binding onboarding gets
// re-tested). Their pending promotion requests go too, since those are keyed by
// email and would otherwise linger in the admin review queue pointing at nobody.
//
// Attendance records are intentionally left alone: they're the shelter's service
// history, keyed by name rather than email, and silently erasing them would
// change the dashboard's totals. A re-registered volunteer starts at 0 hours
// regardless, because hours live on the volunteer row that was just deleted.
export function deleteVolunteer(email: string): boolean {
  const normalizedEmail = email.toLowerCase().trim();
  const existing = db.prepare('SELECT email FROM volunteers WHERE email = ?').get(normalizedEmail);
  if (!existing) return false;

  db.prepare('DELETE FROM promotion_requests WHERE volunteerEmail = ?').run(normalizedEmail);
  db.prepare('DELETE FROM volunteers WHERE email = ?').run(normalizedEmail);
  // Any session they still hold has to die with the account, otherwise a
  // deleted volunteer keeps a working token until it expires.
  db.prepare('DELETE FROM sessions WHERE identity = ?').run(normalizedEmail);
  return true;
}

// Update hours/shift count after a check-out (best-effort, matched by name today —
// see the App.tsx TODO about matching by email once attendance records carry it).
export function addCompletedShiftHours(name: string, hoursLogged: number) {
  db.prepare(`
    UPDATE volunteers SET totalHours = totalHours + ?, completedShiftsCount = completedShiftsCount + 1
    WHERE name = ?
  `).run(hoursLogged, name);
}

// Real LINE userId (from LINE Login), distinct from the human-typed "lineId" handle —
// only a userId obtained this way can actually be used with the Messaging API push endpoint.
// Upsert-safe: if the volunteer row doesn't exist yet (e.g. LINE Login happens before
// any Google login round-trip has persisted them), create a minimal row instead of
// silently updating zero rows.
export function setLineUserId(email: string, lineUserId: string, lineDisplayName: string) {
  const normalizedEmail = email.toLowerCase().trim();
  const existing = db.prepare('SELECT email FROM volunteers WHERE email = ?').get(normalizedEmail);

  if (existing) {
    db.prepare(`
      UPDATE volunteers SET lineUserId = ?, lineDisplayName = ? WHERE email = ?
    `).run(lineUserId, lineDisplayName, normalizedEmail);
  } else {
    const nowIso = new Date().toISOString();
    db.prepare(`
      INSERT INTO volunteers
        (email, id, name, phone, lineId, avatar, skills, preferredZones, totalHours, completedShiftsCount, tier, joinedDate, emergencyContact, providers, status, lastLoginAt, lineUserId, lineDisplayName)
      VALUES (?, ?, ?, '', '', '', '[]', '[]', 0, 0, '新進志工', ?, '', '["line.me"]', 1, ?, ?, ?)
    `).run(normalizedEmail, normalizedEmail, lineDisplayName || normalizedEmail, nowIso.split('T')[0], nowIso, lineUserId, lineDisplayName);
  }
}

export function getLineUserId(email: string): { lineUserId: string; lineDisplayName: string } | null {
  const row = db.prepare('SELECT lineUserId, lineDisplayName FROM volunteers WHERE email = ?')
    .get(email.toLowerCase().trim()) as { lineUserId: string; lineDisplayName: string } | undefined;
  if (!row || !row.lineUserId) return null;
  return row;
}

// Reverse of getLineUserId: resolves a LINE userId back to the volunteer who
// bound it. This is what makes "sign in with LINE alone" possible on later
// visits -- LINE Login only ever returns an opaque userId (its `email` scope
// needs separate approval from LINE and isn't enabled here), so the account can
// only be recognised if that userId was bound during Google onboarding first.
export function getVolunteerByLineUserId(lineUserId: string): VolunteerProfile | null {
  if (!lineUserId) return null;
  const row = db.prepare('SELECT * FROM volunteers WHERE lineUserId = ?').get(lineUserId);
  return row ? rowToProfile(row) : null;
}

// Same lookup as getLineUserId, but by name -- the check-out flow only has
// volunteerName on the attendance record (no email), so the post-checkout LINE
// reminder push has to match this way. Best-effort: if multiple volunteers share a
// name, or the name doesn't exactly match, this just returns null and the caller
// silently skips the push, same as the "not linked yet" case.
export function getLineUserIdByName(name: string): { lineUserId: string; lineDisplayName: string } | null {
  const row = db.prepare('SELECT lineUserId, lineDisplayName FROM volunteers WHERE name = ?')
    .get(name) as { lineUserId: string; lineDisplayName: string } | undefined;
  if (!row || !row.lineUserId) return null;
  return row;
}

export interface StoredLinePreferences {
  shiftChanges: boolean;
  urgentRecruitment: boolean;
  checkInReminder: boolean;
}

const DEFAULT_LINE_PREFERENCES: StoredLinePreferences = {
  shiftChanges: true,
  urgentRecruitment: true,
  checkInReminder: true
};

export function setLinePreferences(email: string, prefs: StoredLinePreferences) {
  db.prepare(`UPDATE volunteers SET linePreferences = ? WHERE email = ?`)
    .run(JSON.stringify(prefs), email.toLowerCase().trim());
}

// Defaults to all-on (matching the Settings UI's own default) if the volunteer hasn't
// saved any preference yet, or doesn't exist in the DB at all — never silently block a
// real notification just because we lack an explicit preference record.
export function getLinePreferences(email: string): StoredLinePreferences {
  const row = db.prepare('SELECT linePreferences FROM volunteers WHERE email = ?')
    .get(email.toLowerCase().trim()) as { linePreferences: string } | undefined;
  if (!row || !row.linePreferences) return DEFAULT_LINE_PREFERENCES;
  try {
    return { ...DEFAULT_LINE_PREFERENCES, ...JSON.parse(row.linePreferences) };
  } catch {
    return DEFAULT_LINE_PREFERENCES;
  }
}

// Attendance records (check-in/check-out, feedback rating+comment, check-out photo).
// This used to live only in the browser's localStorage, so a different device/browser
// (e.g. a volunteer's phone via LIFF vs. an admin's desktop) never saw the same data.
// Storing it server-side fixes that.
db.exec(`
  CREATE TABLE IF NOT EXISTS attendance_records (
    id TEXT PRIMARY KEY,
    applicationId TEXT,
    volunteerName TEXT NOT NULL,
    volunteerPhone TEXT,
    lineId TEXT,
    shiftId TEXT NOT NULL,
    shiftTitle TEXT NOT NULL,
    branchId TEXT NOT NULL,
    zone TEXT NOT NULL,
    date TEXT NOT NULL,
    checkInTime TEXT NOT NULL,
    checkOutTime TEXT,
    status TEXT NOT NULL,
    hoursLogged REAL,
    locationVerified INTEGER NOT NULL DEFAULT 0,
    distanceMeters REAL,
    qrCodeToken TEXT NOT NULL DEFAULT '',
    rating INTEGER,
    feedbackComment TEXT,
    feedbackSubmittedAt TEXT,
    lineReminderSent INTEGER NOT NULL DEFAULT 0,
    photoUrl TEXT
  )
`);

// Migration: how a check-in was actually proved. 'self' = the volunteer's own
// phone (GPS + on-site code, both verified server-side); 'staff' = a
// coordinator recorded it for someone without a usable phone. Kept explicit so
// a record's trustworthiness is visible rather than assumed.
try { db.exec("ALTER TABLE attendance_records ADD COLUMN checkInMethod TEXT NOT NULL DEFAULT 'staff'"); } catch { /* already added */ }

// Migration: the check-out "notification sent" flag used to be named smsSent from
// back when this was a simulated SMS feature -- it's now a real LINE push (see
// server.ts's /api/attendance/:id/check-out), so rename the column to match on any
// database created before this change. No-ops (and is safely swallowed) on a fresh
// database that was already created with the new column name above.
try {
  db.exec(`ALTER TABLE attendance_records RENAME COLUMN smsSent TO lineReminderSent`);
} catch {
  // already renamed, or this is a fresh install that never had the old column
}

// Seed with the original mock attendance history on first run only, same pattern as
// the volunteers table above.
const attendanceSeedCount = db.prepare('SELECT COUNT(*) AS c FROM attendance_records').get() as { c: number };
if (attendanceSeedCount.c === 0) {
  const insertSeed = db.prepare(`
    INSERT INTO attendance_records
      (id, applicationId, volunteerName, volunteerPhone, lineId, shiftId, shiftTitle, branchId, zone, date, checkInTime, checkOutTime, status, hoursLogged, locationVerified, distanceMeters, qrCodeToken, checkInMethod, rating, feedbackComment, feedbackSubmittedAt, lineReminderSent, photoUrl)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const r of INITIAL_ATTENDANCE_RECORDS) {
    insertSeed.run(
      r.id, r.applicationId || null, r.volunteerName, r.volunteerPhone || null, r.lineId || null,
      r.shiftId, r.shiftTitle, 'shelter', r.zone, r.date, r.checkInTime, r.checkOutTime || null,
      r.status, r.hoursLogged ?? null, r.locationVerified ? 1 : 0, r.distanceMeters ?? null,
      r.qrCodeToken, r.checkInMethod || 'staff', r.rating ?? null, r.feedbackComment || null, r.feedbackSubmittedAt || null,
      r.lineReminderSent ? 1 : 0, r.photoUrl || null
    );
  }
}

function rowToAttendanceRecord(row: any): AttendanceRecord {
  return {
    id: row.id,
    applicationId: row.applicationId || undefined,
    volunteerName: row.volunteerName,
    volunteerPhone: row.volunteerPhone || undefined,
    lineId: row.lineId || undefined,
    shiftId: row.shiftId,
    shiftTitle: row.shiftTitle,
    zone: row.zone,
    date: row.date,
    checkInTime: row.checkInTime,
    checkOutTime: row.checkOutTime || undefined,
    status: row.status,
    hoursLogged: row.hoursLogged ?? undefined,
    locationVerified: !!row.locationVerified,
    distanceMeters: row.distanceMeters ?? undefined,
    qrCodeToken: row.qrCodeToken,
    checkInMethod: row.checkInMethod === 'self' ? 'self' : 'staff',
    rating: row.rating ?? undefined,
    feedbackComment: row.feedbackComment || undefined,
    feedbackSubmittedAt: row.feedbackSubmittedAt || undefined,
    lineReminderSent: !!row.lineReminderSent,
    photoUrl: row.photoUrl || undefined
  };
}

export function getAllAttendanceRecords(): AttendanceRecord[] {
  const rows = db.prepare('SELECT * FROM attendance_records ORDER BY checkInTime DESC').all();
  return rows.map(rowToAttendanceRecord);
}

export function insertAttendanceRecord(r: AttendanceRecord): AttendanceRecord {
  db.prepare(`
    INSERT INTO attendance_records
      (id, applicationId, volunteerName, volunteerPhone, lineId, shiftId, shiftTitle, branchId, zone, date, checkInTime, checkOutTime, status, hoursLogged, locationVerified, distanceMeters, qrCodeToken, rating, feedbackComment, feedbackSubmittedAt, lineReminderSent, photoUrl)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    r.id, r.applicationId || null, r.volunteerName, r.volunteerPhone || null, r.lineId || null,
    r.shiftId, r.shiftTitle, 'shelter', r.zone, r.date, r.checkInTime, r.checkOutTime || null,
    r.status, r.hoursLogged ?? null, r.locationVerified ? 1 : 0, r.distanceMeters ?? null,
    r.qrCodeToken, r.rating ?? null, r.feedbackComment || null, r.feedbackSubmittedAt || null,
    r.lineReminderSent ? 1 : 0, r.photoUrl || null
  );
  return r;
}

export function updateAttendanceCheckout(
  id: string,
  updates: { checkOutTime: string; hoursLogged: number; rating?: number; feedbackComment?: string; feedbackSubmittedAt: string; lineReminderSent: boolean; photoUrl?: string }
): AttendanceRecord | null {
  db.prepare(`
    UPDATE attendance_records
    SET checkOutTime = ?, hoursLogged = ?, status = 'completed', rating = ?, feedbackComment = ?, feedbackSubmittedAt = ?, lineReminderSent = ?, photoUrl = COALESCE(?, photoUrl)
    WHERE id = ?
  `).run(
    updates.checkOutTime, updates.hoursLogged, updates.rating ?? null, updates.feedbackComment || null,
    updates.feedbackSubmittedAt, updates.lineReminderSent ? 1 : 0, updates.photoUrl || null, id
  );
  const row = db.prepare('SELECT * FROM attendance_records WHERE id = ?').get(id);
  return row ? rowToAttendanceRecord(row) : null;
}

// ============================================================================
// Volunteer rulebook / SOP content management (admin-editable) + RAG corpus
// ============================================================================
// This used to be two separate static, build-time things: the hardcoded JSX in
// VolunteerSopGuide.tsx, and a one-time-precomputed embeddings JSON file for
// /api/ai/rag-ask. Both now live here instead, so an admin editing the SOP
// content (or uploading a reference PDF) actually changes what volunteers see
// AND what the RAG Q&A answers from -- re-embedding happens on every save.

db.exec(`
  CREATE TABLE IF NOT EXISTS sop_content (
    id TEXT PRIMARY KEY,
    contentJson TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS rag_chunks (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    sourceId TEXT NOT NULL,
    title TEXT NOT NULL,
    text TEXT NOT NULL,
    embedding TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS sop_documents (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    fileUrl TEXT NOT NULL,
    uploadedAt TEXT NOT NULL
  )
`);

// Byte size of the stored file, so the UI can label a download before someone
// taps it on mobile data. Backfilled from disk below for rows uploaded before
// this column existed.
try { db.exec('ALTER TABLE sop_documents ADD COLUMN fileSize INTEGER'); } catch { /* already added */ }

db.exec(`
  CREATE TABLE IF NOT EXISTS sop_videos (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    fileUrl TEXT NOT NULL,
    uploadedAt TEXT NOT NULL
  )
`);

const DEFAULT_SOP_CONTENT: SopContent = {
  bannerTitle: '志工服務安全規範與毛孩照護 SOP 🐾',
  bannerSubtitle: '服務毛孩的第一原則是「安全第一」。請在每次出勤前複習相關場域規範，遇到特殊狀況立即通報值日社工或駐院獸醫。',
  sections: [
    {
      id: 'sop-dog-walk',
      icon: '🐕',
      colorTheme: 'emerald',
      title: '大狗運動場 & 放風散步 SOP',
      subtitle: 'B區大型犬戶外放電指導',
      items: [
        { label: '雙扣牽繩規範', text: '胸背帶與項圈必須使用雙頭安全扣，出舍前確認鎖緊。' },
        { label: '防爆衝距離', text: '放風時兩犬距離保持至少 3 公尺，嚴禁讓未社會化犬隻正面嗅聞接觸。' },
        { label: '高溫防燙爪', text: '夏季地面超過 35°C 時縮短柏油路行走，改至遮蔭草坪。' }
      ]
    },
    {
      id: 'sop-cat-room',
      icon: '🐱',
      colorTheme: 'rose',
      title: '貓舍區清消與陪伴 SOP',
      subtitle: 'A棟親人貓房與隔離舍規範',
      items: [
        { label: '進出雙道門', text: '進入貓舍必須「關一扇才能開下一扇」，嚴防貓咪奪門暴衝。' },
        { label: '分區清消不混用', text: '隔離房抹布與拖把不得跨房使用，每次接觸後使用次氯酸消毒手部。' },
        { label: '安撫觀察情緒', text: '若貓咪飛機耳或低吼，請暫停互動並通知資深隊長。' }
      ]
    },
    {
      id: 'sop-puppy-nursery',
      icon: '🍼',
      colorTheme: 'amber',
      title: '幼犬育幼與保暖 SOP',
      subtitle: 'C棟幼幼犬照護特別規範',
      items: [
        { label: '泡奶溫度測試', text: '代母乳泡製以 38°C 微溫為準，手背測試不燙方可餵食。' },
        { label: '定時排便刺激', text: '餵食後使用微濕溫棉花輕柔刺激肛門與尿道排泄。' },
        { label: '保暖燈監測', text: '確認保暖燈高度維持 45 公分，避免幼犬過熱或受寒。' }
      ]
    }
  ],
  emergencyTitle: '緊急事件處置與受傷第一道防線',
  emergencyText: '若不幸遭犬貓咬傷抓傷，請立即使用大量生理食鹽水沖洗 15 分鐘，並立即告知督導安排就醫破傷風評估。',
  emergencyPhone: '(02) 2211-8899 #108'
};

// Seed sop_content with the default (previously hardcoded) content on first run only.
const sopContentSeedCount = db.prepare('SELECT COUNT(*) AS c FROM sop_content').get() as { c: number };
if (sopContentSeedCount.c === 0) {
  db.prepare('INSERT INTO sop_content (id, contentJson, updatedAt) VALUES (?, ?, ?)')
    .run('default', JSON.stringify(DEFAULT_SOP_CONTENT), new Date().toISOString());
}

// Seed rag_chunks from the precomputed embeddings file (scripts/embed-rulebook.ts's
// output) on first run only -- reuses those existing vectors instead of spending
// Gemini embedding quota again just to reach the same starting state. Chunks whose
// id matches a default SOP section (or the emergency block) are tagged so future
// admin edits to that section correctly replace rather than duplicate them; every
// other chunk (the "how do I use the admin dashboard" background knowledge) is
// tagged 'static' and is never touched by the SOP content editor.
const ragChunksSeedCount = db.prepare('SELECT COUNT(*) AS c FROM rag_chunks').get() as { c: number };
if (ragChunksSeedCount.c === 0) {
  try {
    const precomputed = JSON.parse(
      fs.readFileSync(path.join(dataDir, 'rulebook_embeddings.json'), 'utf-8')
    ) as { id: string; title: string; text: string; embedding: number[] }[];
    const sectionIds = new Set(DEFAULT_SOP_CONTENT.sections.map(s => s.id));
    const insertChunk = db.prepare(`
      INSERT INTO rag_chunks (id, source, sourceId, title, text, embedding, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const nowIso = new Date().toISOString();
    for (const chunk of precomputed) {
      const source = sectionIds.has(chunk.id) ? 'section' : chunk.id === 'emergency-protocol' ? 'emergency' : 'static';
      insertChunk.run(randomUUID(), source, chunk.id, chunk.title, chunk.text, JSON.stringify(chunk.embedding), nowIso);
    }
  } catch {
    // data/rulebook_embeddings.json not found (e.g. the offline embed script was
    // never run) -- RAG just starts empty and falls back to the keyword matcher
    // in server.ts until an admin saves SOP content or uploads a PDF.
  }
}

export function getSopContent(): SopContent {
  const row = db.prepare('SELECT contentJson FROM sop_content WHERE id = ?').get('default') as { contentJson: string } | undefined;
  return row ? JSON.parse(row.contentJson) : DEFAULT_SOP_CONTENT;
}

export function saveSopContent(content: SopContent): void {
  db.prepare('UPDATE sop_content SET contentJson = ?, updatedAt = ? WHERE id = ?')
    .run(JSON.stringify(content), new Date().toISOString(), 'default');
}

export interface RagChunkRow {
  id: string;
  source: string;
  sourceId: string;
  title: string;
  text: string;
  embedding: number[];
}

export function getAllRagChunks(): RagChunkRow[] {
  const rows = db.prepare('SELECT * FROM rag_chunks').all() as any[];
  return rows.map(r => ({ id: r.id, source: r.source, sourceId: r.sourceId, title: r.title, text: r.text, embedding: JSON.parse(r.embedding) }));
}

// Replaces every chunk previously stored for this (source, sourceId) pair with a
// fresh set -- used both for a single-chunk SOP section re-embed and a
// multi-chunk PDF re-embed (a PDF's text gets split into several chunks).
export function replaceRagChunks(source: string, sourceId: string, chunks: { title: string; text: string; embedding: number[] }[]): void {
  db.prepare('DELETE FROM rag_chunks WHERE source = ? AND sourceId = ?').run(source, sourceId);
  const insertChunk = db.prepare(`
    INSERT INTO rag_chunks (id, source, sourceId, title, text, embedding, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const nowIso = new Date().toISOString();
  for (const c of chunks) {
    insertChunk.run(randomUUID(), source, sourceId, c.title, c.text, JSON.stringify(c.embedding), nowIso);
  }
}

export function deleteRagChunks(source: string, sourceId: string): void {
  db.prepare('DELETE FROM rag_chunks WHERE source = ? AND sourceId = ?').run(source, sourceId);
}

export function getAllSopDocuments(): SopDocument[] {
  return db.prepare('SELECT * FROM sop_documents ORDER BY uploadedAt DESC').all() as any[] as SopDocument[];
}

export function insertSopDocument(doc: SopDocument): void {
  db.prepare('INSERT INTO sop_documents (id, title, fileUrl, uploadedAt, fileSize) VALUES (?, ?, ?, ?, ?)')
    .run(doc.id, doc.title, doc.fileUrl, doc.uploadedAt, doc.fileSize ?? null);
}

/**
 * Fills in fileSize for documents stored before the column existed, by
 * stat-ing the file each row points at. Called once at startup; rows whose
 * file has since been removed are left null and simply render without a size.
 */
export function backfillSopDocumentSizes(sopDocsDir: string): void {
  const rows = db.prepare('SELECT id, fileUrl FROM sop_documents WHERE fileSize IS NULL').all() as any[];
  const update = db.prepare('UPDATE sop_documents SET fileSize = ? WHERE id = ?');
  for (const row of rows) {
    try {
      const name = path.basename(String(row.fileUrl));
      update.run(fs.statSync(path.join(sopDocsDir, name)).size, row.id);
    } catch { /* file is gone -- leave the size unknown */ }
  }
}

/**
 * Rebuilds a document's readable text from the chunks already indexed for RAG
 * at upload time. Lets a phone read a scanned 88MB manual as ~31KB of text
 * instead of downloading the images -- see /api/sop-documents/:id/text.
 */
export function getSopDocumentText(id: string): string | null {
  const rows = db.prepare(
    "SELECT text FROM rag_chunks WHERE source = 'pdf' AND sourceId = ? ORDER BY id"
  ).all(id) as any[];
  if (rows.length === 0) return null;
  return rows.map(r => String(r.text)).join('\n\n');
}

export function deleteSopDocument(id: string): void {
  db.prepare('DELETE FROM sop_documents WHERE id = ?').run(id);
}

export function getAllSopVideos(): SopVideo[] {
  return db.prepare('SELECT * FROM sop_videos ORDER BY uploadedAt DESC').all() as any[] as SopVideo[];
}

export function insertSopVideo(video: SopVideo): void {
  db.prepare('INSERT INTO sop_videos (id, title, description, fileUrl, uploadedAt) VALUES (?, ?, ?, ?, ?)')
    .run(video.id, video.title, video.description || null, video.fileUrl, video.uploadedAt);
}

export function deleteSopVideo(id: string): void {
  db.prepare('DELETE FROM sop_videos WHERE id = ?').run(id);
}

// ============================================================================
// Volunteer tier promotion requests
// ============================================================================
// The growth-checklist "通知管理員審核" button used to just fire a client-side
// toast styled to look like a real admin notification -- nothing was ever
// persisted, so there was genuinely nowhere for an admin to go review it. This
// table is the real record; VolunteerRoster.tsx's admin view lists pending ones.

db.exec(`
  CREATE TABLE IF NOT EXISTS promotion_requests (
    id TEXT PRIMARY KEY,
    volunteerEmail TEXT NOT NULL,
    volunteerName TEXT NOT NULL,
    currentTier TEXT NOT NULL,
    requestedTier TEXT NOT NULL,
    completedItems TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    requestedAt TEXT NOT NULL,
    reviewedAt TEXT,
    reviewNote TEXT
  )
`);

function rowToPromotionRequest(row: any): PromotionRequest {
  return {
    id: row.id,
    volunteerEmail: row.volunteerEmail,
    volunteerName: row.volunteerName,
    currentTier: row.currentTier,
    requestedTier: row.requestedTier,
    completedItems: JSON.parse(row.completedItems),
    status: row.status,
    requestedAt: row.requestedAt,
    reviewedAt: row.reviewedAt || undefined,
    reviewNote: row.reviewNote || undefined
  };
}

export function getAllPromotionRequests(): PromotionRequest[] {
  const rows = db.prepare('SELECT * FROM promotion_requests ORDER BY requestedAt DESC').all();
  return rows.map(rowToPromotionRequest);
}

// A volunteer re-clicking "通知管理員審核" (or re-triggering it via the checklist
// auto-notify) while they already have a pending request just refreshes that same
// row instead of piling up duplicates for the same promotion.
export function upsertPendingPromotionRequest(params: {
  volunteerEmail: string;
  volunteerName: string;
  currentTier: string;
  requestedTier: string;
  completedItems: string[];
}): PromotionRequest {
  const email = params.volunteerEmail.toLowerCase().trim();
  const existing = db.prepare(
    `SELECT id FROM promotion_requests WHERE volunteerEmail = ? AND requestedTier = ? AND status = 'pending'`
  ).get(email, params.requestedTier) as { id: string } | undefined;

  const nowIso = new Date().toISOString();

  if (existing) {
    db.prepare('UPDATE promotion_requests SET completedItems = ?, requestedAt = ? WHERE id = ?')
      .run(JSON.stringify(params.completedItems), nowIso, existing.id);
    return rowToPromotionRequest(db.prepare('SELECT * FROM promotion_requests WHERE id = ?').get(existing.id));
  }

  const id = randomUUID();
  db.prepare(`
    INSERT INTO promotion_requests (id, volunteerEmail, volunteerName, currentTier, requestedTier, completedItems, status, requestedAt)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
  `).run(id, email, params.volunteerName, params.currentTier, params.requestedTier, JSON.stringify(params.completedItems), nowIso);

  return rowToPromotionRequest(db.prepare('SELECT * FROM promotion_requests WHERE id = ?').get(id));
}

// Latest request for this volunteer (any status) -- lets the volunteer-facing UI
// show "審核中" / "已核准" / "已婉拒" instead of just a fire-and-forget button.
export function getLatestPromotionRequestForVolunteer(email: string): PromotionRequest | null {
  const row = db.prepare('SELECT * FROM promotion_requests WHERE volunteerEmail = ? ORDER BY requestedAt DESC LIMIT 1')
    .get(email.toLowerCase().trim());
  return row ? rowToPromotionRequest(row) : null;
}

export function reviewPromotionRequest(id: string, status: 'approved' | 'rejected', reviewNote?: string): PromotionRequest | null {
  db.prepare('UPDATE promotion_requests SET status = ?, reviewedAt = ?, reviewNote = ? WHERE id = ?')
    .run(status, new Date().toISOString(), reviewNote || null, id);
  const row = db.prepare('SELECT * FROM promotion_requests WHERE id = ?').get(id);
  return row ? rowToPromotionRequest(row) : null;
}

// Actually changes the volunteer's tier -- called when an admin approves a
// promotion request, so approval has a real effect instead of just flipping a
// status flag nothing else reads.
export function updateVolunteerTier(email: string, tier: string): void {
  db.prepare('UPDATE volunteers SET tier = ? WHERE email = ?').run(tier, email.toLowerCase().trim());
}

// ============================================================================
// Shift templates ("班次" cards) -- auto-synced every time an admin publishes
// a shift, so the create-shift form can offer "套用過去班次範本" without a
// separate manual template-authoring step. Deliberately its own table (not
// folded into sop_content's sections) since a shift's fields (branch/zone/
// date/quota/tasks/location) don't fit the rulebook's title+subtitle+items
// shape at all.
// ============================================================================
db.exec(`
  CREATE TABLE IF NOT EXISTS shift_templates (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    branchId TEXT NOT NULL,
    zone TEXT NOT NULL,
    timeRange TEXT NOT NULL,
    requiredCount INTEGER NOT NULL,
    skillRequired TEXT NOT NULL,
    description TEXT NOT NULL,
    tasks TEXT NOT NULL,
    locationDetails TEXT NOT NULL,
    attachmentUrl TEXT,
    updatedAt TEXT NOT NULL
  )
`);

function rowToShiftTemplate(row: any): ShiftTemplate {
  return {
    id: row.id,
    title: row.title,
    zone: row.zone,
    timeRange: row.timeRange,
    requiredCount: row.requiredCount,
    skillRequired: row.skillRequired,
    description: row.description,
    tasks: JSON.parse(row.tasks),
    locationDetails: row.locationDetails,
    attachmentUrl: row.attachmentUrl || undefined,
    updatedAt: row.updatedAt
  };
}

export function getAllShiftTemplates(): ShiftTemplate[] {
  const rows = db.prepare('SELECT * FROM shift_templates ORDER BY updatedAt DESC').all();
  return rows.map(rowToShiftTemplate);
}

// Upserts by normalized title -- republishing a recurring shift (e.g. the
// same "大狗運動場假日牽繩放風" every weekend) refreshes its one template
// instead of piling up near-duplicate cards in the dropdown.
export function upsertShiftTemplate(params: {
  title: string;
  zone: string;
  timeRange: string;
  requiredCount: number;
  skillRequired: string;
  description: string;
  tasks: string[];
  locationDetails: string;
  attachmentUrl?: string;
}): ShiftTemplate {
  const normalizedTitle = params.title.trim();
  const nowIso = new Date().toISOString();
  const existing = db.prepare('SELECT id FROM shift_templates WHERE title = ?').get(normalizedTitle) as { id: string } | undefined;

  if (existing) {
    db.prepare(`
      UPDATE shift_templates
      SET zone = ?, timeRange = ?, requiredCount = ?, skillRequired = ?, description = ?, tasks = ?, locationDetails = ?, attachmentUrl = ?, updatedAt = ?
      WHERE id = ?
    `).run(
      params.zone, params.timeRange, params.requiredCount, params.skillRequired,
      params.description, JSON.stringify(params.tasks), params.locationDetails, params.attachmentUrl || null, nowIso,
      existing.id
    );
    return rowToShiftTemplate(db.prepare('SELECT * FROM shift_templates WHERE id = ?').get(existing.id));
  }

  const id = randomUUID();
  db.prepare(`
    INSERT INTO shift_templates (id, title, branchId, zone, timeRange, requiredCount, skillRequired, description, tasks, locationDetails, attachmentUrl, updatedAt)
    VALUES (?, ?, 'shelter', ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, normalizedTitle, params.zone, params.timeRange, params.requiredCount, params.skillRequired,
    params.description, JSON.stringify(params.tasks), params.locationDetails, params.attachmentUrl || null, nowIso
  );
  return rowToShiftTemplate(db.prepare('SELECT * FROM shift_templates WHERE id = ?').get(id));
}

export function deleteShiftTemplate(id: string): void {
  db.prepare('DELETE FROM shift_templates WHERE id = ?').run(id);
}

// ============================================================================
// Shelter location -- the shelter's single physical location (previously a
// hardcoded array of 3 fixed "branches" -- that architecture was removed
// since the org only ever operates from one place). Single-row table, same
// pattern as sop_content. The admin edits name/address/openHours; lat/lng/
// googleMapsUrl are refreshed by server-side geocoding (see server.ts).
// ============================================================================
db.exec(`
  CREATE TABLE IF NOT EXISTS shelter_location (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    name TEXT NOT NULL,
    address TEXT NOT NULL,
    googleMapsUrl TEXT NOT NULL,
    openHours TEXT NOT NULL,
    image TEXT NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    geocoded INTEGER NOT NULL DEFAULT 0
  )
`);

const shelterLocationSeedCount = db.prepare('SELECT COUNT(*) AS c FROM shelter_location').get() as { c: number };
if (shelterLocationSeedCount.c === 0) {
  db.prepare(`
    INSERT INTO shelter_location (id, name, address, googleMapsUrl, openHours, image, lat, lng, geocoded)
    VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    DEFAULT_SHELTER_LOCATION.name, DEFAULT_SHELTER_LOCATION.address, DEFAULT_SHELTER_LOCATION.googleMapsUrl,
    DEFAULT_SHELTER_LOCATION.openHours, DEFAULT_SHELTER_LOCATION.image,
    DEFAULT_SHELTER_LOCATION.lat, DEFAULT_SHELTER_LOCATION.lng, DEFAULT_SHELTER_LOCATION.geocoded ? 1 : 0
  );
}

function rowToShelterLocation(row: any): ShelterLocation {
  return {
    name: row.name,
    address: row.address,
    googleMapsUrl: row.googleMapsUrl,
    openHours: row.openHours,
    image: row.image,
    lat: row.lat,
    lng: row.lng,
    geocoded: !!row.geocoded
  };
}

export function getShelterLocation(): ShelterLocation {
  const row = db.prepare('SELECT * FROM shelter_location WHERE id = 1').get();
  return rowToShelterLocation(row);
}

export function updateShelterLocation(updates: {
  name: string;
  address: string;
  openHours: string;
  googleMapsUrl?: string;
  lat?: number;
  lng?: number;
  geocoded?: boolean;
}): ShelterLocation {
  const current = getShelterLocation();
  const next = {
    name: updates.name,
    address: updates.address,
    openHours: updates.openHours,
    googleMapsUrl: updates.googleMapsUrl ?? current.googleMapsUrl,
    lat: updates.lat ?? current.lat,
    lng: updates.lng ?? current.lng,
    geocoded: updates.geocoded ?? current.geocoded
  };
  db.prepare(`
    UPDATE shelter_location
    SET name = ?, address = ?, openHours = ?, googleMapsUrl = ?, lat = ?, lng = ?, geocoded = ?
    WHERE id = 1
  `).run(next.name, next.address, next.openHours, next.googleMapsUrl, next.lat, next.lng, next.geocoded ? 1 : 0);
  return getShelterLocation();
}

/**
 * An open (not yet checked out) record for this volunteer on this shift, if any.
 * Used to reject a duplicate check-in server-side rather than trusting the page
 * to have noticed.
 */
export function getOpenAttendanceFor(volunteerName: string, shiftId: string): AttendanceRecord | null {
  const row = db.prepare(
    "SELECT * FROM attendance_records WHERE volunteerName = ? AND shiftId = ? AND status = 'checked_in'"
  ).get(volunteerName, shiftId);
  return row ? rowToAttendanceRecord(row) : null;
}

// ============================================================================
// Small key/value store for server-side secrets that must survive a restart.
// ----------------------------------------------------------------------------
// The on-site check-in code is an HMAC of the current time window, so the
// secret behind it has to be stable -- otherwise every deploy would invalidate
// codes people are looking at. Generated once, never leaves the server.
// ============================================================================
db.exec(`
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )
`);

export function getAppSecret(name: string): string {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(name) as any;
  if (row) return row.value;
  const generated = randomBytes(32).toString('hex');
  db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)').run(name, generated);
  return generated;
}

// ============================================================================
// LINE official account (Messaging API channel volunteers add as a friend)
// ----------------------------------------------------------------------------
// Same single-row pattern as shelter_location. Was previously a hardcoded
// mention in the UI text with no actual account behind it; now admin-editable
// so the ID shown always matches whichever channel LINE_CHANNEL_ACCESS_TOKEN
// in .env.local actually points at.
// ============================================================================
db.exec(`
  CREATE TABLE IF NOT EXISTS line_official_account (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    basicId TEXT NOT NULL,
    displayName TEXT NOT NULL,
    avatarUrl TEXT NOT NULL DEFAULT ''
  )
`);

const lineOaSeedCount = db.prepare('SELECT COUNT(*) AS c FROM line_official_account').get() as { c: number };
if (lineOaSeedCount.c === 0) {
  db.prepare('INSERT INTO line_official_account (id, basicId, displayName, avatarUrl) VALUES (1, ?, ?, ?)')
    .run(DEFAULT_LINE_OFFICIAL_ACCOUNT.basicId, DEFAULT_LINE_OFFICIAL_ACCOUNT.displayName, DEFAULT_LINE_OFFICIAL_ACCOUNT.avatarUrl);
}

export function getLineOfficialAccount(): LineOfficialAccount {
  const row = db.prepare('SELECT * FROM line_official_account WHERE id = 1').get() as any;
  return { basicId: row.basicId, displayName: row.displayName, avatarUrl: row.avatarUrl };
}

export function updateLineOfficialAccount(updates: { basicId: string; displayName: string; avatarUrl?: string }): LineOfficialAccount {
  db.prepare('UPDATE line_official_account SET basicId = ?, displayName = ?, avatarUrl = ? WHERE id = 1')
    .run(updates.basicId, updates.displayName, updates.avatarUrl ?? '');
  return getLineOfficialAccount();
}

// ============================================================================
// Shifts & volunteer applications
// ----------------------------------------------------------------------------
// These two lived in the browser's localStorage until now, which meant a shift
// published on the coordinator's desktop simply did not exist for a volunteer
// on their phone -- the single biggest correctness gap in a scheduling system.
// Moving them here makes the server the one source of truth, matching how
// volunteers / attendance / SOP content already work.
// ============================================================================
db.exec(`
  CREATE TABLE IF NOT EXISTS shifts (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    zone TEXT NOT NULL,
    date TEXT NOT NULL,
    timeRange TEXT NOT NULL,
    shiftType TEXT NOT NULL,
    requiredCount INTEGER NOT NULL,
    currentCount INTEGER NOT NULL DEFAULT 0,
    skillRequired TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    tasks TEXT NOT NULL DEFAULT '[]',
    locationDetails TEXT NOT NULL DEFAULT '',
    attachmentUrl TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    createdAt TEXT NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS volunteer_applications (
    id TEXT PRIMARY KEY,
    shiftId TEXT NOT NULL,
    volunteerName TEXT NOT NULL,
    volunteerEmail TEXT NOT NULL DEFAULT '',
    volunteerPhone TEXT NOT NULL DEFAULT '',
    lineId TEXT NOT NULL DEFAULT '',
    experienceLevel TEXT NOT NULL DEFAULT 'beginner',
    appliedZone TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    appliedAt TEXT NOT NULL,
    notes TEXT,
    reviewNotes TEXT,
    reviewedAt TEXT,
    syncToCalendar INTEGER NOT NULL DEFAULT 1,
    syncToLine INTEGER NOT NULL DEFAULT 1,
    situationalQuestion TEXT,
    situationalAnswer TEXT,
    aiReadinessAssessment TEXT
  )
`);

function rowToShift(row: any): PositionShift {
  return {
    id: row.id,
    title: row.title,
    zone: row.zone,
    date: row.date,
    timeRange: row.timeRange,
    shiftType: row.shiftType,
    requiredCount: row.requiredCount,
    currentCount: row.currentCount,
    skillRequired: row.skillRequired,
    description: row.description,
    tasks: JSON.parse(row.tasks),
    locationDetails: row.locationDetails,
    attachmentUrl: row.attachmentUrl || undefined,
    status: row.status,
    createdAt: row.createdAt
  };
}

function rowToApplication(row: any): VolunteerApplication {
  return {
    id: row.id,
    shiftId: row.shiftId,
    volunteerName: row.volunteerName,
    volunteerEmail: row.volunteerEmail,
    volunteerPhone: row.volunteerPhone,
    lineId: row.lineId,
    experienceLevel: row.experienceLevel,
    appliedZone: row.appliedZone,
    status: row.status,
    appliedAt: row.appliedAt,
    notes: row.notes || undefined,
    reviewNotes: row.reviewNotes || undefined,
    reviewedAt: row.reviewedAt || undefined,
    syncToCalendar: !!row.syncToCalendar,
    syncToLine: !!row.syncToLine,
    situationalQuestion: row.situationalQuestion || undefined,
    situationalAnswer: row.situationalAnswer || undefined,
    aiReadinessAssessment: row.aiReadinessAssessment ? JSON.parse(row.aiReadinessAssessment) : undefined
  };
}

export function getAllShifts(): PositionShift[] {
  const rows = db.prepare('SELECT * FROM shifts ORDER BY date ASC, timeRange ASC').all();
  return rows.map(rowToShift);
}

export function insertShift(s: PositionShift): PositionShift {
  db.prepare(`
    INSERT INTO shifts (id, title, zone, date, timeRange, shiftType, requiredCount, currentCount, skillRequired, description, tasks, locationDetails, attachmentUrl, status, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    s.id, s.title, s.zone, s.date, s.timeRange, s.shiftType, s.requiredCount, s.currentCount,
    s.skillRequired, s.description, JSON.stringify(s.tasks), s.locationDetails,
    s.attachmentUrl || null, s.status, s.createdAt
  );
  return s;
}

export function updateShift(s: PositionShift): PositionShift | null {
  const existing = db.prepare('SELECT id FROM shifts WHERE id = ?').get(s.id);
  if (!existing) return null;
  db.prepare(`
    UPDATE shifts SET title = ?, zone = ?, date = ?, timeRange = ?, shiftType = ?, requiredCount = ?,
      currentCount = ?, skillRequired = ?, description = ?, tasks = ?, locationDetails = ?,
      attachmentUrl = ?, status = ? WHERE id = ?
  `).run(
    s.title, s.zone, s.date, s.timeRange, s.shiftType, s.requiredCount, s.currentCount,
    s.skillRequired, s.description, JSON.stringify(s.tasks), s.locationDetails,
    s.attachmentUrl || null, s.status, s.id
  );
  const row = db.prepare('SELECT * FROM shifts WHERE id = ?').get(s.id);
  return row ? rowToShift(row) : null;
}

// Deleting a shift takes its applications with it -- an application pointing at
// a shift that no longer exists would surface as a blank row in the review queue.
export function deleteShift(id: string): boolean {
  const existing = db.prepare('SELECT id FROM shifts WHERE id = ?').get(id);
  if (!existing) return false;
  db.prepare('DELETE FROM volunteer_applications WHERE shiftId = ?').run(id);
  db.prepare('DELETE FROM shifts WHERE id = ?').run(id);
  return true;
}

// Adjusts a shift's filled headcount, clamped so it can never fall below zero,
// and keeps the active/full status in step with it.
export function adjustShiftCount(shiftId: string, delta: number): PositionShift | null {
  const row = db.prepare('SELECT * FROM shifts WHERE id = ?').get(shiftId) as any;
  if (!row) return null;
  const next = Math.max(0, row.currentCount + delta);
  const status = next >= row.requiredCount ? 'full' : 'active';
  db.prepare('UPDATE shifts SET currentCount = ?, status = ? WHERE id = ?').run(next, status, shiftId);
  const updated = db.prepare('SELECT * FROM shifts WHERE id = ?').get(shiftId);
  return updated ? rowToShift(updated) : null;
}

export function getAllApplications(): VolunteerApplication[] {
  const rows = db.prepare('SELECT * FROM volunteer_applications ORDER BY appliedAt DESC').all();
  return rows.map(rowToApplication);
}

export function insertApplication(a: VolunteerApplication): VolunteerApplication {
  db.prepare(`
    INSERT INTO volunteer_applications (id, shiftId, volunteerName, volunteerEmail, volunteerPhone, lineId, experienceLevel, appliedZone, status, appliedAt, notes, reviewNotes, reviewedAt, syncToCalendar, syncToLine, situationalQuestion, situationalAnswer, aiReadinessAssessment)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    a.id, a.shiftId, a.volunteerName, (a.volunteerEmail || '').trim().toLowerCase(), a.volunteerPhone || '', a.lineId || '',
    a.experienceLevel, a.appliedZone, a.status, a.appliedAt, a.notes || null, a.reviewNotes || null,
    a.reviewedAt || null, a.syncToCalendar ? 1 : 0, a.syncToLine ? 1 : 0,
    a.situationalQuestion || null, a.situationalAnswer || null,
    a.aiReadinessAssessment ? JSON.stringify(a.aiReadinessAssessment) : null
  );
  return a;
}

// Applications used to store whatever the sign-up form put in the email field,
// verbatim. A leading space or a capital letter was enough to stop the owner
// from being recognised as the owner, so cancelling their own booking came back
// 403 -- and the page, which re-fetched afterwards, simply put the row back.
// Normalise the existing rows once so old bookings behave like new ones.
db.exec("UPDATE volunteer_applications SET volunteerEmail = LOWER(TRIM(volunteerEmail)) WHERE volunteerEmail <> LOWER(TRIM(volunteerEmail))");

export function updateApplicationStatus(
  id: string,
  status: string,
  reviewNotes?: string
): VolunteerApplication | null {
  const existing = db.prepare('SELECT id FROM volunteer_applications WHERE id = ?').get(id);
  if (!existing) return null;
  db.prepare('UPDATE volunteer_applications SET status = ?, reviewNotes = ?, reviewedAt = ? WHERE id = ?')
    .run(status, reviewNotes || null, new Date().toLocaleString('zh-TW', { hour12: false }), id);
  const row = db.prepare('SELECT * FROM volunteer_applications WHERE id = ?').get(id);
  return row ? rowToApplication(row) : null;
}

export function deleteApplication(id: string): VolunteerApplication | null {
  const row = db.prepare('SELECT * FROM volunteer_applications WHERE id = ?').get(id);
  if (!row) return null;
  db.prepare('DELETE FROM volunteer_applications WHERE id = ?').run(id);
  return rowToApplication(row);
}

// Seeded from the original mock data on first run only, same pattern as the
// volunteers and attendance tables. Placed after the insert helpers so they're
// defined by the time this runs.
const shiftSeedCount = db.prepare('SELECT COUNT(*) AS c FROM shifts').get() as { c: number };
if (shiftSeedCount.c === 0) {
  for (const s of INITIAL_SHIFTS) insertShift(s);
}
const applicationSeedCount = db.prepare('SELECT COUNT(*) AS c FROM volunteer_applications').get() as { c: number };
if (applicationSeedCount.c === 0) {
  for (const a of INITIAL_APPLICATIONS) insertApplication(a);
}

// ============================================================================
// Authentication: admin accounts + server-side sessions
// ----------------------------------------------------------------------------
// Until now "auth" was decorative: the admin password was compared in the
// browser, the signed-in role lived only in localStorage, and every
// /api/admin/* endpoint answered anyone who knew the URL. Anybody could edit
// the rulebook, delete volunteers or approve promotions straight from a
// console. These two tables make the server the authority instead.
//
// Passwords are stored as scrypt hashes with a per-account salt -- never in
// clear text, and never reversible -- using only node:crypto so this adds no
// dependency to a 1GB VM that has OOM-ed during npm install before.
// ============================================================================
db.exec(`
  CREATE TABLE IF NOT EXISTS admin_users (
    username TEXT PRIMARY KEY,
    passwordSalt TEXT NOT NULL,
    passwordHash TEXT NOT NULL,
    roleTitle TEXT NOT NULL DEFAULT '系統管理員',
    email TEXT NOT NULL DEFAULT '',
    createdAt TEXT NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    role TEXT NOT NULL,
    identity TEXT NOT NULL,
    displayName TEXT NOT NULL DEFAULT '',
    createdAt TEXT NOT NULL,
    expiresAt INTEGER NOT NULL
  )
`);

export function hashPassword(password: string, salt?: string): { salt: string; hash: string } {
  const useSalt = salt || randomBytes(16).toString('hex');
  const hash = scryptSync(password, useSalt, 64).toString('hex');
  return { salt: useSalt, hash };
}

/** Constant-time comparison so a wrong password can't be found by timing. */
function passwordMatches(password: string, salt: string, expectedHash: string): boolean {
  const { hash } = hashPassword(password, salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// The administrator account.
//
// There is deliberately no default password any more. This used to seed "0000",
// which meant every copy of this project that never changed it -- including any
// that ended up reachable from the internet -- had a four-digit admin login that
// was written down in the repository.
//
// ADMIN_PASSWORD sets it. With nothing set, a strong random one is generated and
// printed to the server log once, so a fresh clone still works out of the box
// without shipping a credential that everyone already knows.
function seedOrRepairAdmin(): void {
  const envPassword = (process.env.ADMIN_PASSWORD || '').trim();
  const existing = db.prepare('SELECT * FROM admin_users WHERE username = ?').get('Admin') as any;

  const announce = (password: string, reason: string) => {
    console.warn(
      `\n${'='.repeat(64)}\n` +
      `${reason}\n\n` +
      `  帳號：Admin\n` +
      `  密碼：${password}\n\n` +
      `這組密碼只會顯示這一次。請登入後立刻更改，或在 .env.local\n` +
      `設定 ADMIN_PASSWORD 之後重新啟動。\n` +
      `${'='.repeat(64)}\n`
    );
  };

  if (!existing) {
    const password = envPassword || randomBytes(9).toString('base64url');
    const { salt, hash } = hashPassword(password);
    db.prepare(`
      INSERT INTO admin_users (username, passwordSalt, passwordHash, roleTitle, email, createdAt)
      VALUES (?, ?, ?, '系統管理員', 'admin@pawrescue.org.tw', ?)
    `).run('Admin', salt, hash, new Date().toISOString());
    if (!envPassword) announce(password, '已建立管理員帳號（未設定 ADMIN_PASSWORD，本次自動產生密碼）');
    return;
  }

  // When ADMIN_PASSWORD is set it wins, every boot. Applying it only to a
  // brand-new database would mean setting it on an existing one silently did
  // nothing -- the kind of surprise that ends with someone assuming they have
  // changed a password they haven't.
  if (envPassword) {
    if (passwordMatches(envPassword, existing.passwordSalt, existing.passwordHash)) return;
    const { salt, hash } = hashPassword(envPassword);
    db.prepare('UPDATE admin_users SET passwordSalt = ?, passwordHash = ? WHERE username = ?')
      .run(salt, hash, 'Admin');
    db.prepare(`DELETE FROM sessions WHERE role = 'admin'`).run();
    console.warn('管理員密碼已依 ADMIN_PASSWORD 更新，既有的管理者登入階段已失效。');
    return;
  }

  // Databases created before this change already contain the "0000" hash, and
  // deleting the seed above does nothing for them -- which is precisely the
  // case that matters, since those are the ones that have been running. Detect
  // the known-weak values and rotate them.
  const knownWeak = ['0000', '1234', '123456', 'admin', 'password'];
  const usesWeakPassword = knownWeak.some(candidate =>
    passwordMatches(candidate, existing.passwordSalt, existing.passwordHash)
  );
  if (!usesWeakPassword) return;

  const password = randomBytes(9).toString('base64url');
  const { salt, hash } = hashPassword(password);
  db.prepare('UPDATE admin_users SET passwordSalt = ?, passwordHash = ? WHERE username = ?')
    .run(salt, hash, 'Admin');
  // Anyone signed in with the weak password loses their session too.
  db.prepare(`DELETE FROM sessions WHERE role = 'admin'`).run();
  announce(password, '偵測到管理員仍在使用預設弱密碼，已強制更換');
}
seedOrRepairAdmin();

/**
 * Writes a consistent snapshot to data/backups/ and prunes old ones.
 *
 * VACUUM INTO rather than copying volunteers.db: with WAL enabled the file on
 * disk is only half the story, and copying it while a write is in flight can
 * capture a torn page. This asks SQLite for the snapshot instead, which is safe
 * to run against a live database.
 */
export function backupDatabase(keep = 14): { file: string; bytes: number } {
  const backupDir = path.join(dataDir, 'backups');
  fs.mkdirSync(backupDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(backupDir, `volunteers-${stamp}.db`);
  // VACUUM INTO takes a literal, not a bound parameter.
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);

  const snapshots = fs.readdirSync(backupDir)
    .filter(name => name.startsWith('volunteers-') && name.endsWith('.db'))
    .sort();
  for (const stale of snapshots.slice(0, Math.max(0, snapshots.length - keep))) {
    try {
      fs.unlinkSync(path.join(backupDir, stale));
    } catch {
      /* a backup we can't delete is not worth failing the backup over */
    }
  }

  return { file: target, bytes: fs.statSync(target).size };
}

export function verifyAdminCredentials(
  username: string,
  password: string
): { username: string; roleTitle: string; email: string } | null {
  const row = db.prepare('SELECT * FROM admin_users WHERE username = ?').get(String(username || '').trim()) as any;
  if (!row) return null;
  if (!passwordMatches(String(password || ''), row.passwordSalt, row.passwordHash)) return null;
  return { username: row.username, roleTitle: row.roleTitle, email: row.email };
}

export function changeAdminPassword(username: string, newPassword: string): boolean {
  const row = db.prepare('SELECT username FROM admin_users WHERE username = ?').get(username);
  if (!row) return false;
  const { salt, hash } = hashPassword(newPassword);
  db.prepare('UPDATE admin_users SET passwordSalt = ?, passwordHash = ? WHERE username = ?')
    .run(salt, hash, username);
  // Every existing session for this account is dropped, so a password change
  // actually locks out whoever was already signed in with the old one.
  db.prepare(`DELETE FROM sessions WHERE role = 'admin' AND identity = ?`).run(username);
  return true;
}

export interface SessionRecord {
  token: string;
  role: 'admin' | 'volunteer';
  identity: string;     // admin username, or volunteer email
  displayName: string;
}

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function createSession(role: 'admin' | 'volunteer', identity: string, displayName: string): string {
  // Opportunistic cleanup so expired rows don't accumulate forever.
  db.prepare('DELETE FROM sessions WHERE expiresAt < ?').run(Date.now());

  const token = randomBytes(32).toString('hex');
  db.prepare(`
    INSERT INTO sessions (token, role, identity, displayName, createdAt, expiresAt)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(token, role, identity, displayName || '', new Date().toISOString(), Date.now() + SESSION_TTL_MS);
  return token;
}

export function getSession(token: string): SessionRecord | null {
  if (!token) return null;
  const row = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token) as any;
  if (!row) return null;
  if (row.expiresAt < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return { token: row.token, role: row.role, identity: row.identity, displayName: row.displayName };
}

export function destroySession(token: string): void {
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

/** Drops every session belonging to a volunteer -- used when they're deleted. */
export function destroySessionsForIdentity(identity: string): void {
  db.prepare('DELETE FROM sessions WHERE identity = ?').run(identity.toLowerCase().trim());
}
