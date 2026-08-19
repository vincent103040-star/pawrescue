import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import { VOLUNTEER_PROFILES, INITIAL_ATTENDANCE_RECORDS } from './src/data/mockData';
import type { VolunteerProfile, AttendanceRecord } from './src/types';

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
    smsSent INTEGER NOT NULL DEFAULT 0,
    photoUrl TEXT
  )
`);

// Seed with the original mock attendance history on first run only, same pattern as
// the volunteers table above.
const attendanceSeedCount = db.prepare('SELECT COUNT(*) AS c FROM attendance_records').get() as { c: number };
if (attendanceSeedCount.c === 0) {
  const insertSeed = db.prepare(`
    INSERT INTO attendance_records
      (id, applicationId, volunteerName, volunteerPhone, lineId, shiftId, shiftTitle, branchId, zone, date, checkInTime, checkOutTime, status, hoursLogged, locationVerified, distanceMeters, qrCodeToken, rating, feedbackComment, feedbackSubmittedAt, smsSent, photoUrl)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const r of INITIAL_ATTENDANCE_RECORDS) {
    insertSeed.run(
      r.id, r.applicationId || null, r.volunteerName, r.volunteerPhone || null, r.lineId || null,
      r.shiftId, r.shiftTitle, r.branchId, r.zone, r.date, r.checkInTime, r.checkOutTime || null,
      r.status, r.hoursLogged ?? null, r.locationVerified ? 1 : 0, r.distanceMeters ?? null,
      r.qrCodeToken, r.rating ?? null, r.feedbackComment || null, r.feedbackSubmittedAt || null,
      r.smsSent ? 1 : 0, r.photoUrl || null
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
    smsSent: !!row.smsSent,
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
      (id, applicationId, volunteerName, volunteerPhone, lineId, shiftId, shiftTitle, branchId, zone, date, checkInTime, checkOutTime, status, hoursLogged, locationVerified, distanceMeters, qrCodeToken, rating, feedbackComment, feedbackSubmittedAt, smsSent, photoUrl)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    r.id, r.applicationId || null, r.volunteerName, r.volunteerPhone || null, r.lineId || null,
    r.shiftId, r.shiftTitle, r.branchId, r.zone, r.date, r.checkInTime, r.checkOutTime || null,
    r.status, r.hoursLogged ?? null, r.locationVerified ? 1 : 0, r.distanceMeters ?? null,
    r.qrCodeToken, r.rating ?? null, r.feedbackComment || null, r.feedbackSubmittedAt || null,
    r.smsSent ? 1 : 0, r.photoUrl || null
  );
  return r;
}

export function updateAttendanceCheckout(
  id: string,
  updates: { checkOutTime: string; hoursLogged: number; rating?: number; feedbackComment?: string; feedbackSubmittedAt: string; smsSent: boolean; photoUrl?: string }
): AttendanceRecord | null {
  db.prepare(`
    UPDATE attendance_records
    SET checkOutTime = ?, hoursLogged = ?, status = 'completed', rating = ?, feedbackComment = ?, feedbackSubmittedAt = ?, smsSent = ?, photoUrl = COALESCE(?, photoUrl)
    WHERE id = ?
  `).run(
    updates.checkOutTime, updates.hoursLogged, updates.rating ?? null, updates.feedbackComment || null,
    updates.feedbackSubmittedAt, updates.smsSent ? 1 : 0, updates.photoUrl || null, id
  );
  const row = db.prepare('SELECT * FROM attendance_records WHERE id = ?').get(id);
  return row ? rowToAttendanceRecord(row) : null;
}
