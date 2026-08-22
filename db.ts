import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { VOLUNTEER_PROFILES, INITIAL_ATTENDANCE_RECORDS } from './src/data/mockData';
import { RULEBOOK_CORPUS } from './src/data/rulebookCorpus';
import type { VolunteerProfile, AttendanceRecord, SopContent, SopSection, SopDocument, SopVideo, PromotionRequest, ShiftTemplate } from './src/types';

const dataDir = path.join(process.cwd(), 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'volunteers.db'));

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
      (id, applicationId, volunteerName, volunteerPhone, lineId, shiftId, shiftTitle, branchId, zone, date, checkInTime, checkOutTime, status, hoursLogged, locationVerified, distanceMeters, qrCodeToken, rating, feedbackComment, feedbackSubmittedAt, lineReminderSent, photoUrl)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const r of INITIAL_ATTENDANCE_RECORDS) {
    insertSeed.run(
      r.id, r.applicationId || null, r.volunteerName, r.volunteerPhone || null, r.lineId || null,
      r.shiftId, r.shiftTitle, r.branchId, r.zone, r.date, r.checkInTime, r.checkOutTime || null,
      r.status, r.hoursLogged ?? null, r.locationVerified ? 1 : 0, r.distanceMeters ?? null,
      r.qrCodeToken, r.rating ?? null, r.feedbackComment || null, r.feedbackSubmittedAt || null,
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
    branchId: row.branchId,
    zone: row.zone,
    date: row.date,
    checkInTime: row.checkInTime,
    checkOutTime: row.checkOutTime || undefined,
    status: row.status,
    hoursLogged: row.hoursLogged ?? undefined,
    locationVerified: !!row.locationVerified,
    distanceMeters: row.distanceMeters ?? undefined,
    qrCodeToken: row.qrCodeToken,
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
    r.shiftId, r.shiftTitle, r.branchId, r.zone, r.date, r.checkInTime, r.checkOutTime || null,
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
  db.prepare('INSERT INTO sop_documents (id, title, fileUrl, uploadedAt) VALUES (?, ?, ?, ?)')
    .run(doc.id, doc.title, doc.fileUrl, doc.uploadedAt);
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
    branchId: row.branchId,
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
  branchId: string;
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
      SET branchId = ?, zone = ?, timeRange = ?, requiredCount = ?, skillRequired = ?, description = ?, tasks = ?, locationDetails = ?, attachmentUrl = ?, updatedAt = ?
      WHERE id = ?
    `).run(
      params.branchId, params.zone, params.timeRange, params.requiredCount, params.skillRequired,
      params.description, JSON.stringify(params.tasks), params.locationDetails, params.attachmentUrl || null, nowIso,
      existing.id
    );
    return rowToShiftTemplate(db.prepare('SELECT * FROM shift_templates WHERE id = ?').get(existing.id));
  }

  const id = randomUUID();
  db.prepare(`
    INSERT INTO shift_templates (id, title, branchId, zone, timeRange, requiredCount, skillRequired, description, tasks, locationDetails, attachmentUrl, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, normalizedTitle, params.branchId, params.zone, params.timeRange, params.requiredCount, params.skillRequired,
    params.description, JSON.stringify(params.tasks), params.locationDetails, params.attachmentUrl || null, nowIso
  );
  return rowToShiftTemplate(db.prepare('SELECT * FROM shift_templates WHERE id = ?').get(id));
}

export function deleteShiftTemplate(id: string): void {
  db.prepare('DELETE FROM shift_templates WHERE id = ?').run(id);
}
