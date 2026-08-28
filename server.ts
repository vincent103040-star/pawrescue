import './env';
import express from 'express';
import path from 'path';
import { createHmac, timingSafeEqual, randomUUID } from 'crypto';
import { writeFileSync, mkdirSync, createWriteStream, statSync, readFileSync, unlinkSync } from 'fs';
import { gzipSync } from 'zlib';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import { getSession, createSession, destroySession, verifyAdminCredentials, changeAdminPassword, getAllShifts, insertShift, updateShift, deleteShift, getShift, getAllShiftSignups, insertShiftSignup, updateShiftSignupStatus, cancelShiftSignup, getAllVolunteers, getVolunteerByEmail, getVolunteerByLineUserId, updateVolunteerDetails, deleteVolunteer, upsertVolunteerFromLogin, updateVolunteerProfileExtras, addCompletedShiftHours, setLineUserId, getLineUserId, getLineUserIdByName, setLinePreferences, getLinePreferences, getAllAttendanceRecords, insertAttendanceRecord, updateAttendanceCheckout, getOpenAttendanceFor, getAppSecret, getSopContent, saveSopContent, getAllRagChunks, replaceRagChunks, deleteRagChunks, getAllSopDocuments, insertSopDocument, deleteSopDocument, backfillSopDocumentSizes, getSopDocumentText, getAllSopVideos, insertSopVideo, deleteSopVideo, getAllPromotionRequests, upsertPendingPromotionRequest, getLatestPromotionRequestForVolunteer, reviewPromotionRequest, updateVolunteerTier, getAllShiftTemplates, upsertShiftTemplate, deleteShiftTemplate, getShelterLocation, updateShelterLocation, getLineOfficialAccount, updateLineOfficialAccount, backupDatabase, getAllZones, getActiveZones, getZone, createZone, updateZone, setZoneStatus, countZoneUsage, getAllDutyItems, getActiveDutyItems, getDutyItem, createDutyItem, updateDutyItem, setDutyItemStatus, countDutyCompletions, getDutyCompletionsForDate, completeDuty, uncompleteDuty, getZoneWorkload, setFeedbackAcknowledged, getRollCall, getAbsenceCounts, setVolunteerAccountStatus, sweepSuspensions, countSuspensions, recordAppeal, getStatusHistory, hasAppealedSinceSuspension, ABSENCE_SUSPENSION_THRESHOLD, SUSPENSION_DAYS, APPEAL_WINDOW_DAYS, createSubstitutionRequest, getSubstitutionRequest, getOpenSubstitutionForSignup, getOpenSubstitutions, takeSubstitutionRequest, withdrawSubstitutionRequest, expireStaleSubstitutions, hoursUntilShift, SUBSTITUTION_NOTICE_HOURS, getReminderCandidates, markReminderSent, normalizeReminderLead, planShiftsForRange, generateDraftShifts, publishDraftShifts, discardDraftShifts, SHIFT_MERGE_GAP_MINUTES } from './db';
import { PDFParse } from 'pdf-parse';
import type { SopContent, SopDocument, SopVideo } from './src/types';

// Environment loading lives in ./env, which ./db imports before it does
// anything -- see the comment there. Calling dotenv here instead was the bug:
// it ran after ./db had already been evaluated.

interface RulebookEmbeddingEntry {
  id: string;
  title: string;
  text: string;
  embedding: number[];
}

// The RAG corpus now lives in the DB (rag_chunks table) instead of a static
// precomputed file -- an admin editing SOP content or uploading a reference PDF
// changes this. Kept as an in-memory cache (refreshed after any mutation) rather
// than querying the DB on every single question, since it's read far more often
// than it changes.
/**
 * Which Gemini models to call.
 *
 * These were written into eight separate call sites. Models get retired, and
 * when this one does, the shelter's only route was to edit source, rebuild and
 * redeploy -- and to miss one of the eight would leave a single feature quietly
 * broken. A model name is not a secret, so it belongs in configuration.
 */
const AI_TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || 'gemini-3.6-flash';
const AI_EMBED_MODEL = process.env.GEMINI_EMBED_MODEL || 'gemini-embedding-001';

/**
 * What happened the last time the server tried to turn text into a vector.
 *
 * In memory, not stored: it answers "is the AI working right now", and a
 * restart is exactly when that question should be asked afresh.
 *
 * It exists because embedding failure is silent by design -- saving SOP content
 * succeeds either way, since the volunteers' copy must update even when the AI
 * is unavailable. Silent is right for the save and wrong for the shelter, which
 * otherwise has no way to discover that the AI has been answering from stale
 * material since the quota ran out.
 */
let lastEmbedding: { at: string; ok: boolean; error?: string } | null = null;

let rulebookEmbeddings: RulebookEmbeddingEntry[] = [];
function refreshRulebookEmbeddings() {
  rulebookEmbeddings = getAllRagChunks().map(c => ({ id: c.sourceId, title: c.title, text: c.text, embedding: c.embedding }));
}
refreshRulebookEmbeddings();

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function startServer() {
  const app = express();
  // 3000 by default because the Google OAuth client and the LINE Login callback
  // URL are both registered against localhost:3000. PORT overrides it, which is
  // what makes it possible to run a second copy for testing without disturbing
  // the one already serving.
  const PORT = Number(process.env.PORT) || 3000;

  // Raised from the 100kb default to fit a compressed check-out photo as base64 JSON.
  // `verify` stashes the raw bytes on the request so the LINE webhook handler can
  // recompute the x-line-signature HMAC over the exact same bytes LINE signed --
  // the parsed/re-serialized JSON is not guaranteed to match byte-for-byte.
  // 30mb accommodates a base64-encoded PDF or a short teaching video clip in
  // addition to the smaller check-in-photo uploads this limit already covered.
  // Kept well short of, say, 100mb+ deliberately -- the deploy VM only has 1GB
  // RAM, and buffering a much larger request body in memory risks the same OOM
  // crash a bare npm install once caused there.
  app.use(express.json({
    limit: '30mb',
    verify: (req, _res, buf) => { (req as any).rawBody = buf; }
  }));

  // ==========================================================================
  // Authentication middleware
  // --------------------------------------------------------------------------
  // Previously the signed-in role existed only as a value in the browser's
  // localStorage, and no endpoint checked it -- so every /api/admin/* route
  // answered anyone who knew the URL, whatever their claimed role. The server
  // now decides, from a token it issued itself and stores in SQLite.
  // ==========================================================================
  function readToken(req: express.Request): string {
    const header = String(req.headers['authorization'] || '');
    return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  }

  /** Attaches req.session when a valid token is present. Never rejects. */
  function attachSession(req: any, _res: express.Response, next: express.NextFunction) {
    req.session = getSession(readToken(req));
    next();
  }

  function requireAuth(req: any, res: express.Response, next: express.NextFunction) {
    if (!req.session) {
      return res.status(401).json({ success: false, error: '尚未登入或登入已逾期，請重新登入。' });
    }
    next();
  }

  function requireAdmin(req: any, res: express.Response, next: express.NextFunction) {
    if (!req.session) {
      return res.status(401).json({ success: false, error: '尚未登入或登入已逾期，請重新登入。' });
    }
    if (req.session.role !== 'admin') {
      return res.status(403).json({ success: false, error: '此操作僅限管理者。' });
    }
    next();
  }

  const isAdmin = (req: any): boolean => req.session?.role === 'admin';

  /**
   * The signed-in volunteer's own email, lowercased; '' for an admin.
   *
   * Handlers that used to take an email from the query string or the request
   * body use this instead, so "whose data is this" is answered by the token the
   * server issued rather than by whatever the caller typed.
   */
  const sessionEmail = (req: any): string =>
    req.session?.role === 'volunteer' ? String(req.session.identity || '').toLowerCase().trim() : '';

  const sameEmail = (a: unknown, b: unknown): boolean => {
    const norm = (v: unknown) => String(v || '').toLowerCase().trim();
    return !!norm(a) && norm(a) === norm(b);
  };

  app.use(attachSession);

  // ==========================================================================
  // Default deny
  // --------------------------------------------------------------------------
  // requireAuth used to be applied route by route, which meant a new endpoint
  // was public until somebody remembered to protect it -- and about a dozen
  // never were: the full volunteer roster with everyone's phone number, every
  // attendance record, "approve my own promotion", and sending LINE messages
  // from the shelter's official account were all one URL away for anyone.
  //
  // The rule is inverted here. Everything under /api needs a session unless it
  // is on this list, so the failure mode of forgetting is a locked door rather
  // than an open one. Paths are relative to /api -- Express strips the mount
  // point before this middleware sees them.
  // ==========================================================================
  const PUBLIC_ENDPOINTS: ReadonlyArray<readonly [string, RegExp]> = [
    ['GET', /^\/health$/],
    // The SSE stream: EventSource cannot send an Authorization header, and the
    // frames carry no data of their own -- just "something of kind X changed",
    // which the client then has to be authorised to actually fetch.
    ['GET', /^\/events$/],
    // Shown on the signed-out landing page: where the shelter is, and which
    // LINE account to add. Both are already public information.
    ['GET', /^\/shelter-location$/],
    ['GET', /^\/line-official-account$/],
    // Sign-in itself. These are what issue a session, so they cannot require one.
    ['POST', /^\/auth\/admin-login$/],
    ['POST', /^\/auth\/google-userinfo$/],
    ['POST', /^\/auth\/google-phone-login$/],
    ['POST', /^\/auth\/line-login-url$/],
    ['POST', /^\/auth\/line-session$/],
    ['GET', /^\/auth\/line-callback$/],
    // Answers "is my stored token still valid?" -- it has to be able to say no.
    ['GET', /^\/auth\/me$/],
    ['POST', /^\/auth\/logout$/],
    // Called by LINE's servers, not by a browser. Authenticated by the
    // x-line-signature HMAC in the handler instead of by a session.
    ['POST', /^\/line\/webhook$/]
  ];

  app.use('/api', (req, res, next) => {
    const isPublic = PUBLIC_ENDPOINTS.some(
      ([method, pattern]) => method === req.method && pattern.test(req.path)
    );
    if (isPublic) return next();
    return requireAuth(req, res, next);
  });

  // Every current and future /api/admin/* route is covered by this one line,
  // rather than relying on each handler remembering to check.
  app.use('/api/admin', requireAdmin);

  // ==========================================================================
  // Rate limiting
  // --------------------------------------------------------------------------
  // A fixed window, held in memory, no new dependency -- npm install has OOM-ed
  // on the 1GB deploy VM before, and this doesn't need to survive a restart.
  // Keyed by signed-in identity where there is one, so a single account can't
  // spend the whole shelter's Gemini quota, and by IP otherwise.
  // ==========================================================================
  function rateLimit(options: { windowMs: number; max: number; message: string }) {
    const hits = new Map<string, { count: number; resetAt: number }>();

    return (req: any, res: express.Response, next: express.NextFunction) => {
      const now = Date.now();

      // Opportunistic pruning: without it this map grows for as long as the
      // process lives. Cheap because it only runs when the map is large.
      if (hits.size > 5000) {
        for (const [key, entry] of hits) {
          if (entry.resetAt <= now) hits.delete(key);
        }
      }

      const key = req.session?.identity || req.ip || 'unknown';
      const entry = hits.get(key);

      if (!entry || entry.resetAt <= now) {
        hits.set(key, { count: 1, resetAt: now + options.windowMs });
        return next();
      }

      entry.count += 1;
      if (entry.count > options.max) {
        const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
        res.setHeader('Retry-After', String(retryAfter));
        return res.status(429).json({
          success: false,
          error: `${options.message}（請於 ${retryAfter} 秒後再試）`
        });
      }
      return next();
    };
  }

  // Each AI call is a paid round-trip to Gemini and several seconds of work.
  // 20 a minute is far more than any real user produces and far less than a
  // script needs to be expensive.
  app.use('/api/ai', rateLimit({
    windowMs: 60_000,
    max: 20,
    message: 'AI 功能使用過於頻繁'
  }));

  // Guessing an admin password shouldn't be something you can do thousands of
  // times a minute. Keyed by IP, since there is no session yet.
  app.use('/api/auth/admin-login', rateLimit({
    windowMs: 15 * 60_000,
    max: 10,
    message: '登入嘗試次數過多'
  }));

  // Admin sign-in. The password is verified here against a scrypt hash -- it
  // used to be compared in the browser, which meant the check could simply be
  // skipped by calling the API directly.
  app.post('/api/auth/admin-login', (req, res) => {
    try {
      const { username, password } = req.body || {};
      const admin = verifyAdminCredentials(username, password);
      if (!admin) {
        return res.status(401).json({ success: false, error: '帳號或密碼錯誤，請重新輸入。' });
      }
      const token = createSession('admin', admin.username, admin.username);
      return res.json({
        success: true,
        token,
        admin: { name: admin.username, roleTitle: admin.roleTitle, email: admin.email }
      });
    } catch (error: any) {
      console.error('Admin Login Error:', error);
      return res.status(500).json({ success: false, error: error.message || '登入失敗' });
    }
  });

  // Lets an admin rotate the demo password without editing code.
  app.post('/api/admin/change-password', (req: any, res) => {
    try {
      const { currentPassword, newPassword } = req.body || {};
      if (!newPassword || String(newPassword).length < 4) {
        return res.status(400).json({ success: false, error: '新密碼至少需要 4 個字元。' });
      }
      if (!verifyAdminCredentials(req.session.identity, currentPassword)) {
        return res.status(401).json({ success: false, error: '目前密碼錯誤。' });
      }
      changeAdminPassword(req.session.identity, String(newPassword));
      return res.json({ success: true, note: '密碼已更新，所有裝置都需要重新登入。' });
    } catch (error: any) {
      console.error('Change Password Error:', error);
      return res.status(500).json({ success: false, error: error.message || '變更密碼失敗' });
    }
  });

  // The client calls this on load to find out whether its stored token is still
  // good -- so a revoked or expired session can't keep showing a signed-in UI.
  app.get('/api/auth/me', (req: any, res) => {
    if (!req.session) {
      return res.status(401).json({ success: false, error: '未登入' });
    }
    const { role, identity, displayName } = req.session;
    if (role === 'volunteer') {
      const volunteer = getVolunteerByEmail(identity);
      if (!volunteer) {
        // Account deleted while the token was still alive.
        destroySession(readToken(req));
        return res.status(401).json({ success: false, error: '帳號已不存在' });
      }
      return res.json({ success: true, role, volunteer });
    }
    return res.json({ success: true, role, admin: { name: identity, displayName } });
  });

  app.post('/api/auth/logout', (req, res) => {
    destroySession(readToken(req));
    return res.json({ success: true });
  });


  // ==========================================================================
  // Live updates (Server-Sent Events)
  // --------------------------------------------------------------------------
  // Every screen used to fetch once on mount and then only re-fetch after a
  // mutation made on that same device -- so a volunteer checking in on their
  // phone never appeared on the coordinator's dashboard until they reloaded
  // the page. For a live operations board that made the numbers quietly wrong.
  //
  // SSE rather than WebSockets: this is strictly server -> client, it's native
  // to both Express and the browser, and it needs no new dependency (npm
  // install has OOM-ed on this 1GB VM before). The client also polls as a
  // fallback, so a proxy that buffers the stream degrades to slightly-delayed
  // updates instead of no updates.
  // ==========================================================================
  type ChangeKind = 'attendance' | 'shifts' | 'signups' | 'volunteers' | 'promotions' | 'zones' | 'duties';
  const sseClients = new Set<express.Response>();

  function broadcastChange(kind: ChangeKind) {
    const payload = `data: ${JSON.stringify({ kind, at: Date.now() })}\n\n`;
    for (const client of sseClients) {
      try {
        client.write(payload);
      } catch {
        sseClients.delete(client);
      }
    }
  }

  app.get('/api/events', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      // Tells nginx-style proxies not to buffer; harmless elsewhere.
      'X-Accel-Buffering': 'no'
    });
    res.write('retry: 5000\n\n');
    res.write(`data: ${JSON.stringify({ kind: 'connected', at: Date.now() })}\n\n`);

    sseClients.add(res);

    // Proxies and load balancers close idle connections; a periodic comment
    // keeps the stream alive without the client having to reconnect.
    const keepAlive = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        clearInterval(keepAlive);
        sseClients.delete(res);
      }
    }, 25000);

    req.on('close', () => {
      clearInterval(keepAlive);
      sseClients.delete(res);
    });
  });

  const photosDir = path.join(process.cwd(), 'data', 'photos');
  mkdirSync(photosDir, { recursive: true });
  app.use('/photos', express.static(photosDir));

  const avatarsDir = path.join(process.cwd(), 'data', 'avatars');
  mkdirSync(avatarsDir, { recursive: true });
  app.use('/avatars', express.static(avatarsDir));

  const sopDocsDir = path.join(process.cwd(), 'data', 'sop-docs');
  mkdirSync(sopDocsDir, { recursive: true });
  // Filenames embed their upload timestamp and are never rewritten, so a copy a
  // phone already has can never be stale -- cache it hard. Downloading the
  // scanned manual is expensive enough that doing it twice should never happen.
  // express.static also answers Range requests, so a viewer that asks for part
  // of the file gets only that part.
  app.use('/sop-docs', express.static(sopDocsDir, {
    maxAge: '365d',
    immutable: true,
    setHeaders: res => res.setHeader('Accept-Ranges', 'bytes')
  }));
  backfillSopDocumentSizes(sopDocsDir);

  const sopVideosDir = path.join(process.cwd(), 'data', 'sop-videos');
  mkdirSync(sopVideosDir, { recursive: true });
  app.use('/sop-videos', express.static(sopVideosDir));

  // API endpoint: AI Recruitment Post Generator using Gemini API
  // Gemini writes in Markdown by habit ("**實習志工**", "* 條列"), but nothing
  // here renders Markdown: the app prints these strings as plain text and LINE
  // messages don't support formatting at all. Left alone, volunteers literally
  // see the asterisks. Telling the model not to use Markdown isn't reliable, so
  // every AI-authored string is cleaned here instead -- one place, deterministic.
  function stripMarkdown(text: string): string {
    if (!text) return '';
    return text
      // Bullet markers at the start of a line become a real bullet character
      // rather than vanishing, so lists stay readable.
      .replace(/^[ \t]*[*+-][ \t]+/gm, '• ')
      // Headings: drop the leading #s but keep the words.
      .replace(/^[ \t]*#{1,6}[ \t]*/gm, '')
      // Bold/italic wrappers, longest first so ** isn't left half-stripped.
      .replace(/\*\*\*(.+?)\*\*\*/g, '$1')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/___(.+?)___/g, '$1')
      .replace(/__(.+?)__/g, '$1')
      // Inline code / code fences.
      .replace(/```[a-zA-Z]*\n?/g, '')
      .replace(/`([^`]+)`/g, '$1')
      // Any asterisk that survived the pairs above (e.g. an unmatched one).
      .replace(/\*/g, '')
      .trim();
  }

  /** Applies stripMarkdown to every string in an object, recursively. */
  function stripMarkdownDeep<T>(value: T): T {
    if (typeof value === 'string') return stripMarkdown(value) as unknown as T;
    if (Array.isArray(value)) return value.map(stripMarkdownDeep) as unknown as T;
    if (value && typeof value === 'object') {
      const out: any = {};
      for (const [k, v] of Object.entries(value as any)) out[k] = stripMarkdownDeep(v);
      return out;
    }
    return value;
  }

  app.post('/api/ai/generate-post', async (req, res) => {
    const { title, zoneName, branchName, date, timeRange, requiredCount, tasks } = req.body;

    const generateFallbackPost = () => {
      return `🐾【志工急召！${branchName || '浪浪家園'} - ${title || '園區服務'}】🐶🐱\n\n` +
        `毛孩們需要你的神隊友救援！我們正在尋找溫暖有愛心的你～\n\n` +
        `📍 服務區域：${zoneName || '園區場域'}\n` +
        `📅 服務日期：${date || '近期班次'} (${timeRange || '彈性時段'})\n` +
        `👥 尚缺名額：${requiredCount || 2} 位熱血志工\n\n` +
        `📋 任務內容：\n${(tasks && tasks.length) ? tasks.map((t: string) => `• ${t}`).join('\n') : '• 陪伴毛孩放風、環境清潔與安撫'}\n\n` +
        `❤️ 一起用陪伴改變浪浪的一生！一鍵點擊連結登記預約，LINE 自動同步班表提醒喔！`;
    };

    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.json({ success: true, postContent: generateFallbackPost(), isFallback: true });
      }

      const ai = new GoogleGenAI({ 
        apiKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
      });
      const prompt = `你是一位專業且熱情的流浪動物之家社工與志工招募主管。請幫忙撰寫一篇吸引人、語氣溫暖活潑、帶有可愛表情符號 (Emoji) 的志工招募貼文與 LINE 社群群組通知。

詳細班次資訊：
- 班次名稱：${title}
- 服務園區：${branchName}
- 服務分區：${zoneName}
- 日期時段：${date} (${timeRange})
- 需求人數：${requiredCount} 人
- 主要任務：${Array.isArray(tasks) ? tasks.join('、') : tasks}

貼文要求：
1. 包含亮眼的標題，吸引貓狗愛好者報名。
2. 清晰列出時間、地點、任務內容與志工福利（如：毛孩療癒陪伴、志工時數認證）。
3. 強調一鍵點擊 Google 日曆與 Google 地圖導航的便利性。
4. 結尾請用充滿愛心號召力的語氣，長度約 250-350 字。`;

      const response = await ai.models.generateContent({
        model: AI_TEXT_MODEL,
        contents: prompt
      });

      const generatedText = stripMarkdown(response.text || '');
      return res.json({ success: true, postContent: generatedText });
    } catch (error: any) {
      console.warn('Gemini API Error (fallback activated):', error?.message || error);
      // Graceful fallback during demand spikes / 503 errors
      return res.json({
        success: true,
        postContent: generateFallbackPost(),
        isFallback: true
      });
    }
  });

  // API endpoint: AI Urgent Shortage LINE Push Notification Generator
  app.post('/api/ai/generate-urgent-push', async (req, res) => {
    const { title, zoneName, branchName, date, timeRange, requiredCount, currentCount, shortageCount, shortageRate } = req.body;

    const generateFallbackPush = () => {
      return `🚨【緊急缺工動員令｜急需英雄志工】🐾\n\n` +
        `各位浪浪後援會志工好！【${branchName || '浪浪家園'}】的【${title || '園區班次'}】目前人力缺額已高達 ${shortageRate || '60'}%（僅 ${currentCount || 1}/${requiredCount || 4} 人到位）！\n\n` +
        `毛孩們急需補齊救援神隊友！誠摯邀請能出勤的志工前來支援安撫與照顧！\n\n` +
        `📍 服務區域：${zoneName || '園區場域'}\n` +
        `📅 服務時間：${date || '近期班次'} ${timeRange || ''}\n` +
        `🆘 尚缺名額：🚨 急缺 ${shortageCount || 3} 人！\n\n` +
        `👉 點擊下方【一鍵前往報名支援】立即完成 LINE 班表登記！`;
    };

    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.json({ success: true, pushContent: generateFallbackPush(), isFallback: true });
      }

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
      });

      const prompt = `你是一位流浪動物之家的緊急排班指揮官。某個班次目前缺額嚴重（超過 50% 缺工！）。
請為該班次撰寫一篇非常緊急、感人且具號召力的 LINE 官方帳號 / 社群群組緊急動員廣播推播文案。

班次資訊：
- 班次名稱：${title}
- 園區據點：${branchName}
- 場域分區：${zoneName}
- 日期時段：${date} ${timeRange}
- 報名狀態：目前僅 ${currentCount} 人到位 / 總需求 ${requiredCount} 人 (缺額 ${shortageCount} 人，缺工率 ${shortageRate}%)

要求：
1. 第一行必須是醒目的紅色警戒或驚嘆 Emoji 標題（例如：🚨【緊急缺工動員令】或 📢【毛孩急召神隊友】）。
2. 強調目前缺額已超過 50%，毛孩當天急需大家伸手幫忙。
3. 語氣溫暖懇切、具有急迫感但充滿正面愛心。
4. 條理分明列出時段、地點、尚缺人數。
5. 長度約 150-250 字，適合在手機 LINE 螢幕上快速閱讀。`;

      const response = await ai.models.generateContent({
        model: AI_TEXT_MODEL,
        contents: prompt
      });

      const generatedText = stripMarkdown(response.text || '');
      return res.json({ success: true, pushContent: generatedText });
    } catch (error: any) {
      console.warn('Gemini Urgent Push API Error (fallback activated):', error?.message || error);
      // Graceful fallback during demand spikes / 503 / 429 errors
      return res.json({
        success: true,
        pushContent: generateFallbackPush(),
        isFallback: true
      });
    }
  });

  // API endpoint: AI Resource & Shortage Warning Prediction using Gemini API.
  // Used to compare 3 hardcoded branches -- now a single shelter, so the
  // request/response shape is one stats object in, one prediction object out.
  app.post('/api/ai/predict-resource-gaps', async (req, res) => {
    try {
      const { shelterData } = req.body;

      const apiKey = process.env.GEMINI_API_KEY;

      const fallbackPrediction = {
        riskLevel: 'warning',
        severityScore: 58,
        animalCount: 434,
        shortageRate: 42,
        predictedManpowerGap: '預測下週缺 22 人次（大狗運動場放風 10 人、幼貓育幼陪伴 5 人、醫療區復健 7 人），週末最為告急',
        predictedMaterialGap: '大犬成犬飼料急缺 60 kg、主食貓罐頭短缺 80 罐、止血與傷口紗布短缺 30 包',
        urgentActions: [
          '即刻向 LINE 志工群組發布假日班次急召推播',
          '請物資整理組優先分類最新一批捐贈物資，補上飼料與紗布缺口'
        ]
      };

      if (!apiKey) {
        return res.json({
          success: true,
          isFallback: true,
          globalSummary: '根據目前園區共 434 隻浪浪與下週志工班次缺工率分析，人力與物資皆面臨中度短缺風險，建議優先開啟急召推播與物資整理排程。',
          prediction: fallbackPrediction
        });
      }

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
      });

      const prompt = `你是一位專業的流浪動物之家營運總監與 AI 物資人力預警專家。
請根據以下園區的當前動物數量、班次缺工率與場域狀況，以 JSON 格式預測下一週（7天）的「人力缺口」與「物資缺口」，並給出緊急處置建議。

園區實時數據：
${JSON.stringify(shelterData, null, 2)}

請務必以【純 JSON 格式】回覆（不要包含 markdown \`\`\`json 或額外開頭結尾文字），格式如下：
{
  "globalSummary": "簡短 80 字內的全園區營運風險總評與建議重點",
  "prediction": {
    "riskLevel": "critical 或 warning 或 normal",
    "severityScore": 0到100的數值,
    "animalCount": 動物數量,
    "shortageRate": 缺工率百分比數值,
    "predictedManpowerGap": "預測人力缺口說明",
    "predictedMaterialGap": "預測物資缺口說明（含具體數量如幾公斤飼料、幾罐罐頭）",
    "urgentActions": ["具體建議1", "具體建議2"]
  }
}`;

      const response = await ai.models.generateContent({
        model: AI_TEXT_MODEL,
        contents: prompt
      });

      const generatedText = (response.text || '').trim();
      let parsed = null;
      try {
        const cleanJson = generatedText.replace(/```json/g, '').replace(/```/g, '').trim();
        parsed = JSON.parse(cleanJson);
      } catch (err) {
        console.warn('Failed to parse Gemini JSON output, using clean fallback');
      }

      if (parsed && parsed.prediction) {
        return res.json({
          success: true,
          isFallback: false,
          globalSummary: stripMarkdown(parsed.globalSummary),
          prediction: stripMarkdownDeep(parsed.prediction)
        });
      }

      return res.json({
        success: true,
        isFallback: true,
        globalSummary: 'Gemini AI 完成分析：園區下週面臨人力與物資吃緊預警，需立即發布 LINE 急召與物資整理排程。',
        prediction: fallbackPrediction
      });

    } catch (error: any) {
      console.warn('Predict Resource Gaps Error (fallback activated):', error?.message || error);
      return res.json({
        success: true,
        isFallback: true,
        globalSummary: '園區下週面臨人力與物資吃緊預警，建議儘速啟動 LINE 志工動員令與物資整理排程。',
        prediction: {
          riskLevel: 'warning',
          severityScore: 58,
          animalCount: 434,
          shortageRate: 42,
          predictedManpowerGap: '預測下週缺 22 人次（大狗運動場放風 10 人、幼貓育幼陪伴 5 人、醫療區復健 7 人）',
          predictedMaterialGap: '大犬成犬飼料急缺 60 kg、主食貓罐頭短缺 80 罐、止血紗布短缺 30 包',
          urgentActions: ['發布假日動員 LINE 廣播', '整理最新一批捐贈物資補上缺口']
        }
      });
    }
  });

  // Shared fallback content for the situational readiness quiz (used when no API key or on error)
  const ZONE_DISPLAY_NAMES: Record<string, string> = {
    cat: '貓舍區',
    dog: '大狗運動場',
    puppy: '幼犬育幼區',
    medical: '醫療與隔離區',
    logistics: '物資與行政導覽區'
  };

  const FALLBACK_SITUATIONAL_QUESTIONS: Record<string, string> = {
    cat: '如果貓咪突然對你哈氣並躲進籠子深處，你會怎麼處理？',
    dog: '如果大型犬在運動場放風時突然對其他狗吠叫、拉扯牽繩，你會怎麼處理？',
    puppy: '如果幼犬出現輕微腹瀉或食慾不振，你會怎麼處理？',
    medical: '如果協助照護的動物術後傷口滲出異常分泌物，你會怎麼處理？',
    logistics: '如果一批捐贈物資缺少清楚標示、你不確定該分類到哪裡，你會怎麼處理？'
  };

  const EXPERIENCE_LABELS: Record<string, string> = {
    beginner: '新手（無相關經驗）',
    intermediate: '略有經驗',
    experienced: '資深熟練'
  };

  // API endpoint: AI Dynamic Situational Question Generator (volunteer readiness quiz)
  app.post('/api/ai/generate-situational-question', async (req, res) => {
    const { zone, experienceLevel } = req.body;
    const zoneName = ZONE_DISPLAY_NAMES[zone] || '園區服務';
    const experienceLabel = EXPERIENCE_LABELS[experienceLevel] || '新手（無相關經驗）';

    const fallbackQuestion = FALLBACK_SITUATIONAL_QUESTIONS[zone] || FALLBACK_SITUATIONAL_QUESTIONS.cat;

    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.json({ success: true, question: fallbackQuestion, isFallback: true });
      }

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
      });

      const prompt = `你是資深動物收容所志工培訓督導。請為即將申請「${zoneName}」班次、自評經驗程度為「${experienceLabel}」的志工申請人，出一題貼近真實現場的情境判斷題，測試他對動物行為觀察與安全處理的認知。

只回傳題目文字本身（1 句話，繁體中文，50 字以內），不要加任何標題、編號或額外說明。`;

      const response = await ai.models.generateContent({
        model: AI_TEXT_MODEL,
        contents: prompt
      });

      const question = stripMarkdown(response.text || '').replace(/^["「]|["」]$/g, '');
      if (!question) {
        return res.json({ success: true, question: fallbackQuestion, isFallback: true });
      }
      return res.json({ success: true, question, isFallback: false });
    } catch (error: any) {
      console.warn('Gemini Situational Question Error (fallback activated):', error?.message || error);
      return res.json({ success: true, question: fallbackQuestion, isFallback: true });
    }
  });

  // API endpoint: AI Situational Answer Readiness Assessment (volunteer readiness quiz)
  app.post('/api/ai/assess-situational-answer', async (req, res) => {
    const { zone, question, answer, experienceLevel } = req.body;
    const experienceLabel = EXPERIENCE_LABELS[experienceLevel] || '新手（無相關經驗）';

    const fallbackAssessment = {
      score: 3,
      feedback: '感謝你認真分享你的想法！社工夥伴會在審核時進一步了解你的照護經驗，若有不熟悉的地方，錄取後也會有完整的培訓與資深志工陪同帶領，不用太緊張。',
      flags: [] as string[]
    };

    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey || !answer || !String(answer).trim()) {
        return res.json({ success: true, ...fallbackAssessment, isFallback: true });
      }

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
      });

      const prompt = `你是一位溫和但專業的動物收容所志工培訓督導，負責初步評估志工申請人對現場情境的準備度，而不是決定是否錄取（錄取與否由人類社工決定）。

情境題：${question}
申請人回答：${answer}
申請人自評經驗程度：${experienceLabel}

請以【純 JSON 格式】回覆（不要包含 markdown \`\`\`json 或額外開頭結尾文字），格式如下：
{
  "score": 1到5的整數（準備度評分，5為最佳）,
  "feedback": "給申請人看的回饋，鼓勵性語氣，100字內；若回答顯示可能有安全疑慮，也要溫和具體地指出並給建議",
  "flags": ["給審核社工看的客觀觀察重點，最多3點，簡短片語即可，例如：對貓咪緊迫訊號辨識度待加強"]
}`;

      const response = await ai.models.generateContent({
        model: AI_TEXT_MODEL,
        contents: prompt
      });

      const generatedText = (response.text || '').trim();
      let parsed: any = null;
      try {
        const cleanJson = generatedText.replace(/```json/g, '').replace(/```/g, '').trim();
        parsed = JSON.parse(cleanJson);
      } catch (err) {
        console.warn('Failed to parse Gemini situational assessment JSON, using fallback');
      }

      if (parsed && typeof parsed.score === 'number' && parsed.feedback) {
        return res.json({
          success: true,
          isFallback: false,
          score: parsed.score,
          feedback: stripMarkdown(parsed.feedback),
          flags: Array.isArray(parsed.flags) ? parsed.flags.map(stripMarkdown) : []
        });
      }

      return res.json({ success: true, ...fallbackAssessment, isFallback: true });
    } catch (error: any) {
      console.warn('Gemini Situational Assessment Error (fallback activated):', error?.message || error);
      return res.json({ success: true, ...fallbackAssessment, isFallback: true });
    }
  });

  // API endpoint: Simple RAG Q&A over the volunteer rulebook/SOP corpus.
  // Retrieval = embed the question, cosine-similarity against the precomputed
  // rulebook_embeddings.json, take the top matches. Generation = ask Gemini to
  // answer using only those matched excerpts, so it can't invent rules that
  // aren't actually in the handbook.
  // Shared by the HTTP endpoint below and the LINE webhook auto-reply handler
  // further down, so both surfaces answer from the exact same rulebook logic.
  async function answerRulebookQuestion(question: string): Promise<{ answer: string; isFallback: boolean; sources: string[] }> {
    const keywordFallback = () => {
      const q = String(question || '');
      let best: RulebookEmbeddingEntry | null = null;
      let bestScore = 0;
      for (const chunk of rulebookEmbeddings) {
        const hay = chunk.title + chunk.text;
        let score = 0;
        for (const ch of q) {
          if (ch.trim() && hay.includes(ch)) score++;
        }
        if (score > bestScore) {
          bestScore = score;
          best = chunk;
        }
      }
      return {
        answer: best
          ? `AI 暫時無法使用，為你找到手冊裡最相關的原文段落：\n\n【${best.title}】\n${best.text}`
          : '找不到相關規則，建議直接聯繫值班社工確認。',
        sources: best ? [best.title] : []
      };
    };

    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey || rulebookEmbeddings.length === 0) {
        return { isFallback: true, ...keywordFallback() };
      }

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
      });

      const embedRes = await ai.models.embedContent({
        model: AI_EMBED_MODEL,
        contents: question
      });
      const questionVector = embedRes.embeddings?.[0]?.values;
      if (!questionVector) throw new Error('No embedding returned for question');

      const ranked = rulebookEmbeddings
        .map(chunk => ({ chunk, score: cosineSimilarity(questionVector, chunk.embedding) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);

      const contextText = ranked
        .map(r => `【${r.chunk.title}】\n${r.chunk.text}`)
        .join('\n\n');

      const prompt = `你是浪浪家園流浪動物之家的志工手冊問答助理。請「只根據」以下手冊摘錄回答志工的問題，語氣親切簡短。如果摘錄中真的找不到答案，請誠實說明手冊沒有明確規定，並建議聯繫值班社工，不要編造規則。

手冊摘錄：
${contextText}

志工問題：${question}`;

      const response = await ai.models.generateContent({
        model: AI_TEXT_MODEL,
        contents: prompt
      });

      const answer = stripMarkdown(response.text || '');
      if (!answer) throw new Error('Empty answer from Gemini');

      return {
        isFallback: false,
        answer,
        sources: ranked.map(r => r.chunk.title)
      };
    } catch (error: any) {
      console.warn('RAG Ask Error (fallback activated):', error?.message || error);
      return { isFallback: true, ...keywordFallback() };
    }
  }

  app.post('/api/ai/rag-ask', async (req, res) => {
    const { question } = req.body;
    if (!question || !String(question).trim()) {
      return res.status(400).json({ success: false, error: '請輸入問題' });
    }
    const result = await answerRulebookQuestion(question);
    return res.json({ success: true, ...result });
  });

  // Embeds one piece of text for the RAG corpus. Returns null (rather than
  // throwing) when there's no API key or the call fails, so callers can decide
  // whether that's fatal for their specific operation.
  async function embedText(text: string): Promise<number[] | null> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      lastEmbedding = { at: new Date().toISOString(), ok: false, error: '尚未設定 GEMINI_API_KEY' };
      return null;
    }
    try {
      const ai = new GoogleGenAI({ apiKey, httpOptions: { headers: { 'User-Agent': 'aistudio-build' } } });
      const res = await ai.models.embedContent({ model: AI_EMBED_MODEL, contents: text });
      const values = res.embeddings?.[0]?.values || null;
      lastEmbedding = values
        ? { at: new Date().toISOString(), ok: true }
        : { at: new Date().toISOString(), ok: false, error: '模型回應沒有向量內容' };
      return values;
    } catch (error: any) {
      const message = String(error?.message || error);
      lastEmbedding = { at: new Date().toISOString(), ok: false, error: message.slice(0, 200) };
      console.warn('Embed Text Error:', message);
      return null;
    }
  }

  /**
   * Whether the AI is actually working, and on what.
   *
   * Read-only, and it never returns the key -- only whether one is set. A key
   * that is attached to somebody's billing account does not belong in a page,
   * an HTTP response, or a browser's memory; the way to change it is to edit
   * .env.local on the machine and restart.
   */
  app.get('/api/admin/ai-status', (req, res) => {
    try {
      const sections = getSopContent().sections;
      const chunks = getAllRagChunks();
      const bySource: Record<string, number> = {};
      for (const chunk of chunks) bySource[chunk.source] = (bySource[chunk.source] || 0) + 1;

      // The question the shelter actually has: can the assistant answer from
      // what the social workers wrote? Comparing the two counts is what turns
      // "it saved" into "it is being used".
      const sectionIds = new Set(sections.map(section => section.id));
      const embeddedSections = chunks.filter(
        chunk => chunk.source === 'section' && sectionIds.has(chunk.sourceId)
      ).length;

      return res.json({
        success: true,
        keyConfigured: !!process.env.GEMINI_API_KEY,
        textModel: AI_TEXT_MODEL,
        embedModel: AI_EMBED_MODEL,
        lastEmbedding,
        chunks: { total: chunks.length, bySource },
        sections: { total: sections.length, embedded: embeddedSections }
      });
    } catch (error: any) {
      console.error('AI Status Error:', error);
      return res.status(500).json({ success: false, error: error.message || '讀取 AI 狀態失敗' });
    }
  });

  // API endpoint: the volunteer rulebook/SOP content -- read by both the
  // volunteer-facing SOP guide page and the admin content editor, so they're
  // always showing the exact same data.
  app.get('/api/sop-content', (req, res) => {
    try {
      return res.json({
        success: true,
        content: getSopContent(),
        documents: getAllSopDocuments(),
        videos: getAllSopVideos()
      });
    } catch (error: any) {
      console.error('Get SOP Content Error:', error);
      return res.status(500).json({ success: false, error: error.message || '讀取手冊內容失敗' });
    }
  });

  // API endpoint (admin only -- the /api/admin default-deny middleware enforces
  // it on the server; the tab it is wired into is merely where it is reached from):
  // save the SOP guide content, and re-embed every section + the emergency block
  // for RAG. Sections that changed get fresh vectors; the "static" background
  // chunks (admin/volunteer process descriptions, seeded from the original
  // rulebookCorpus.ts) are untouched since they aren't part of this content.
  app.put('/api/admin/sop-content', async (req, res) => {
    try {
      const content: SopContent = req.body;
      if (!content || !Array.isArray(content.sections)) {
        return res.status(400).json({ success: false, error: '手冊內容格式不正確' });
      }

      saveSopContent(content);

      // Drop rag_chunks for any section that got removed in this save.
      const keptSectionIds = new Set(content.sections.map(s => s.id));
      for (const existing of getAllRagChunks().filter(c => c.source === 'section')) {
        if (!keptSectionIds.has(existing.sourceId)) deleteRagChunks('section', existing.sourceId);
      }

      // Counted rather than ignored. The content itself saves regardless --
      // volunteers must see the shelter's words even when the AI is down -- but
      // "saved" and "the AI can answer from it" are two different facts, and
      // reporting only the first is how the assistant ends up quoting material
      // that was replaced weeks ago with nobody aware.
      let embedded = 0;
      let embedFailed = 0;
      for (const section of content.sections) {
        const text = `${section.title}\n${section.items.map(i => `${i.label}：${i.text}`).join('\n')}`;
        const embedding = await embedText(text);
        if (embedding) {
          replaceRagChunks('section', section.id, [{ title: section.title, text, embedding }]);
          embedded++;
        } else {
          embedFailed++;
        }
      }

      const emergencyText = `${content.emergencyTitle}\n${content.emergencyText}\n值班社工專線：${content.emergencyPhone}`;
      const emergencyEmbedding = await embedText(emergencyText);
      if (emergencyEmbedding) {
        replaceRagChunks('emergency', 'emergency-protocol', [{ title: content.emergencyTitle, text: emergencyText, embedding: emergencyEmbedding }]);
      }

      refreshRulebookEmbeddings();
      return res.json({
        success: true,
        content: getSopContent(),
        embedded,
        embedFailed,
        embedError: embedFailed > 0 ? (lastEmbedding?.error || '') : ''
      });
    } catch (error: any) {
      console.error('Save SOP Content Error:', error);
      return res.status(500).json({ success: false, error: error.message || '儲存手冊內容失敗' });
    }
  });

  // File uploads (SOP PDFs, teaching videos) stream the raw request body
  // straight to disk instead of arriving as base64 inside a JSON body.
  //
  // The base64-in-JSON approach they used before was memory-fatal here: a
  // 88MB PDF becomes ~123MB of base64, and express.json would hold the raw
  // body buffer, the decoded JSON string, AND the extracted base64 string
  // simultaneously (~370MB) before a single byte reached disk -- on a 1GB VM,
  // on top of the ~450MB pdf.js then needs to parse it. Streaming keeps the
  // transfer at ~0 extra memory and skips the 33% base64 overhead entirely.
  //
  // Metadata (title/description) rides in headers rather than the body, since
  // the body is now the file itself. Header values are URL-encoded by the
  // client because HTTP headers must be latin-1 and these are Chinese.
  const MAX_UPLOAD_BYTES = 150 * 1024 * 1024;   // 150MB stored
  const MAX_PDF_PARSE_BYTES = 100 * 1024 * 1024; // only parse text below this (see note at the call site)

  function decodeHeaderValue(raw: string | string[] | undefined): string {
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (!value) return '';
    try {
      return decodeURIComponent(value).trim();
    } catch {
      return String(value).trim();
    }
  }

  function safeUnlink(filePath: string) {
    try { unlinkSync(filePath); } catch { /* already gone */ }
  }

  // Streams the request body to disk, aborting if it exceeds maxBytes.
  // Resolves with the number of bytes written.
  function streamRequestToFile(req: express.Request, filePath: string, maxBytes: number): Promise<number> {
    return new Promise((resolve, reject) => {
      let bytes = 0;
      let aborted = false;
      const out = createWriteStream(filePath);

      req.on('data', (chunk: Buffer) => {
        if (aborted) return;
        bytes += chunk.length;
        if (bytes > maxBytes) {
          aborted = true;
          const err: any = new Error('Upload exceeds size limit');
          err.code = 'UPLOAD_TOO_LARGE';
          out.destroy();
          req.destroy();
          reject(err);
        }
      });

      req.on('error', err => { if (!aborted) { out.destroy(); reject(err); } });
      out.on('error', err => { if (!aborted) reject(err); });
      out.on('finish', () => { if (!aborted) resolve(bytes); });

      req.pipe(out);
    });
  }

  // API endpoint (admin only): upload a reference PDF. Extracts its text,
  // splits into ~1200-character chunks, and embeds each chunk into the RAG
  // corpus so "問手冊 AI 小幫手" can answer from it -- not just display it as a
  // download link.
  app.post('/api/admin/sop-documents', async (req, res) => {
    let savedPath: string | null = null;
    try {
      const title = decodeHeaderValue(req.headers['x-upload-title']);
      if (!title) {
        return res.status(400).json({ success: false, error: '缺少文件標題' });
      }

      const id = `doc-${Date.now()}`;
      const filename = `${id}.pdf`;
      savedPath = path.join(sopDocsDir, filename);

      const bytesWritten = await streamRequestToFile(req, savedPath, MAX_UPLOAD_BYTES);
      if (bytesWritten === 0) {
        safeUnlink(savedPath);
        return res.status(400).json({ success: false, error: '缺少檔案內容' });
      }

      // Text extraction loads the whole PDF into memory and pdf.js needs several
      // times the file size on top (an 88MB image-heavy PDF peaked around 450MB
      // RSS in testing). The deploy VM only has 1GB, and a V8 out-of-memory kill
      // is NOT catchable -- it would take the whole server down -- so skip
      // extraction above a threshold rather than risk it. The file itself is
      // still saved and downloadable either way.
      let extractedText = '';
      let extractionSkipped = false;
      if (bytesWritten > MAX_PDF_PARSE_BYTES) {
        extractionSkipped = true;
        console.warn(`PDF too large for safe text extraction (${(bytesWritten / 1024 / 1024).toFixed(1)}MB), storing without RAG indexing.`);
      } else {
        try {
          const parser = new PDFParse({ data: readFileSync(savedPath) });
          const textResult = await parser.getText();
          extractedText = textResult.text || '';
          await parser.destroy();
        } catch (error: any) {
          console.warn('PDF Text Extraction Error:', error?.message || error);
        }
      }

      const doc: SopDocument = { id, title, fileUrl: `/sop-docs/${filename}`, uploadedAt: new Date().toISOString(), fileSize: bytesWritten };
      insertSopDocument(doc);

      // Chunk + embed the extracted text (best-effort -- a PDF that fails to
      // extract or embed still gets saved as a downloadable file above).
      const CHUNK_SIZE = 1200;
      const chunks: { title: string; text: string; embedding: number[] }[] = [];
      const cleanedText = extractedText.replace(/\s+/g, ' ').trim();
      for (let i = 0; i < cleanedText.length; i += CHUNK_SIZE) {
        const slice = cleanedText.slice(i, i + CHUNK_SIZE);
        if (!slice.trim()) continue;
        const embedding = await embedText(slice);
        if (embedding) {
          chunks.push({ title: `${title}（第 ${chunks.length + 1} 段）`, text: slice, embedding });
        }
      }
      if (chunks.length > 0) {
        replaceRagChunks('pdf', id, chunks);
        refreshRulebookEmbeddings();
      }

      return res.json({
        success: true,
        document: doc,
        chunksIndexed: chunks.length,
        note: extractionSkipped
          ? `檔案過大（${(bytesWritten / 1024 / 1024).toFixed(0)}MB），已儲存供下載，但未擷取文字建立 AI 問答索引`
          : (chunks.length === 0 ? '此 PDF 未擷取到可索引的文字（可能是掃描圖檔）' : undefined)
      });
    } catch (error: any) {
      if (savedPath) safeUnlink(savedPath);
      if (error?.code === 'UPLOAD_TOO_LARGE') {
        return res.status(413).json({
          success: false,
          error: `檔案超過 ${MAX_UPLOAD_BYTES / 1024 / 1024}MB 上限，請壓縮後再上傳`
        });
      }
      console.error('Upload SOP Document Error:', error);
      return res.status(500).json({ success: false, error: error.message || '上傳文件失敗' });
    }
  });

  // The readable text of an uploaded manual, rebuilt from the chunks already
  // indexed for RAG at upload time.
  //
  // The shelter's manual is a stack of scanned pages: 88MB on disk, of which
  // 85MB is scanned images and only ~31KB is text. Sending the text instead of
  // the file is what makes the manual usable on a phone -- there is no
  // compression to be had on the PDF itself (its images are already compressed;
  // gzip over the whole file saves 0.6%). The original stays downloadable for
  // anyone who wants the scans.
  app.get('/api/sop-documents/:id/text', (req, res) => {
    try {
      const text = getSopDocumentText(req.params.id);
      if (text === null) {
        return res.status(404).json({
          success: false,
          error: '這份文件沒有可線上閱讀的文字（可能是純掃描圖檔，或上傳時檔案過大未建立索引）'
        });
      }

      const payload = JSON.stringify({ success: true, text });
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=300');

      // Text compresses ~2x and there's no compression middleware in front of
      // us, so do it here when the client accepts it.
      if (String(req.headers['accept-encoding'] || '').includes('gzip')) {
        res.setHeader('Content-Encoding', 'gzip');
        return res.end(gzipSync(Buffer.from(payload, 'utf-8')));
      }
      return res.end(payload);
    } catch (error: any) {
      console.error('Get SOP Document Text Error:', error);
      return res.status(500).json({ success: false, error: error.message || '讀取文件文字失敗' });
    }
  });

  app.delete('/api/admin/sop-documents/:id', (req, res) => {
    try {
      deleteSopDocument(req.params.id);
      deleteRagChunks('pdf', req.params.id);
      refreshRulebookEmbeddings();
      return res.json({ success: true });
    } catch (error: any) {
      console.error('Delete SOP Document Error:', error);
      return res.status(500).json({ success: false, error: error.message || '刪除文件失敗' });
    }
  });

  // API endpoint (admin only): upload a teaching video. Stored + served as a
  // static file, same pattern as check-in photos/avatars; only its title +
  // description (not the video content itself) get embedded for RAG searchability.
  app.post('/api/admin/sop-videos', async (req, res) => {
    let savedPath: string | null = null;
    try {
      const title = decodeHeaderValue(req.headers['x-upload-title']);
      const description = decodeHeaderValue(req.headers['x-upload-description']);
      const mimeType = String(req.headers['content-type'] || '');
      if (!title) {
        return res.status(400).json({ success: false, error: '缺少影片標題' });
      }

      const id = `video-${Date.now()}`;
      const ext = mimeType.includes('webm') ? 'webm' : mimeType.includes('quicktime') ? 'mov' : 'mp4';
      const filename = `${id}.${ext}`;
      savedPath = path.join(sopVideosDir, filename);

      const bytesWritten = await streamRequestToFile(req, savedPath, MAX_UPLOAD_BYTES);
      if (bytesWritten === 0) {
        safeUnlink(savedPath);
        return res.status(400).json({ success: false, error: '缺少檔案內容' });
      }

      const video: SopVideo = { id, title, description, fileUrl: `/sop-videos/${filename}`, uploadedAt: new Date().toISOString() };
      insertSopVideo(video);

      const embedding = await embedText(`${title}\n${description || ''}`);
      if (embedding) {
        replaceRagChunks('video', id, [{ title, text: `教學影片：${title}${description ? `\n${description}` : ''}`, embedding }]);
        refreshRulebookEmbeddings();
      }

      return res.json({ success: true, video });
    } catch (error: any) {
      if (savedPath) safeUnlink(savedPath);
      if (error?.code === 'UPLOAD_TOO_LARGE') {
        return res.status(413).json({
          success: false,
          error: `檔案超過 ${MAX_UPLOAD_BYTES / 1024 / 1024}MB 上限，請壓縮後再上傳`
        });
      }
      console.error('Upload SOP Video Error:', error);
      return res.status(500).json({ success: false, error: error.message || '上傳影片失敗' });
    }
  });

  app.delete('/api/admin/sop-videos/:id', (req, res) => {
    try {
      deleteSopVideo(req.params.id);
      deleteRagChunks('video', req.params.id);
      refreshRulebookEmbeddings();
      return res.json({ success: true });
    } catch (error: any) {
      console.error('Delete SOP Video Error:', error);
      return res.status(500).json({ success: false, error: error.message || '刪除影片失敗' });
    }
  });

  // API endpoint: AI caption for a volunteer's check-out photo. Multimodal --
  // the image itself is sent to Gemini, not just described in text, so the
  // suggested caption actually reflects what's in the photo.
  app.post('/api/ai/caption-photo', async (req, res) => {
    const { imageBase64, mimeType, shiftTitle, zone } = req.body;

    const fallbackCaption = `今天在${shiftTitle || '園區'}服務，陪伴毛孩度過充實的一天，謝謝這份溫暖的付出！`;

    if (!imageBase64 || !mimeType) {
      return res.status(400).json({ success: false, error: '缺少照片資料' });
    }

    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.json({ success: true, caption: fallbackCaption, isFallback: true });
      }

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
      });

      const prompt = `你是流浪動物之家的志工社群小編。這張照片是志工今天在「${shiftTitle || '園區'}」（場域：${zone || '未指定'}）服務時拍的。請根據照片實際內容，寫一段 60-100 字的溫暖第一人稱心得文字，適合放進志工的服務紀錄與領養牆故事。語氣真誠、具體描述照片中看到的畫面，不要空泛通用，也不要編造照片裡沒有的細節。只回傳心得文字本身，不要加任何標題或引號。`;

      const response = await ai.models.generateContent({
        model: AI_TEXT_MODEL,
        contents: [
          { text: prompt },
          { inlineData: { mimeType, data: imageBase64 } }
        ]
      });

      const caption = stripMarkdown(response.text || '');
      if (!caption) throw new Error('Empty caption from Gemini');

      return res.json({ success: true, caption, isFallback: false });
    } catch (error: any) {
      console.warn('Photo Caption Error (fallback activated):', error?.message || error);
      return res.json({ success: true, caption: fallbackCaption, isFallback: true });
    }
  });

  /**
   * Asks Google who an access token belongs to.
   *
   * Returns null unless Google confirms it, which is the entire point: the
   * answer has to come from Google rather than from whatever the caller wrote
   * in the request body. The audience check matters too -- without it, a token
   * minted for some other application would verify here just as happily.
   */
  async function verifyGoogleAccessToken(
    accessToken: string
  ): Promise<{ email: string; name: string } | null> {
    try {
      const expectedClientId = process.env.VITE_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '';
      if (expectedClientId) {
        const infoRes = await fetch(
          `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`
        );
        if (!infoRes.ok) return null;
        const info: any = await infoRes.json();
        if (info?.aud !== expectedClientId) {
          console.warn('Google token rejected: issued for a different client_id');
          return null;
        }
      }

      const userinfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (!userinfoRes.ok) return null;

      const profile: any = await userinfoRes.json();
      const email = String(profile?.email || '').toLowerCase().trim();
      if (!email || profile?.email_verified === false) return null;
      return { email, name: String(profile?.name || '') };
    } catch (error: any) {
      console.warn('Google token verification failed:', error?.message || error);
      return null;
    }
  }

  // API endpoint: Google login / self profile-edit upsert into the persistent SQLite volunteer DB
  app.post('/api/auth/google-phone-login', async (req: any, res) => {
    try {
      const { accessToken, googleProfile, phoneNumber, lineId, linePreferences } = req.body;

      // Who this is has to come from somewhere the caller cannot simply type.
      //
      // It used to come from googleProfile.email in the request body, sitting
      // next to a literal `idToken: 'google-oauth-verified'` string that the
      // server never looked at. The Google check was real, but it happened in
      // the browser and the browser then reported its own verdict -- so posting
      // any address here returned a working session for that volunteer, and
      // this endpoint has to stay reachable signed-out because it *is* the
      // sign-in.
      //
      // Two callers are legitimate. Someone signing in proves it with a Google
      // access token, verified above against Google. A volunteer who is already
      // signed in and editing their own contact details proves it with the
      // session they already hold.
      let email = '';
      let name = '';

      if (req.session?.role === 'volunteer') {
        const me = getVolunteerByEmail(req.session.identity);
        if (!me) {
          return res.status(404).json({ success: false, error: '找不到您的志工資料，請重新登入' });
        }
        email = me.email;
        name = String(googleProfile?.name || me.name);
      } else {
        if (!accessToken) {
          return res.status(400).json({ success: false, error: '缺少 Google 授權憑證，請重新以 Google 登入' });
        }
        const verified = await verifyGoogleAccessToken(String(accessToken));
        if (!verified) {
          return res.status(401).json({ success: false, error: 'Google 授權驗證失敗，請重新登入' });
        }
        email = verified.email;
        name = verified.name || '熱血志工';
      }

      if (!email) {
        return res.status(400).json({ success: false, error: '缺少 Google 帳號 email' });
      }

      // Standardize Phone Number
      let normalizedPhone = phoneNumber ? phoneNumber.trim() : '';
      if (normalizedPhone.startsWith('09')) {
        normalizedPhone = `+886${normalizedPhone.substring(1).replace(/-/g, '')}`;
      } else if (!normalizedPhone.startsWith('+')) {
        normalizedPhone = `+886${normalizedPhone.replace(/[-\s]/g, '')}`;
      }
      if (!normalizedPhone || normalizedPhone.length < 9) {
        return res.status(400).json({ success: false, error: '請輸入有效的聯絡電話' });
      }

      const resolvedLineId = lineId || `${email.split('@')[0]}_line`;
      const userRecord = upsertVolunteerFromLogin({ email, name, phone: normalizedPhone, lineId: resolvedLineId });

      if (linePreferences) {
        setLinePreferences(email, {
          shiftChanges: !!linePreferences.shiftChanges,
          urgentRecruitment: !!linePreferences.urgentRecruitment,
          checkInReminder: !!linePreferences.checkInReminder,
          sopReminder: linePreferences.sopReminder !== false,
          // Stored rather than dropped: the sweep reads this to decide when to
          // send, and it used to live only in the volunteer's browser.
          reminderTimingHours: normalizeReminderLead(linePreferences.reminderTimingHours)
        });
      }

      return res.json({
        success: true,
        message: '志工資料已同步寫入資料庫',
        // Issued here so the volunteer's later requests carry a token the
        // server can verify, instead of the browser just asserting a role.
        token: createSession('volunteer', userRecord.email, userRecord.name),
        user: {
          uid: `google-uid-${email.replace(/[@.]/g, '_')}`,
          email: userRecord.email,
          name: userRecord.name,
          phone: userRecord.phone.startsWith('+886')
            ? userRecord.phone.replace('+886', '0').replace(/(\d{4})(\d{3})(\d{3})/, '$1-$2-$3')
            : userRecord.phone,
          rawPhone: userRecord.phone,
          lineId: userRecord.lineId,
          tier: userRecord.tier,
          totalHours: userRecord.totalHours,
          isPhoneVerified: true
        }
      });
    } catch (error: any) {
      console.error('Google Phone Login Backend Error:', error);
      return res.status(500).json({ success: false, error: error.message || '驗證憑證失敗' });
    }
  });

  // API endpoint: Volunteer roster — single source of truth for the admin roster page
  // ==========================================================================
  // Shifts & signups -- the server is now the source of truth for both,
  // so a shift published on one device is immediately visible on every other.
  // ==========================================================================
  /**
   * Marks a volunteer's service feedback as taken up by the social work team.
   *
   * Admin-only, and it records who: the actor comes from the session rather
   * than the request body, so the record says which coordinator handled it and
   * cannot be attributed to someone else.
   */
  app.post('/api/admin/attendance/:id/feedback-acknowledged', (req: any, res) => {
    try {
      const acknowledged = req.body?.acknowledged !== false;
      const updated = setFeedbackAcknowledged(
        req.params.id,
        acknowledged,
        String(req.session?.displayName || req.session?.identity || 'Admin')
      );
      if (!updated) {
        return res.status(404).json({ success: false, error: '找不到該筆出勤紀錄' });
      }
      broadcastChange('attendance');
      return res.json({ success: true, record: updated });
    } catch (error: any) {
      console.error('Acknowledge Feedback Error:', error);
      return res.status(500).json({ success: false, error: error.message || '更新參採狀態失敗' });
    }
  });

  // ==========================================================================
  // Monthly report
  // --------------------------------------------------------------------------
  // Built here rather than in the browser, for three reasons: it can be
  // scheduled, so nobody has to remember to press a button; the main system can
  // fetch it directly if it ever wants to; and it reads the database rather than
  // whatever slice the open page happens to have loaded.
  //
  // Every column is a count or a total. No name, address, phone number or email
  // appears anywhere in the output, and that is the point -- what the main
  // system needs is numbers, not a roster.
  // ==========================================================================

  /** RFC 4180 quoting: wrap in quotes, and double any quote inside. */
  function csvCell(value: unknown): string {
    const text = value === null || value === undefined ? '' : String(value);
    return `"${text.replace(/"/g, '""')}"`;
  }

  const csvRow = (cells: unknown[]) => cells.map(csvCell).join(',');

  /** Hours a shift is scheduled for, from its "10:00 - 13:00" range. */
  function shiftDurationHours(timeRange: string): number {
    const match = String(timeRange || '').match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
    if (!match) return 0;
    const [, startHour, startMinute, endHour, endMinute] = match.map(Number);
    const start = startHour * 60 + startMinute;
    let end = endHour * 60 + endMinute;
    if (end <= start) end += 24 * 60;
    return (end - start) / 60;
  }

  const WEEKDAY_LABELS = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];

  interface ReportTotals {
    shifts: number;
    required: number;
    accepted: number;
    pending: number;
    attended: number;
    scheduledHours: number;
    actualHours: number;
  }

  const emptyTotals = (): ReportTotals =>
    ({ shifts: 0, required: 0, accepted: 0, pending: 0, attended: 0, scheduledHours: 0, actualHours: 0 });

  const shortageOf = (t: ReportTotals) => Math.max(0, t.required - t.accepted);
  const shortageRateOf = (t: ReportTotals) =>
    t.required > 0 ? Math.round((shortageOf(t) / t.required) * 100) : 0;

  function statusLabelFor(rate: number): string {
    if (rate > 30) return '嚴重缺工';
    if (rate > 10) return '人力微緊';
    return '排班優良';
  }

  /**
   * Assembles the month's report as CSV.
   *
   * Three sections, because one summary row could not answer the question that
   * matters. "42% short" tells the shelter nothing it can act on; "the cattery
   * is 60% short and logistics is fully staffed" does.
   *
   * Hours appear twice on purpose. 預計時數 is what the shifts were scheduled
   * for -- accepted volunteers times shift length -- and 實際時數 is what the
   * attendance records actually add up to. The report used to show only the
   * first while calling it "完成服務時數", which reads as a fact and is an
   * assumption; on the current data the two differ by about a third. The gap
   * between them is itself the useful number: it is how much of the booked
   * help did not arrive.
   */
  function buildMonthlyReportCsv(month: string): string {
    const shelter = getShelterLocation();
    const zones = getAllZones();
    const monthShifts = getAllShifts().filter(shift => String(shift.date).startsWith(month));
    const shiftById = new Map(monthShifts.map(shift => [shift.id, shift]));

    // A signup holds a seat while it is pending or approved; only an approved
    // one is a place the shelter is counting on.
    const monthSignups = getAllShiftSignups().filter(signup => shiftById.has(signup.shiftId));
    const acceptedSignups = monthSignups.filter(signup => signup.status === 'approved');
    const pendingSignups = monthSignups.filter(signup => signup.status === 'pending');
    const completedAttendance = getAllAttendanceRecords().filter(
      record => String(record.date).startsWith(month) && record.status === 'completed'
    );

    const overall = emptyTotals();
    const byZone = new Map<string, ReportTotals>();
    const byDate = new Map<string, ReportTotals>();

    const bucket = (map: Map<string, ReportTotals>, key: string) => {
      if (!map.has(key)) map.set(key, emptyTotals());
      return map.get(key)!;
    };

    for (const shift of monthShifts) {
      const zoneTotals = bucket(byZone, shift.zone);
      const dateTotals = bucket(byDate, shift.date);
      for (const totals of [overall, zoneTotals, dateTotals]) {
        totals.shifts += 1;
        totals.required += shift.requiredCount || 0;
      }
    }

    for (const signup of acceptedSignups) {
      const shift = shiftById.get(signup.shiftId)!;
      const hours = shiftDurationHours(shift.timeRange);
      for (const totals of [overall, bucket(byZone, shift.zone), bucket(byDate, shift.date)]) {
        totals.accepted += 1;
        totals.scheduledHours += hours;
      }
    }

    // Counted separately rather than folded into 錄取: a signup still waiting on
    // a decision is a queue the shelter can act on, not staffing it can rely on.
    // Shortage is measured against approved places only.
    for (const signup of pendingSignups) {
      const shift = shiftById.get(signup.shiftId)!;
      for (const totals of [overall, bucket(byZone, shift.zone), bucket(byDate, shift.date)]) {
        totals.pending += 1;
      }
    }

    for (const record of completedAttendance) {
      for (const totals of [overall, bucket(byZone, record.zone), bucket(byDate, record.date)]) {
        totals.attended += 1;
        totals.actualHours += record.hoursLogged || 0;
      }
    }

    const round = (n: number) => Math.round(n * 10) / 10;
    const rows: string[] = [];

    rows.push(csvRow([`${shelter.name} 志工人力月報`, month]));
    rows.push(csvRow(['產出時間', new Date().toISOString()]));
    rows.push(csvRow(['資料範圍', '本報表僅含統計數字，不含姓名、電話、Email 等個人資料']));
    rows.push('');

    rows.push(csvRow(['【整體摘要】']));
    rows.push(csvRow([
      '總班次數', '需求人次', '錄取人次', '待審人次', '實際到勤人次', '缺工人次', '缺工率(%)',
      '預計時數', '實際時數', '運作狀態'
    ]));
    rows.push(csvRow([
      overall.shifts, overall.required, overall.accepted, overall.pending, overall.attended,
      shortageOf(overall), shortageRateOf(overall),
      round(overall.scheduledHours), round(overall.actualHours),
      statusLabelFor(shortageRateOf(overall))
    ]));
    rows.push('');

    rows.push(csvRow(['【各場域】']));
    rows.push(csvRow([
      '場域代碼', '場域名稱', '場域狀態', '班次數', '需求人次', '錄取人次', '待審人次',
      '實際到勤人次', '缺工人次', '缺工率(%)', '預計時數', '實際時數'
    ]));
    // Every zone that either has a row this month or is currently active, so a
    // quiet area still shows as a zero rather than vanishing from the report.
    const zoneIds = new Set<string>([
      ...byZone.keys(),
      ...zones.filter(zone => zone.status === 'active').map(zone => zone.id)
    ]);
    const zoneById = new Map(zones.map(zone => [zone.id, zone]));
    for (const zoneId of [...zoneIds].sort()) {
      const totals = byZone.get(zoneId) || emptyTotals();
      const zone = zoneById.get(zoneId);
      rows.push(csvRow([
        zone?.code || zoneId,
        // A zone deleted before disabling existed would land here; name it
        // rather than leaving a bare id nobody recognises.
        zone?.name || `（已移除的場域：${zoneId}）`,
        zone ? (zone.status === 'active' ? '啟用' : '已停用') : '不存在',
        totals.shifts, totals.required, totals.accepted, totals.pending, totals.attended,
        shortageOf(totals), shortageRateOf(totals),
        round(totals.scheduledHours), round(totals.actualHours)
      ]));
    }
    rows.push('');

    rows.push(csvRow(['【每日】']));
    rows.push(csvRow([
      '日期', '星期', '班次數', '需求人次', '錄取人次', '待審人次', '實際到勤人次', '缺工人次', '缺工率(%)', '實際時數'
    ]));
    for (const date of [...byDate.keys()].sort()) {
      const totals = byDate.get(date)!;
      const weekday = WEEKDAY_LABELS[new Date(`${date}T00:00:00+08:00`).getDay()] || '';
      rows.push(csvRow([
        date, weekday, totals.shifts, totals.required, totals.accepted, totals.pending,
        totals.attended, shortageOf(totals), shortageRateOf(totals), round(totals.actualHours)
      ]));
    }

    // The BOM is what makes Excel open a UTF-8 CSV without mangling Chinese.
    return '﻿' + rows.join('\r\n') + '\r\n';
  }

  /**
   * The day's roll call: who was expected on each shift, and who checked in.
   *
   * The rulebook says two unexplained absences cost a volunteer their booking
   * rights for thirty days, but nothing had ever set the 'absent' status, so
   * that count was permanently zero and the rule applied to nobody. This is
   * where the count starts existing.
   *
   * It reports; it does not decide. A missing check-in is evidence somebody did
   * not check in, which is not the same as evidence they did not come -- phones
   * lose signal inside kennel buildings and people forget. The coordinator
   * confirms. Marking an unpaid volunteer absent by inference, when the rule
   * ends in losing their place, is not a judgement to automate.
   */
  // ==========================================================================
  // Volunteer account state
  // --------------------------------------------------------------------------
  // See the comment on accountStatus in db.ts for what the three states mean
  // and why none of them deletes anything.
  // ==========================================================================

  /**
   * Tells a volunteer something about their own commitments or account.
   *
   * Sent regardless of their notification preferences. Those cover shift
   * changes, urgent callouts and check-in reminders -- things somebody might
   * reasonably not want. Being told you can no longer book shifts, or that
   * somebody has taken over the shift you are still expecting to work, is not
   * in that category: each one changes what is being asked of them, and a
   * person cannot act on what nobody told them.
   */
  async function notifyVolunteerDirect(email: string, text: string): Promise<boolean> {
    try {
      const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
      const linked = getLineUserId(email);
      if (!token || !linked) return false; // not bound to LINE yet -- nothing to send to
      const res = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ to: linked.lineUserId, messages: [{ type: 'text', text }] })
      });
      // LINE answers 200 on delivery and 4xx on a bad token or unreachable
      // recipient. Callers that need to know -- the reminder sweep, which must
      // not record a send that did not happen -- read this.
      if (!res.ok) {
        console.warn('LINE push rejected:', email, res.status);
        return false;
      }
      return true;
    } catch (error: any) {
      // Best effort: a push that fails must not stop the state change, but it
      // should be visible, because a suspension nobody was told about is the
      // failure mode this whole notification exists to prevent.
      console.warn('Account status notification failed:', email, error?.message || error);
      return false;
    }
  }

  app.post('/api/admin/volunteers/:email/account-status', async (req: any, res) => {
    try {
      const email = decodeURIComponent(req.params.email);
      const status = String(req.body?.status || '');
      if (!['active', 'suspended', 'inactive'].includes(status)) {
        return res.status(400).json({ success: false, error: '未知的帳號狀態' });
      }

      const actor = String(req.session?.displayName || req.session?.identity || 'Admin');
      const reason = String(req.body?.reason || '').trim();
      const updated = setVolunteerAccountStatus(
        email,
        status as 'active' | 'suspended' | 'inactive',
        actor,
        reason || (status === 'active' ? '由督導恢復' : '由督導手動設定')
      );
      if (!updated) return res.status(404).json({ success: false, error: '找不到這位志工' });

      if (status === 'active') {
        await notifyVolunteerDirect(
          email,
          `【浪浪家園】${updated.name} 您好，您的志工帳號已恢復正常，現在可以重新報名班次了。感謝您繼續陪伴浪浪 🐾`
        );
      } else if (status === 'suspended') {
        await notifyVolunteerDirect(
          email,
          `【浪浪家園】${updated.name} 您好，您的搶班權限已暫停。${reason ? `原因：${reason}。` : ''}` +
          `您仍可登入查看自己的服務紀錄與時數。如需恢復，請與社工督導聯繫。`
        );
      }

      broadcastChange('volunteers');
      return res.json({ success: true, volunteer: updated });
    } catch (error: any) {
      console.error('Account Status Error:', error);
      return res.status(500).json({ success: false, error: error.message || '更新帳號狀態失敗' });
    }
  });

  /**
   * Notes that a suspended volunteer got in touch.
   *
   * Separate from reinstating them, because a coordinator who has heard the
   * reason may still decide the suspension should run its course. Without this,
   * a volunteer who did exactly what the notice asked would be filed away at
   * fourteen days for it.
   */
  app.post('/api/admin/volunteers/:email/appeal', (req: any, res) => {
    try {
      const email = decodeURIComponent(req.params.email);
      const actor = String(req.session?.displayName || req.session?.identity || 'Admin');
      const note = String(req.body?.note || '').trim().slice(0, 200);
      if (!recordAppeal(email, actor, note || '志工已與督導聯繫')) {
        return res.status(404).json({ success: false, error: '找不到該志工' });
      }
      broadcastChange('volunteers');
      return res.json({ success: true, appealed: true });
    } catch (error: any) {
      console.error('Record Appeal Error:', error);
      return res.status(500).json({ success: false, error: error.message || '記錄申訴失敗' });
    }
  });

  /** A volunteer's account history, so a decision can be reviewed rather than guessed at. */
  app.get('/api/admin/volunteers/:email/status-history', (req, res) => {
    try {
      const email = decodeURIComponent(req.params.email);
      return res.json({
        success: true,
        history: getStatusHistory(email),
        suspensions: countSuspensions(email),
        appealedSinceSuspension: hasAppealedSinceSuspension(email),
        appealWindowDays: APPEAL_WINDOW_DAYS,
        suspensionDays: SUSPENSION_DAYS
      });
    } catch (error: any) {
      console.error('Status History Error:', error);
      return res.status(500).json({ success: false, error: error.message || '讀取帳號歷程失敗' });
    }
  });

  /**
   * Applies the rulebook's absence rule after a coordinator confirms a no-show.
   *
   * Automatic, unlike the absence itself. The count only moves when a person
   * has deliberately marked somebody absent on the roll call, so this applies a
   * published rule to facts a human established -- it does not infer them. And
   * it is one click to undo, which the notification tells the volunteer.
   */
  function applyAbsenceRule(volunteerEmail: string): { name: string; absences: number } | null {
    const email = String(volunteerEmail || '').toLowerCase().trim();
    if (!email) return null;

    const volunteer = getVolunteerByEmail(email);
    if (!volunteer || volunteer.accountStatus !== 'active') return null;

    const absences = getAbsenceCounts().get(email) || 0;
    if (absences < ABSENCE_SUSPENSION_THRESHOLD) return null;

    setVolunteerAccountStatus(
      email,
      'suspended',
      'system',
      `未到場達 ${absences} 次（規章門檻 ${ABSENCE_SUSPENSION_THRESHOLD} 次），${SUSPENSION_DAYS} 天後自動恢復`
    );
    console.log(`SQLite: ${volunteer.name} 因未到場 ${absences} 次已自動停權`);

    // The push is the slow part and the only part allowed to fail, so it is the
    // only part that does not block the coordinator's screen. It logs its own
    // failures rather than throwing.
    // The terms change on a repeat, so the message has to as well. Being held
    // to a deadline nobody told you about is not a rule, it is a trap.
    const times = countSuspensions(email);
    void notifyVolunteerDirect(
      email,
      times >= 2
        ? `【浪浪家園】${volunteer.name} 您好，系統記錄您已有 ${absences} 次未到場，`
          + `這是第 ${times} 次暫停搶班權限。`
          + `請於 ${APPEAL_WINDOW_DAYS} 天內與社工督導聯繫說明情況，`
          + `否則帳號將轉為離退狀態（服務時數與紀錄仍會保留，之後仍可恢復）。`
          + `聯繫過後，督導可以提早恢復，或讓停權走完 ${SUSPENSION_DAYS} 天 🐾`
        : `【浪浪家園】${volunteer.name} 您好，系統記錄您已有 ${absences} 次未到場，`
          + `依志工規章已暫停搶班權限 ${SUSPENSION_DAYS} 天，期滿會自動恢復，缺席次數也會重新計算。`
          + `您仍可登入查看自己的服務紀錄與時數。若有特殊情況或已安排代班，`
          + `與社工督導聯繫後可以提早恢復 🐾`
    );

    return { name: volunteer.name, absences };
  }

  app.get('/api/admin/roll-call', (req, res) => {
    try {
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || ''))
        ? String(req.query.date)
        : new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });

      const shifts = getRollCall(date);
      const absences = getAbsenceCounts();

      // The running total travels with each row, so the coordinator can see
      // that this would be someone's second miss before making it their second.
      const withHistory = shifts.map(shift => ({
        ...shift,
        expected: shift.expected.map(person => ({
          ...person,
          absencesSoFar: absences.get(person.volunteerEmail.toLowerCase()) || 0
        }))
      }));

      return res.json({
        success: true,
        date,
        // The screen states the rule to the coordinator, so it reads the
        // threshold from the same constant that enforces it.
        absenceThreshold: ABSENCE_SUSPENSION_THRESHOLD,
        shifts: withHistory,
        summary: {
          expected: shifts.reduce((n, s) => n + s.expected.length, 0),
          arrived: shifts.reduce((n, s) => n + s.expected.filter(p => p.checkedIn).length, 0),
          unresolved: shifts.reduce(
            (n, s) => n + s.expected.filter(p => !p.checkedIn && p.status === 'approved').length, 0
          )
        }
      });
    } catch (error: any) {
      console.error('Roll Call Error:', error);
      return res.status(500).json({ success: false, error: error.message || '讀取點名表失敗' });
    }
  });

  app.get('/api/admin/reports/monthly.csv', (req, res) => {
    try {
      const month = String(req.query.month || '');
      if (!/^\d{4}-\d{2}$/.test(month)) {
        return res.status(400).json({ success: false, error: '請指定統計月份，格式為 YYYY-MM' });
      }

      const csv = buildMonthlyReportCsv(month);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="pawrescue-monthly-${month}.csv"`);
      return res.send(csv);
    } catch (error: any) {
      console.error('Monthly Report Error:', error);
      return res.status(500).json({ success: false, error: error.message || '產生月報失敗' });
    }
  });

  // ==========================================================================
  // Duty items, today's duties, and completions
  // --------------------------------------------------------------------------
  // See the comment on duty_items in db.ts for why these are three concepts and
  // not one. In short: the standard is read, the duty item is defined, and the
  // completion is an event -- and the old board conflated the last two into a
  // hardcoded array that could not be saved.
  // ==========================================================================

  const DUTY_TRIGGERS = ['daily', 'zone_shift', 'specific_shift'];
  const DUTY_ROLES = ['staff', 'volunteer'];

  /** Taiwan-local YYYY-MM-DD, matching how shifts and attendance store dates. */
  const shelterToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });

  function validateDutyInput(body: any, { partial = false } = {}): string | null {
    const has = (field: string) => body?.[field] !== undefined;

    if (!partial || has('title')) {
      const title = body?.title;
      if (typeof title !== 'string' || !title.trim()) return '請輸入勤務名稱';
      if (title.trim().length > 60) return '勤務名稱請控制在 60 個字以內';
    }
    if (!partial || has('triggerType')) {
      if (!DUTY_TRIGGERS.includes(String(body?.triggerType))) return '請選擇有效的觸發方式';
    }
    if (!partial || has('responsibleRole')) {
      if (!DUTY_ROLES.includes(String(body?.responsibleRole))) return '請選擇負責角色';
    }
    if (!partial || has('requiredPeople')) {
      const people = Number(body?.requiredPeople);
      if (!Number.isInteger(people) || people < 1 || people > 50) return '需求人數請填 1 到 50 之間的整數';
    }
    if (!partial || has('estimatedMinutes')) {
      const minutes = Number(body?.estimatedMinutes);
      if (!Number.isInteger(minutes) || minutes < 5 || minutes > 720) return '預估時間請填 5 到 720 分鐘之間';
    }
    // A zone is optional -- a shelter-wide duty such as opening checks belongs
    // to nowhere in particular -- but naming one that does not exist would show
    // as 未知場域 for good.
    if (has('zoneId') && String(body.zoneId || '')) {
      if (!getZone(String(body.zoneId))) return '找不到這個場域，請重新選擇';
    }
    return null;
  }

  app.get('/api/duty-items', (req: any, res) => {
    try {
      return res.json({ success: true, dutyItems: isAdmin(req) ? getAllDutyItems() : getActiveDutyItems() });
    } catch (error: any) {
      console.error('Get Duty Items Error:', error);
      return res.status(500).json({ success: false, error: error.message || '讀取勤務項目失敗' });
    }
  });

  app.post('/api/admin/duty-items', (req, res) => {
    try {
      const problem = validateDutyInput(req.body);
      if (problem) return res.status(400).json({ success: false, error: problem });

      const item = createDutyItem({
        zoneId: String(req.body.zoneId || ''),
        title: String(req.body.title).trim(),
        description: String(req.body.description || '').trim(),
        category: String(req.body.category || '').trim(),
        triggerType: req.body.triggerType,
        shiftId: String(req.body.shiftId || ''),
        responsibleRole: req.body.responsibleRole,
        requiredPeople: Number(req.body.requiredPeople),
        estimatedMinutes: Number(req.body.estimatedMinutes),
        startTime: String(req.body.startTime || ''),
        endTime: String(req.body.endTime || ''),
        weekdays: req.body.weekdays,
        // Composed on read from startTime/endTime; passed only to satisfy the
        // shape, never stored.
        timeWindow: '',
        isRequired: req.body.isRequired !== false,
        sopSectionId: String(req.body.sopSectionId || ''),
        sopVideoId: String(req.body.sopVideoId || '')
      });
      broadcastChange('duties');
      return res.json({ success: true, dutyItem: item });
    } catch (error: any) {
      console.error('Create Duty Item Error:', error);
      return res.status(500).json({ success: false, error: error.message || '新增勤務項目失敗' });
    }
  });

  app.put('/api/admin/duty-items/:id', (req, res) => {
    try {
      const problem = validateDutyInput(req.body, { partial: true });
      if (problem) return res.status(400).json({ success: false, error: problem });

      const updates: any = {};
      for (const field of ['zoneId', 'title', 'description', 'category', 'triggerType',
                           'shiftId', 'responsibleRole', 'startTime', 'endTime',
                           'sopSectionId', 'sopVideoId']) {
        if (req.body[field] !== undefined) updates[field] = String(req.body[field]).trim();
      }
      // Sent as an array of day numbers by the form; normalised in db.ts, which
      // is also where an all-seven selection collapses back to "every day".
      if (req.body.weekdays !== undefined) updates.weekdays = req.body.weekdays;
      if (req.body.requiredPeople !== undefined) updates.requiredPeople = Number(req.body.requiredPeople);
      if (req.body.estimatedMinutes !== undefined) updates.estimatedMinutes = Number(req.body.estimatedMinutes);
      if (req.body.isRequired !== undefined) updates.isRequired = req.body.isRequired !== false;

      const updated = updateDutyItem(req.params.id, updates);
      if (!updated) return res.status(404).json({ success: false, error: '找不到該勤務項目' });

      broadcastChange('duties');
      return res.json({ success: true, dutyItem: updated });
    } catch (error: any) {
      console.error('Update Duty Item Error:', error);
      return res.status(500).json({ success: false, error: error.message || '更新勤務項目失敗' });
    }
  });

  app.post('/api/admin/duty-items/:id/disable', (req, res) => {
    try {
      const updated = setDutyItemStatus(req.params.id, 'disabled');
      if (!updated) return res.status(404).json({ success: false, error: '找不到該勤務項目' });
      broadcastChange('duties');
      return res.json({
        success: true,
        dutyItem: updated,
        completions: countDutyCompletions(req.params.id),
        note: '已停用。既有的完成紀錄不受影響；這個項目不會再出現在今日勤務清單。'
      });
    } catch (error: any) {
      console.error('Disable Duty Item Error:', error);
      return res.status(500).json({ success: false, error: error.message || '停用勤務項目失敗' });
    }
  });

  app.post('/api/admin/duty-items/:id/restore', (req, res) => {
    try {
      const updated = setDutyItemStatus(req.params.id, 'active');
      if (!updated) return res.status(404).json({ success: false, error: '找不到該勤務項目' });
      broadcastChange('duties');
      return res.json({ success: true, dutyItem: updated });
    } catch (error: any) {
      console.error('Restore Duty Item Error:', error);
      return res.status(500).json({ success: false, error: error.message || '恢復勤務項目失敗' });
    }
  });

  /**
   * Today's duties.
   *
   * Computed, never stored. Materialising this list would mean deciding what
   * happens to already-generated rows when a duty item is edited afterwards,
   * and there is no answer to that which is not surprising to somebody. Joining
   * the definitions to the day's completions costs nothing at this size and
   * cannot drift.
   */
  app.get('/api/duties/today', (req: any, res) => {
    try {
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || ''))
        ? String(req.query.date)
        : shelterToday();
      const shiftId = String(req.query.shiftId || '');

      const shiftsToday = getAllShifts().filter(shift => shift.date === date);
      const zonesWithShifts = new Set(shiftsToday.map(shift => shift.zone));
      const completions = getDutyCompletionsForDate(date);
      const completionKey = (itemId: string, sid: string) => `${itemId}::${sid}`;
      const byKey = new Map(completions.map(c => [completionKey(c.dutyItemId, c.shiftId), c]));

      // A coordinator is running the whole site, so they see the whole list. A
      // volunteer is here for their own shift: showing them every zone's
      // checklist would bury the three things that are actually theirs, and
      // invite them to tick off work in a zone they never entered.
      const myZones = isAdmin(req)
        ? null
        : new Set(
            getAllShiftSignups()
              .filter(signup =>
                sameEmail(signup.volunteerEmail, sessionEmail(req)) &&
                ['approved', 'attended'].includes(signup.status))
              .map(signup => shiftsToday.find(shift => shift.id === signup.shiftId)?.zone)
              .filter(Boolean) as string[]
          );

      const items = getActiveDutyItems().filter(item => {
        if (myZones && !myZones.has(item.zoneId)) return false;
        if (item.triggerType === 'daily') return true;
        if (item.triggerType === 'zone_shift') return zonesWithShifts.has(item.zoneId);
        return shiftId ? item.shiftId === shiftId : shiftsToday.some(s => s.id === item.shiftId);
      });

      // The teaching material a duty points at, resolved here rather than left
      // as two ids for the page to look up. It is the one place that knows
      // whether the section or video still exists -- a duty pointing at a
      // deleted one comes back as null instead of a dead link.
      const sopSections = new Map(getSopContent().sections.map(section => [section.id, section]));
      const sopVideos = new Map(getAllSopVideos().map(video => [video.id, video]));

      const duties = items.map(item => {
        // A duty tied to a specific shift is completed against that shift; a
        // daily one is completed once for the day regardless of shifts.
        const against = item.triggerType === 'specific_shift' ? item.shiftId : '';
        const done = byKey.get(completionKey(item.id, against));
        const section = item.sopSectionId ? sopSections.get(item.sopSectionId) : undefined;
        const video = item.sopVideoId ? sopVideos.get(item.sopVideoId) : undefined;
        return {
          ...item,
          completionShiftId: against,
          isCompleted: !!done,
          completedBy: done?.completedBy,
          completedAt: done?.completedAt,
          completionMethod: done?.method,
          // Training reaches the volunteer at the moment they are about to do
          // the thing, which is the only moment they have a reason to watch it.
          material: (section || video) ? {
            section: section
              ? { id: section.id, title: section.title, items: section.items }
              : null,
            video: video
              ? { id: video.id, title: video.title, description: video.description || '', fileUrl: video.fileUrl }
              : null
          } : null
        };
      });

      return res.json({ success: true, date, duties });
    } catch (error: any) {
      console.error("Today's Duties Error:", error);
      return res.status(500).json({ success: false, error: error.message || '讀取今日勤務失敗' });
    }
  });

  /**
   * Marks a duty done.
   *
   * Who did it comes from the session, never the body. The method column
   * mirrors attendance: 'self' is the volunteer's own tap, 'staff' is a
   * coordinator recording it for someone. A tick carries no proof the way a
   * check-in does -- GPS and a rotating code -- so recording how it was made
   * keeps the record honest rather than implying more certainty than exists.
   */
  app.post('/api/duties/:id/complete', (req: any, res) => {
    try {
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body?.date || ''))
        ? String(req.body.date)
        : shelterToday();

      const actor = isAdmin(req)
        ? String(req.session?.displayName || req.session?.identity || 'Admin')
        : (getVolunteerByEmail(sessionEmail(req))?.name || sessionEmail(req));

      const completion = completeDuty({
        dutyItemId: req.params.id,
        date,
        shiftId: String(req.body?.shiftId || ''),
        completedBy: actor,
        method: isAdmin(req) ? 'staff' : 'self',
        note: String(req.body?.note || '').trim()
      });
      if (!completion) return res.status(404).json({ success: false, error: '找不到該勤務項目' });

      broadcastChange('duties');
      return res.json({ success: true, completion });
    } catch (error: any) {
      console.error('Complete Duty Error:', error);
      return res.status(500).json({ success: false, error: error.message || '標記完成失敗' });
    }
  });

  app.post('/api/duties/:id/uncomplete', (req: any, res) => {
    try {
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body?.date || ''))
        ? String(req.body.date)
        : shelterToday();
      const removed = uncompleteDuty(req.params.id, date, String(req.body?.shiftId || ''));
      broadcastChange('duties');
      return res.json({ success: true, removed });
    } catch (error: any) {
      console.error('Uncomplete Duty Error:', error);
      return res.status(500).json({ success: false, error: error.message || '取消完成失敗' });
    }
  });

  /**
   * Daily care workload per area.
   *
   * This is the input the roster calculation starts from, and it is derived
   * from the duty items rather than entered a second time -- describing the
   * work once should be enough.
   */
  app.get('/api/admin/workload', (req, res) => {
    try {
      const zones = getAllZones();
      const zoneById = new Map(zones.map(zone => [zone.id, zone]));
      const workload = getZoneWorkload().map(row => ({
        ...row,
        zoneName: row.zoneId
          ? (zoneById.get(row.zoneId)?.name || `（已移除的場域：${row.zoneId}）`)
          : '全園區（不分場域）',
        zoneCode: row.zoneId ? (zoneById.get(row.zoneId)?.code || row.zoneId) : '—'
      }));

      const totals = workload.reduce(
        (acc, row) => ({
          personSlots: acc.personSlots + row.personSlots,
          personHours: Math.round((acc.personHours + row.personHours) * 10) / 10
        }),
        { personSlots: 0, personHours: 0 }
      );

      // The rows are already the fortnight's real totals -- getZoneWorkload
      // walks the fourteen days and counts each duty only on the weekdays it
      // runs. There used to be a "× 14" here instead, which is what reported a
      // Saturday adoption event as forty hours every day of the week.
      return res.json({
        success: true,
        workload,
        fortnight: totals,
        daily: {
          personSlots: Math.round((totals.personSlots / 14) * 10) / 10,
          personHours: Math.round((totals.personHours / 14) * 10) / 10
        }
      });
    } catch (error: any) {
      console.error('Workload Error:', error);
      return res.status(500).json({ success: false, error: error.message || '計算照護量失敗' });
    }
  });

  // ==========================================================================
  // Zones
  // --------------------------------------------------------------------------
  // The shelter's own areas, which used to be five values compiled into the
  // frontend. Reads are open to any signed-in user because volunteers need
  // them to make sense of a shift listing; every write is admin-only, and the
  // default-deny middleware above already guarantees the /api/admin prefix.
  //
  // There is no delete. Disabling is the strongest action available, because
  // shifts, signups and attendance rows all store a zone and would be left
  // pointing at nothing. See the comment on the table in db.ts.
  // ==========================================================================

  /** Palette keys the admin screen offers. Kept in step with src/data/zones.ts. */
  const ZONE_PALETTE_KEYS = ['rose', 'emerald', 'amber', 'sky', 'purple', 'teal', 'orange', 'slate'];

  app.get('/api/zones', (req: any, res) => {
    try {
      // Admins manage disabled zones, so they see everything. Volunteers only
      // ever need the ones a shift could currently be filed under.
      return res.json({ success: true, zones: isAdmin(req) ? getAllZones() : getActiveZones() });
    } catch (error: any) {
      console.error('Get Zones Error:', error);
      return res.status(500).json({ success: false, error: error.message || '讀取場域失敗' });
    }
  });

  /**
   * Validates the fields shared by create and update.
   * Returns an error string, or null when the input is usable.
   */
  function validateZoneInput(body: any, { partial = false } = {}): string | null {
    const name = body?.name;
    const code = body?.code;
    const palette = body?.palette;
    const icon = body?.icon;

    if (!partial || name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) return '請輸入場域名稱';
      if (name.trim().length > 40) return '場域名稱請控制在 40 個字以內';
    }
    if (!partial || code !== undefined) {
      if (typeof code !== 'string' || !code.trim()) return '請輸入場域代碼';
      if (!/^[A-Za-z0-9_-]{1,12}$/.test(code.trim())) return '場域代碼只能使用英數字、連字號或底線，最多 12 個字元';
    }
    if (!partial || palette !== undefined) {
      // A palette outside this list would store fine and then render with no
      // colour at all, because Tailwind only ships classes it saw in source.
      if (!ZONE_PALETTE_KEYS.includes(String(palette))) return '請選擇一個可用的顏色';
    }
    if (!partial || icon !== undefined) {
      if (typeof icon !== 'string' || !icon.trim()) return '請選擇一個圖示';
      if ([...String(icon)].length > 2) return '圖示請使用一個表情符號';
    }
    return null;
  }

  app.post('/api/admin/zones', (req, res) => {
    try {
      const problem = validateZoneInput(req.body);
      if (problem) return res.status(400).json({ success: false, error: problem });

      const zone = createZone({
        name: String(req.body.name).trim(),
        code: String(req.body.code).trim().toUpperCase(),
        palette: String(req.body.palette),
        icon: String(req.body.icon).trim(),
        description: String(req.body.description || '').trim()
      });
      broadcastChange('zones');
      return res.json({ success: true, zone });
    } catch (error: any) {
      console.error('Create Zone Error:', error);
      return res.status(500).json({ success: false, error: error.message || '新增場域失敗' });
    }
  });

  app.put('/api/admin/zones/:id', (req, res) => {
    try {
      const problem = validateZoneInput(req.body, { partial: true });
      if (problem) return res.status(400).json({ success: false, error: problem });

      const updated = updateZone(req.params.id, {
        name: req.body.name !== undefined ? String(req.body.name).trim() : undefined,
        code: req.body.code !== undefined ? String(req.body.code).trim().toUpperCase() : undefined,
        palette: req.body.palette !== undefined ? String(req.body.palette) : undefined,
        icon: req.body.icon !== undefined ? String(req.body.icon).trim() : undefined,
        description: req.body.description !== undefined ? String(req.body.description).trim() : undefined
      });
      if (!updated) return res.status(404).json({ success: false, error: '找不到該場域' });

      broadcastChange('zones');
      return res.json({ success: true, zone: updated });
    } catch (error: any) {
      console.error('Update Zone Error:', error);
      return res.status(500).json({ success: false, error: error.message || '更新場域失敗' });
    }
  });

  /**
   * How many records a zone already carries. The management screen asks before
   * disabling, so the decision is made knowing what it affects rather than
   * discovering it afterwards.
   */
  app.get('/api/admin/zones/:id/usage', (req, res) => {
    try {
      if (!getZone(req.params.id)) {
        return res.status(404).json({ success: false, error: '找不到該場域' });
      }
      return res.json({ success: true, usage: countZoneUsage(req.params.id) });
    } catch (error: any) {
      console.error('Zone Usage Error:', error);
      return res.status(500).json({ success: false, error: error.message || '查詢場域使用狀況失敗' });
    }
  });

  app.post('/api/admin/zones/:id/disable', (req, res) => {
    try {
      // The last active zone cannot be turned off: with none left, no shift
      // could be created at all and the way back would be through this same
      // screen, which needs a zone to show.
      const active = getActiveZones();
      if (active.length <= 1 && active.some(zone => zone.id === req.params.id)) {
        return res.status(400).json({ success: false, error: '至少要保留一個啟用中的場域' });
      }

      const updated = setZoneStatus(req.params.id, 'disabled');
      if (!updated) return res.status(404).json({ success: false, error: '找不到該場域' });

      broadcastChange('zones');
      const usage = countZoneUsage(req.params.id);
      return res.json({
        success: true,
        zone: updated,
        usage,
        note: '已停用。既有的班次與出勤紀錄不受影響，仍會正常顯示；新班次不能再選擇這個場域。'
      });
    } catch (error: any) {
      console.error('Disable Zone Error:', error);
      return res.status(500).json({ success: false, error: error.message || '停用場域失敗' });
    }
  });

  app.post('/api/admin/zones/:id/restore', (req, res) => {
    try {
      const updated = setZoneStatus(req.params.id, 'active');
      if (!updated) return res.status(404).json({ success: false, error: '找不到該場域' });
      broadcastChange('zones');
      return res.json({ success: true, zone: updated });
    } catch (error: any) {
      console.error('Restore Zone Error:', error);
      return res.status(500).json({ success: false, error: error.message || '恢復場域失敗' });
    }
  });

  /**
   * Coordinators see drafts; volunteers do not.
   *
   * Filtered here rather than in the page, because a draft is a shift nobody
   * has agreed to run yet -- offering it and then withdrawing it is exactly the
   * broken promise the two-layer plan exists to avoid. Any caller that skips
   * the page still cannot see one.
   */
  app.get('/api/shifts', (req: any, res) => {
    try {
      const all = getAllShifts();
      const visible = isAdmin(req) ? all : all.filter(shift => shift.status !== 'draft');
      return res.json({ success: true, shifts: visible });
    } catch (error: any) {
      console.error('Get Shifts Error:', error);
      return res.status(500).json({ success: false, error: error.message || '讀取班次失敗' });
    }
  });

  // ==========================================================================
  // Generating a period's roster
  // --------------------------------------------------------------------------
  // The plan's main source of relief: state each zone's daily care work once,
  // and a fortnight of shifts falls out of it instead of being typed in one
  // form at a time.
  // ==========================================================================

  /** Reads a YYYY-MM-DD, or today in the shelter's own timezone. */
  function requestedStart(value: unknown): string {
    const raw = String(value || '');
    return /^\d{4}-\d{2}-\d{2}$/.test(raw)
      ? raw
      : new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
  }

  /** Days to cover. Two weeks by default, capped so one click cannot fill a year. */
  function requestedDays(value: unknown): number {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n) || n < 1) return 14;
    return Math.min(n, 60);
  }

  const rangeEnd = (start: string, days: number) =>
    new Date(new Date(`${start}T00:00:00+08:00`).getTime() + (days - 1) * 86400000)
      .toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });

  /** What would be produced, without writing anything. */
  app.post('/api/admin/schedule/preview', (req, res) => {
    try {
      const startDate = requestedStart(req.body?.startDate);
      const days = requestedDays(req.body?.days);
      const planned = planShiftsForRange(startDate, days);
      return res.json({
        success: true, startDate, days, endDate: rangeEnd(startDate, days),
        planned, mergeGapMinutes: SHIFT_MERGE_GAP_MINUTES
      });
    } catch (error: any) {
      console.error('Schedule Preview Error:', error);
      return res.status(500).json({ success: false, error: error.message || '試算班表失敗' });
    }
  });

  /** Writes the plan as drafts. Never modifies a shift that already exists. */
  app.post('/api/admin/schedule/generate', (req, res) => {
    try {
      const startDate = requestedStart(req.body?.startDate);
      const days = requestedDays(req.body?.days);
      const { created, skipped } = generateDraftShifts(startDate, days);
      if (created.length > 0) broadcastChange('shifts');
      console.log(`SQLite: 自動產生 ${created.length} 個班次草稿（略過已存在 ${skipped.length} 個）`);
      return res.json({
        success: true, startDate, days, endDate: rangeEnd(startDate, days),
        created, skipped
      });
    } catch (error: any) {
      console.error('Schedule Generate Error:', error);
      return res.status(500).json({ success: false, error: error.message || '產生班表失敗' });
    }
  });

  /** Publishes the range's drafts -- this is the moment volunteers can see them. */
  app.post('/api/admin/schedule/publish', (req, res) => {
    try {
      const startDate = requestedStart(req.body?.startDate);
      const days = requestedDays(req.body?.days);
      const endDate = rangeEnd(startDate, days);
      const published = publishDraftShifts(startDate, endDate);
      if (published > 0) broadcastChange('shifts');
      console.log(`SQLite: 發布 ${published} 個班次（${startDate} ~ ${endDate}）`);
      return res.json({ success: true, published, startDate, endDate });
    } catch (error: any) {
      console.error('Schedule Publish Error:', error);
      return res.status(500).json({ success: false, error: error.message || '發布班表失敗' });
    }
  });

  /** Throws the range's unpublished drafts away, so it can be generated again. */
  app.post('/api/admin/schedule/discard', (req, res) => {
    try {
      const startDate = requestedStart(req.body?.startDate);
      const days = requestedDays(req.body?.days);
      const endDate = rangeEnd(startDate, days);
      const discarded = discardDraftShifts(startDate, endDate);
      if (discarded > 0) broadcastChange('shifts');
      // Logged for the same reason the generate is: without it, reading the log
      // later cannot tell "generated twice" from "generated, discarded,
      // generated" -- and those mean very different things.
      console.log(`SQLite: 清除 ${discarded} 個未發布草稿（${startDate} ~ ${endDate}）`);
      return res.json({ success: true, discarded, startDate, endDate });
    } catch (error: any) {
      console.error('Schedule Discard Error:', error);
      return res.status(500).json({ success: false, error: error.message || '清除草稿失敗' });
    }
  });

  app.post('/api/shifts', requireAdmin, (req, res) => {
    try {
      const shift = req.body;
      if (!shift?.id || !shift?.title || !shift?.date) {
        return res.status(400).json({ success: false, error: '缺少班次必要欄位' });
      }

      // Zones stopped being a compile-time union when they became editable, so
      // the check that used to happen in the type system happens here instead.
      // A shift filed under a zone that does not exist would render as "未知場域"
      // forever, and one filed under a disabled zone would quietly reopen an
      // area the shelter had closed.
      const zone = getZone(String(shift.zone || ''));
      if (!zone) {
        return res.status(400).json({ success: false, error: '找不到這個場域，請重新選擇' });
      }
      if (zone.status !== 'active') {
        return res.status(400).json({ success: false, error: `【${zone.name}】已停用，無法用於新班次` });
      }

      const created = insertShift(shift);
      broadcastChange('shifts');
      return res.json({ success: true, shift: created });
    } catch (error: any) {
      console.error('Create Shift Error:', error);
      return res.status(500).json({ success: false, error: error.message || '建立班次失敗' });
    }
  });

  app.put('/api/shifts/:id', requireAdmin, (req, res) => {
    try {
      const updated = updateShift({ ...req.body, id: req.params.id });
      if (!updated) {
        return res.status(404).json({ success: false, error: '找不到該班次' });
      }
      broadcastChange('shifts');
      return res.json({ success: true, shift: updated });
    } catch (error: any) {
      console.error('Update Shift Error:', error);
      return res.status(500).json({ success: false, error: error.message || '更新班次失敗' });
    }
  });

  app.delete('/api/shifts/:id', requireAdmin, (req, res) => {
    try {
      const removed = deleteShift(req.params.id);
      if (!removed) {
        return res.status(404).json({ success: false, error: '找不到該班次' });
      }
      broadcastChange('shifts');
      broadcastChange('signups'); // its signups went with it
      return res.json({ success: true });
    } catch (error: any) {
      console.error('Delete Shift Error:', error);
      return res.status(500).json({ success: false, error: error.message || '刪除班次失敗' });
    }
  });

  // Admins review the whole queue; a volunteer gets their own bookings. The
  // full list carries every applicant's name, phone and LINE ID, and the
  // volunteer portal already filtered it down to the current user in the
  // browser -- so nothing on screen changes, the data just stops leaving the
  // server in the first place.
  app.get('/api/shift-signups', (req: any, res) => {
    try {
      const all = getAllShiftSignups();
      if (isAdmin(req)) {
        return res.json({ success: true, shiftSignups: all });
      }
      const me = getVolunteerByEmail(sessionEmail(req));
      const mine = all.filter(a =>
        sameEmail(a.volunteerEmail, sessionEmail(req)) ||
        // Bookings filed before the server started stamping the owner have a
        // blank email; fall back to the name so those stay visible to the
        // person they belong to. Same allowance the cancel route makes.
        (!String(a.volunteerEmail || '').trim() && !!me && a.volunteerName === me.name)
      );
      return res.json({ success: true, shiftSignups: mine });
    } catch (error: any) {
      console.error('Get Applications Error:', error);
      return res.status(500).json({ success: false, error: error.message || '讀取報名紀錄失敗' });
    }
  });

  // Signing up both records it and takes a seat on the shift, so the
  // two stay consistent even if two volunteers apply from different devices at
  // the same time -- the headcount is incremented server-side, not sent up by
  // whichever client happened to compute it last.
  app.post('/api/shift-signups', requireAuth, (req, res) => {
    try {
      const shiftSignup = req.body;
      if (!shiftSignup?.id || !shiftSignup?.shiftId || !shiftSignup?.volunteerName) {
        return res.status(400).json({ success: false, error: '缺少報名必要欄位' });
      }

      // Who this booking belongs to comes from the session, never from the
      // form. It used to be whatever the sign-up field contained, which is how
      // bookings ended up owned by an address their owner couldn't match --
      // and therefore couldn't cancel. Admins may still file one for someone
      // else, since that's a real thing coordinators do over the phone.
      const owned = (req as any).session.role === 'volunteer'
        ? { ...shiftSignup, volunteerEmail: (req as any).session.identity }
        : shiftSignup;

      // A suspended or filed-away volunteer cannot take a place. Checked here
      // rather than hidden in the UI, because the rule has to hold however the
      // request arrives.
      const booker = getVolunteerByEmail(String(owned.volunteerEmail || ''));
      if (booker && booker.accountStatus && booker.accountStatus !== 'active') {
        return res.status(403).json({
          success: false,
          error: booker.accountStatus === 'suspended'
            ? '此志工帳號目前為停權狀態，無法報名班次。請與社工督導聯繫恢復。'
            : '此志工帳號目前為離退狀態，請與社工督導聯繫。'
        });
      }

      // A draft has not been published. Nobody should be able to reach one, but
      // the rule belongs where it cannot be skipped rather than only in the list.
      const target = getShift(String(owned.shiftId || ''));
      if (target && target.status === 'draft') {
        return res.status(409).json({ success: false, error: '這個班次尚未發布，暫時無法報名。' });
      }

      const saved = insertShiftSignup(owned);
      // No counter to bump -- the shift's headcount is read from the signups,
      // so re-reading it is what reflects the one just created.
      const shift = getShift(shiftSignup.shiftId);
      broadcastChange('signups');
      broadcastChange('shifts');
      return res.json({ success: true, shiftSignup: saved, shift });
    } catch (error: any) {
      console.error('Create Application Error:', error);
      return res.status(500).json({ success: false, error: error.message || '送出報名失敗' });
    }
  });

  // Rejecting a previously-approved signup frees the seat back up; the
  // client no longer has to work that out for itself.
  app.put('/api/shift-signups/:id/status', requireAdmin, (req: any, res) => {
    try {
      const { status, reviewNotes } = req.body || {};
      if (!status) {
        return res.status(400).json({ success: false, error: '缺少審核狀態' });
      }

      const before = getAllShiftSignups().find(a => a.id === req.params.id);
      if (!before) {
        return res.status(404).json({ success: false, error: '找不到該筆報名' });
      }

      const decidedBy = String(req.session?.displayName || req.session?.identity || 'Admin');
      const updated = updateShiftSignupStatus(req.params.id, status, reviewNotes, decidedBy);

      // Confirming a no-show is what moves the count the rulebook's suspension
      // rule reads. The state change happens inline so the answer can say
      // whether this particular click cost somebody their booking rights: the
      // coordinator who caused it should not have to go looking elsewhere to
      // find out what they just did.
      const suspension = status === 'absent' && before.volunteerEmail
        ? applyAbsenceRule(before.volunteerEmail)
        : null;
      // Rejecting or marking absent frees the place, but nothing has to be
      // decremented for that to be true: the headcount excludes those statuses,
      // so the shift already reads correctly once the signup is updated.
      const shift = getShift(before.shiftId);
      broadcastChange('signups');
      broadcastChange('shifts');
      return res.json({ success: true, shiftSignup: updated, shift, suspension });
    } catch (error: any) {
      console.error('Update Application Status Error:', error);
      return res.status(500).json({ success: false, error: error.message || '更新報名狀態失敗' });
    }
  });

  /**
   * Whether the signed-in volunteer owns this booking.
   *
   * Normally the email settles it. Bookings made before the server started
   * stamping the owner can have a blank email though, and refusing those
   * forever would leave volunteers unable to touch their own shift -- so fall
   * back to name plus phone, which together are specific enough.
   */
  function ownsSignup(req: any, target: any): boolean {
    if (req.session?.role !== 'volunteer') return false;
    const norm = (v: unknown) => String(v || '').trim().toLowerCase();

    // The same number is written "+886912345678" on a volunteer record and
    // "0912-345-678" on a booking form, so compare the digits with the
    // Taiwan country code folded back into a leading zero.
    const samePhone = (a: unknown, b: unknown) => {
      const digits = (v: unknown) => {
        const d = String(v || '').replace(/\D/g, '');
        return d.startsWith('886') ? '0' + d.slice(3) : d;
      };
      const da = digits(a);
      return !!da && da === digits(b);
    };

    const me = getVolunteerByEmail(req.session.identity);
    return (
      (!!target.volunteerEmail && norm(target.volunteerEmail) === norm(req.session.identity)) ||
      (!norm(target.volunteerEmail) && !!me &&
        norm(target.volunteerName) === norm(me.name) &&
        samePhone(target.volunteerPhone, me.phone))
    );
  }

  /**
   * Cancelling a booking.
   *
   * Two changes from what this used to be. It no longer deletes the row -- see
   * cancelShiftSignup -- and close to the shift it is no longer the way out.
   *
   * The rulebook asks for 24 hours' notice, and a cancel button that works
   * right up to the start makes that sentence decorative: the shelter finds out
   * at the same moment either way, except now nobody has been asked to cover.
   * Inside the window the volunteer is sent to raise a substitution request
   * instead, which is the route the rulebook actually describes. Coordinators
   * are not held to it, because they cancel on behalf of people who have rung
   * up, and the phone call is the notice.
   */
  app.delete('/api/shift-signups/:id', requireAuth, (req: any, res) => {
    try {
      const target = getAllShiftSignups().find(a => a.id === req.params.id);
      if (!target) {
        return res.status(404).json({ success: false, error: '找不到該筆報名' });
      }

      if (req.session.role !== 'admin' && !ownsSignup(req, target)) {
        return res.status(403).json({ success: false, error: '只能取消自己的報名。' });
      }

      if (req.session.role !== 'admin') {
        const hours = hoursUntilShift(target.shiftId);
        if (hours !== null && hours < 0) {
          return res.status(409).json({
            success: false,
            error: '這個班次已經開始或結束了，無法取消。如果沒有到場，請與社工督導說明。'
          });
        }
        if (hours !== null && hours < SUBSTITUTION_NOTICE_HOURS) {
          return res.status(409).json({
            success: false,
            needsSubstitution: true,
            error: `距離班次開始不到 ${SUBSTITUTION_NOTICE_HOURS} 小時，依志工規章不能直接取消。`
              + `請改為發起「代班請求」，讓其他志工有機會接手。`
          });
        }
      }

      const cancelledBy = String(req.session?.displayName || req.session?.identity || '');
      const cancelled = cancelShiftSignup(req.params.id, cancelledBy);
      if (!cancelled) {
        return res.status(404).json({ success: false, error: '找不到該筆報名' });
      }
      const shift = getShift(cancelled.shiftId);
      broadcastChange('signups');
      broadcastChange('shifts');
      return res.json({ success: true, shiftSignup: cancelled, shift });
    } catch (error: any) {
      console.error('Cancel Signup Error:', error);
      return res.status(500).json({ success: false, error: error.message || '取消報名失敗' });
    }
  });

  // ==========================================================================
  // Substitution requests
  // --------------------------------------------------------------------------
  // The rulebook told volunteers to raise one of these 24 hours before a shift
  // they could not make. There was nowhere to raise one, so the only way out of
  // a booking was to cancel it -- which freed the place silently and asked
  // nobody to cover it.
  // ==========================================================================

  /** Everything still waiting for somebody, with enough of the shift to render it. */
  app.get('/api/substitutions', (req: any, res) => {
    try {
      const requests = getOpenSubstitutions()
        .map(request => {
          const shift = getShift(request.shiftId);
          if (!shift) return null;
          return {
            ...request,
            hoursUntil: hoursUntilShift(request.shiftId),
            shift: {
              id: shift.id, title: shift.title, zone: shift.zone,
              date: shift.date, timeRange: shift.timeRange
            }
          };
        })
        .filter(Boolean)
        // A shift that has already started cannot be covered; expireStaleSubstitutions
        // closes those overnight, this keeps them out of the list in the meantime.
        .filter((r: any) => r.hoursUntil === null || r.hoursUntil > 0);

      return res.json({ success: true, requests, noticeHours: SUBSTITUTION_NOTICE_HOURS });
    } catch (error: any) {
      console.error('List Substitutions Error:', error);
      return res.status(500).json({ success: false, error: error.message || '讀取代班請求失敗' });
    }
  });

  /**
   * Raise a request against one of your own bookings.
   *
   * Suspended volunteers may still do this. They cannot take new shifts, but
   * they may well be holding one booked before the suspension, and handing it
   * over is precisely what the shelter wants them to do with it.
   */
  app.post('/api/shift-signups/:id/substitution', async (req: any, res) => {
    try {
      const target = getAllShiftSignups().find(a => a.id === req.params.id);
      if (!target) {
        return res.status(404).json({ success: false, error: '找不到該筆報名' });
      }
      if (req.session.role !== 'admin' && !ownsSignup(req, target)) {
        return res.status(403).json({ success: false, error: '只能為自己的報名發起代班請求。' });
      }
      if (target.status !== 'approved') {
        return res.status(409).json({
          success: false,
          error: target.status === 'pending'
            ? '這筆報名還在審核中，錄取之後才需要代班。'
            : '這筆報名已經結束，不需要代班。'
        });
      }
      if (getOpenSubstitutionForSignup(target.id)) {
        return res.status(409).json({ success: false, error: '這個班次已經有一筆進行中的代班請求了。' });
      }
      const hours = hoursUntilShift(target.shiftId);
      if (hours !== null && hours < 0) {
        return res.status(409).json({ success: false, error: '這個班次已經開始或結束了。' });
      }

      const request = createSubstitutionRequest({
        signupId: target.id,
        shiftId: target.shiftId,
        requesterEmail: target.volunteerEmail || String(req.session.identity || ''),
        requesterName: target.volunteerName,
        reason: String(req.body?.reason || '').trim().slice(0, 200)
      });

      broadcastChange('signups');
      broadcastChange('shifts');
      return res.json({ success: true, request, noticeHours: SUBSTITUTION_NOTICE_HOURS });
    } catch (error: any) {
      console.error('Create Substitution Error:', error);
      return res.status(500).json({ success: false, error: error.message || '發起代班請求失敗' });
    }
  });

  /** Take somebody's shift. */
  app.post('/api/substitutions/:id/take', async (req: any, res) => {
    try {
      const request = getSubstitutionRequest(req.params.id);
      if (!request) {
        return res.status(404).json({ success: false, error: '找不到這筆代班請求' });
      }

      // An admin filing it for somebody who rang up needs to say who; a
      // volunteer is always taking it themselves.
      const email = isAdmin(req)
        ? String(req.body?.email || '').trim().toLowerCase()
        : sessionEmail(req);
      if (!email) {
        return res.status(400).json({ success: false, error: '缺少接手志工的識別' });
      }
      const taker = getVolunteerByEmail(email);
      if (!taker) {
        return res.status(404).json({ success: false, error: '找不到這位志工的資料' });
      }
      // Same rule as booking: a suspended account cannot take a place.
      if (taker.accountStatus && taker.accountStatus !== 'active') {
        return res.status(403).json({
          success: false,
          error: taker.accountStatus === 'suspended'
            ? '此志工帳號目前為停權狀態，無法接手班次。請與社工督導聯繫恢復。'
            : '此志工帳號目前為離退狀態，請與社工督導聯繫。'
        });
      }

      const result = takeSubstitutionRequest(request.id, {
        email, name: taker.name, phone: taker.phone, lineId: taker.lineId
      });
      if ('error' in result) {
        return res.status(409).json({ success: false, error: result.error });
      }

      const shift = getShift(request.shiftId);
      const when = shift ? `${shift.date} ${shift.timeRange}${shift.title ? `（${shift.title}）` : ''}` : '';

      // The person who asked has been waiting to find out whether they are
      // still expected. Telling them is the whole point of the feature.
      void notifyVolunteerDirect(
        request.requesterEmail,
        `【浪浪家園】${request.requesterName} 您好，您 ${when} 的班次已由 ${taker.name} 接手，`
        + `您不需要再出席，這次不會列入未到紀錄。感謝您提前告知 🐾`
      );
      void notifyVolunteerDirect(
        email,
        `【浪浪家園】${taker.name} 您好，感謝您接下 ${request.requesterName} 的班次：${when}。`
        + `班次已加入您的排班，請準時到場並記得掃碼簽到 🐾`
      );

      broadcastChange('signups');
      broadcastChange('shifts');
      return res.json({ success: true, request: result.request, shiftSignup: result.signup, shift });
    } catch (error: any) {
      console.error('Take Substitution Error:', error);
      return res.status(500).json({ success: false, error: error.message || '接手代班失敗' });
    }
  });

  /** Call it off -- the requester found their own cover, or can come after all. */
  app.post('/api/substitutions/:id/withdraw', (req: any, res) => {
    try {
      const request = getSubstitutionRequest(req.params.id);
      if (!request) {
        return res.status(404).json({ success: false, error: '找不到這筆代班請求' });
      }
      const isOwner = req.session.role === 'volunteer' &&
        sessionEmail(req) === request.requesterEmail;
      if (!isAdmin(req) && !isOwner) {
        return res.status(403).json({ success: false, error: '只能撤回自己發起的代班請求。' });
      }
      const updated = withdrawSubstitutionRequest(request.id);
      if (!updated) {
        return res.status(409).json({ success: false, error: '這筆代班請求已經結束了。' });
      }
      broadcastChange('signups');
      broadcastChange('shifts');
      return res.json({ success: true, request: updated });
    } catch (error: any) {
      console.error('Withdraw Substitution Error:', error);
      return res.status(500).json({ success: false, error: error.message || '撤回代班請求失敗' });
    }
  });

  // The whole roster -- every volunteer's phone, email, LINE ID and emergency
  // contact. That is the admin roster page and nothing else; the volunteer
  // portal never renders it.
  app.get('/api/volunteers', requireAdmin, (req, res) => {
    try {
      return res.json({ success: true, volunteers: getAllVolunteers() });
    } catch (error: any) {
      console.error('Get Volunteers Error:', error);
      return res.status(500).json({ success: false, error: error.message || '讀取志工名冊失敗' });
    }
  });

  // Admin edit of a volunteer's roster details (skills / zones / contact info).
  app.put('/api/admin/volunteers/:email', (req, res) => {
    try {
      const email = decodeURIComponent(req.params.email);
      const { name, phone, lineId, skills, preferredZones, emergencyContact } = req.body || {};

      const updated = updateVolunteerDetails(email, {
        name, phone, lineId, emergencyContact,
        skills: Array.isArray(skills) ? skills : undefined,
        preferredZones: Array.isArray(preferredZones) ? preferredZones : undefined
      });

      if (!updated) {
        return res.status(404).json({ success: false, error: '找不到該位志工' });
      }
      broadcastChange('volunteers');
      return res.json({ success: true, volunteer: updated });
    } catch (error: any) {
      console.error('Update Volunteer Error:', error);
      return res.status(500).json({ success: false, error: error.message || '更新志工資料失敗' });
    }
  });

  // Admin delete. Irreversible, so the confirmation lives in the UI -- this just
  // reports honestly whether a row was actually removed.
  app.delete('/api/admin/volunteers/:email', (req, res) => {
    try {
      const email = decodeURIComponent(req.params.email);
      const removed = deleteVolunteer(email);
      if (!removed) {
        return res.status(404).json({ success: false, error: '找不到該位志工' });
      }
      broadcastChange('volunteers');
      broadcastChange('promotions'); // their pending requests went too
      return res.json({ success: true });
    } catch (error: any) {
      console.error('Delete Volunteer Error:', error);
      return res.status(500).json({ success: false, error: error.message || '刪除志工失敗' });
    }
  });

  // API endpoint: a single volunteer's full profile (including emergencyContact and
  // avatar, which the roster-list endpoint above also returns but the settings tab
  // only needs one record of). Used to seed the settings form with what's actually
  // saved server-side instead of only whatever this browser's localStorage has.
  app.get('/api/volunteers/profile', (req: any, res) => {
    try {
      // A volunteer always reads their own record: the email comes from the
      // session, not the query string. It used to be whatever was in the URL,
      // which made this a lookup service for anyone's personal details.
      const email = isAdmin(req) ? String(req.query.email || '') : sessionEmail(req);
      if (!email) return res.status(400).json({ success: false, error: '缺少 email' });
      const volunteer = getVolunteerByEmail(email);
      if (!volunteer) return res.status(404).json({ success: false, error: '找不到此志工資料' });
      return res.json({ success: true, volunteer });
    } catch (error: any) {
      console.error('Get Volunteer Profile Error:', error);
      return res.status(500).json({ success: false, error: error.message || '讀取志工資料失敗' });
    }
  });

  // API endpoint: self-edit fields that upsertVolunteerFromLogin deliberately leaves
  // alone -- emergency contact text, and an uploaded avatar photo. The avatar is
  // expected to already be downscaled/compressed client-side (see
  // VolunteerCheckInModal's canvas-downscale pattern) before being sent here as base64,
  // to keep the write small; this endpoint does not re-compress it.
  app.post('/api/volunteers/profile-extras', (req: any, res) => {
    try {
      const { emergencyContact, avatarBase64, avatarMimeType } = req.body;
      // Whose profile this edits comes from the session. Taking it from the
      // body meant any caller could rewrite any volunteer's emergency contact
      // and replace their photo.
      const email = isAdmin(req) ? String(req.body?.email || '') : sessionEmail(req);
      if (!email) return res.status(400).json({ success: false, error: '缺少 email' });

      const updates: { emergencyContact?: string; avatar?: string } = {};
      if (typeof emergencyContact === 'string') {
        updates.emergencyContact = emergencyContact.trim();
      }
      if (avatarBase64) {
        const ext = avatarMimeType === 'image/png' ? 'png' : 'jpg';
        const filename = `${String(email).toLowerCase().trim().replace(/[^a-z0-9]/gi, '_')}.${ext}`;
        writeFileSync(path.join(avatarsDir, filename), Buffer.from(avatarBase64, 'base64'));
        // Cache-bust so the browser doesn't keep showing a stale cached image after
        // a volunteer re-uploads a new photo under the exact same filename.
        updates.avatar = `/avatars/${filename}?v=${Date.now()}`;
      }

      const updated = updateVolunteerProfileExtras(email, updates);
      if (!updated) {
        return res.status(404).json({ success: false, error: '找不到此志工資料，請先完成一次登入同步' });
      }
      broadcastChange('volunteers');
      return res.json({ success: true, volunteer: updated });
    } catch (error: any) {
      console.error('Update Volunteer Profile Extras Error:', error);
      return res.status(500).json({ success: false, error: error.message || '更新個人資料失敗' });
    }
  });

  // Coordinator adjustment of someone's recorded hours.
  //
  // This is admin-only now, and volunteers no longer call it at all: a normal
  // check-out credits the hours inside the check-out handler below, from the
  // record the server already has. Previously anyone could POST a name and a
  // number here and the totals moved -- no session, no ownership, no ceiling.
  app.post('/api/volunteers/log-hours', requireAdmin, (req, res) => {
    try {
      const { name, hoursLogged } = req.body;
      if (!name || typeof hoursLogged !== 'number') {
        return res.status(400).json({ success: false, error: '缺少志工姓名或服務時數' });
      }
      addCompletedShiftHours(name, hoursLogged);
      broadcastChange('volunteers');
      return res.json({ success: true });
    } catch (error: any) {
      console.error('Log Hours Error:', error);
      return res.status(500).json({ success: false, error: error.message || '更新服務時數失敗' });
    }
  });

  // API endpoint: attendance records — single source of truth (was localStorage-only
  // before, so different devices/browsers never saw each other's check-ins)
  // Admins run the attendance board and see everything. A volunteer sees their
  // own history -- which is all their screens ever displayed anyway; the filter
  // just used to happen in the browser, after the server had already handed
  // over every record for everyone.
  app.get('/api/attendance', (req: any, res) => {
    try {
      const all = getAllAttendanceRecords();
      if (isAdmin(req)) {
        return res.json({ success: true, records: all });
      }
      const me = getVolunteerByEmail(sessionEmail(req));
      if (!me) {
        return res.json({ success: true, records: [] });
      }
      // Attendance rows identify the volunteer by name (that is what the
      // check-in handler stamps), with the signupId as a second route in
      // for rows created from an approved booking.
      const mySignupIds = new Set(
        getAllShiftSignups()
          .filter(a => sameEmail(a.volunteerEmail, me.email))
          .map(a => a.id)
      );
      const records = all.filter(
        r => r.volunteerName === me.name || (r.signupId && mySignupIds.has(r.signupId))
      );
      return res.json({ success: true, records });
    } catch (error: any) {
      console.error('Get Attendance Error:', error);
      return res.status(500).json({ success: false, error: error.message || '讀取出勤紀錄失敗' });
    }
  });

  // --------------------------------------------------------------------------
  // On-site check-in
  // --------------------------------------------------------------------------
  // This used to accept whatever the browser posted -- name, shift, distance,
  // "locationVerified: true" -- and store it. The geofence was computed in the
  // page, so it proved nothing: anyone could check in from anywhere, for anyone.
  //
  // Now the server decides. Two independent proofs, both checked here:
  //
  //   1. A rotating 6-digit code shown only on the on-site station screen.
  //      It's an HMAC of the current 60-second window, so it can't be guessed
  //      or shared ahead of time, and there's nothing to store or expire.
  //   2. The phone's GPS, with the distance measured here against the address
  //      in the database -- not trusted from the request body.
  //
  // Plus the boring but important ones: you must be signed in, the shift must
  // be today and roughly now, you must have an approved signup for it,
  // and you can't already be checked in.
  const SITE_CODE_WINDOW_SECONDS = 60;
  const GEOFENCE_RADIUS_METERS = 500;

  function siteCodeForWindow(windowIndex: number): string {
    const digest = createHmac('sha256', getAppSecret('site_check_in_secret'))
      .update(String(windowIndex))
      .digest();
    // Same truncation idea as TOTP: take 31 bits, mod into 6 digits.
    const offset = digest[digest.length - 1] & 0x0f;
    const binary =
      ((digest[offset] & 0x7f) << 24) |
      (digest[offset + 1] << 16) |
      (digest[offset + 2] << 8) |
      digest[offset + 3];
    return String(binary % 1000000).padStart(6, '0');
  }

  function currentWindowIndex(): number {
    return Math.floor(Date.now() / 1000 / SITE_CODE_WINDOW_SECONDS);
  }

  /** Accepts the current window and the previous one, so a code doesn't expire
      out from under someone mid-typing. */
  function isValidSiteCode(input: string): boolean {
    const cleaned = String(input || '').replace(/\D/g, '');
    if (cleaned.length !== 6) return false;
    const now = currentWindowIndex();
    return [now, now - 1].some(w => {
      const expected = Buffer.from(siteCodeForWindow(w));
      const given = Buffer.from(cleaned);
      return expected.length === given.length && timingSafeEqual(expected, given);
    });
  }

  function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371e3;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
  }

  // A printed poster carries a static signed token instead of the rotating
  // code, because paper can't count down. That trade is deliberate and it is
  // worth being clear about what it costs: a photograph of the poster is as
  // good as the poster, so the token proves only "this came from us", not
  // "this person is here". Presence therefore rests entirely on GPS, and
  // check-in refuses a poster scan without it -- see the handler below.
  // 16 hex characters, not 32. The token is unguessable either way -- 64 bits
  // of HMAC output -- and it is not what proves presence anyway (GPS is). What
  // the extra 16 characters did cost was QR density: they pushed the poster URL
  // up a symbol version, shrinking every module and making the code harder for
  // a phone camera to read across a room.
  function posterToken(): string {
    return createHmac('sha256', getAppSecret('site_check_in_secret'))
      .update('printed-poster-v1')
      .digest('hex')
      .slice(0, 16);
  }

  function isValidPosterToken(input: string): boolean {
    const given = Buffer.from(String(input || ''));
    const expected = Buffer.from(posterToken());
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  app.get('/api/admin/attendance/poster', (req, res) => {
    const shelter = getShelterLocation();
    return res.json({
      success: true,
      token: posterToken(),
      path: `/?c=${posterToken()}`,
      geocoded: shelter.geocoded,
      shelterName: shelter.name,
      radiusMeters: GEOFENCE_RADIUS_METERS
    });
  });

  // The station screen polls this to display the current code. Admin-only --
  // if any volunteer could fetch it, standing at the gate would stop meaning
  // anything.
  app.get('/api/admin/attendance/site-code', (req, res) => {
    const windowIndex = currentWindowIndex();
    const elapsed = Math.floor(Date.now() / 1000) % SITE_CODE_WINDOW_SECONDS;
    return res.json({
      success: true,
      code: siteCodeForWindow(windowIndex),
      expiresInSeconds: SITE_CODE_WINDOW_SECONDS - elapsed,
      windowSeconds: SITE_CODE_WINDOW_SECONDS
    });
  });

  /**
   * Tells a volunteer what today holds, at the moment they arrive.
   *
   * Before this, checking in confirmed a time and nothing else: the duty list
   * lived on a screen only coordinators could reach, so a volunteer on site had
   * no way to find out what the shelter needed from them beyond asking.
   */
  async function sendArrivalBriefing(shift: any, volunteerName: string): Promise<void> {
    try {
      const email = String(
        getAllVolunteers().find(v => v.name === volunteerName)?.email || ''
      ).trim();
      if (!email) return;

      const prefs = getLinePreferences(email);
      const duties = getActiveDutyItems().filter(
        item => item.zoneId === shift.zone && item.triggerType !== 'specific_shift'
      );
      const zoneName = getZone(shift.zone)?.name || shift.zone;

      const lines = [
        `【浪浪家園】${volunteerName} 您好，簽到成功，感謝您今天來 🐾`,
        `班次：${shift.title}（${shift.date} ${shift.timeRange}・${zoneName}）`,
        ''
      ];

      if (duties.length === 0) {
        lines.push('今天這個場域沒有登記固定勤務，請依現場社工督導的安排進行。');
      } else {
        lines.push(`今日 ${zoneName} 的工作（共 ${duties.length} 項）：`);
        for (const duty of duties) {
          const when = duty.timeWindow ? `${duty.timeWindow} ` : '';
          lines.push(`・${when}${duty.title}${duty.isRequired ? '（必做）' : ''}`);
          // Only the duties that actually have material, and only if they want it.
          if (prefs.sopReminder && (duty.sopSectionId || duty.sopVideoId)) {
            lines.push('　↳ 這項有出勤前教材，請在系統的「今日勤務」點開「先看規範」');
          }
        }
        lines.push('');
        lines.push('完成後請到系統的「今日勤務」勾選核銷。現場如有臨時任務，以督導的安排為準。');
      }

      await notifyVolunteerDirect(email, lines.join('\n'));
    } catch (error: any) {
      console.warn('Arrival briefing failed:', error?.message || error);
    }
  }

  app.post('/api/attendance/check-in', requireAuth, (req: any, res) => {
    try {
      const { shiftId, siteCode, posterCode, lat, lng, onBehalfOfName } = req.body || {};
      const isAdmin = req.session.role === 'admin';

      if (!shiftId) {
        return res.status(400).json({ success: false, error: '缺少班次 ID' });
      }

      const shift = getAllShifts().find(sh => sh.id === shiftId);
      if (!shift) {
        return res.status(404).json({ success: false, error: '找不到該班次' });
      }

      // Who is checking in. A volunteer can only ever check themselves in --
      // the name comes from their session, never from the request body.
      let volunteerName: string;
      let volunteerEmail = '';
      if (isAdmin) {
        volunteerName = String(onBehalfOfName || '').trim();
        if (!volunteerName) {
          return res.status(400).json({ success: false, error: '代理簽到需指定志工姓名' });
        }
      } else {
        const me = getVolunteerByEmail(req.session.identity);
        if (!me) {
          return res.status(404).json({ success: false, error: '找不到您的志工資料，請重新登入' });
        }
        volunteerName = me.name;
        volunteerEmail = me.email;
      }

      if (getOpenAttendanceFor(volunteerName, shiftId)) {
        return res.status(409).json({ success: false, error: `【${volunteerName}】已在此班次簽到中，請勿重複簽到` });
      }

      // Everything below is skipped for a coordinator recording someone else's
      // arrival -- they're standing next to the person, and the record is
      // marked 'staff' so the difference is visible later.
      let verifiedDistance: number | undefined;
      let locationVerified = false;

      if (!isAdmin) {
        const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
        if (shift.date !== today) {
          return res.status(400).json({ success: false, error: `此班次日期為 ${shift.date}，只能在當天簽到` });
        }

        const shiftSignup = getAllShiftSignups().find(
          a => a.shiftId === shiftId &&
               a.status === 'approved' &&
               (a.volunteerEmail || '').toLowerCase() === volunteerEmail.toLowerCase()
        );
        if (!shiftSignup) {
          return res.status(403).json({ success: false, error: '您沒有這個班次的錄取名額，無法簽到' });
        }

        // Two ways in: the rotating code from a screen, or a scan of the
        // printed poster. Posters exist for sites with no screen at the gate.
        const viaPoster = !siteCode && isValidPosterToken(posterCode);
        if (!viaPoster && !isValidSiteCode(siteCode)) {
          return res.status(403).json({
            success: false,
            error: posterCode
              ? '簽到連結無效，請重新掃描現場的簽到海報'
              : '現場簽到碼不正確或已過期，請重新查看櫃台螢幕上的 6 位數字'
          });
        }

        // A poster scan carries no proof of presence on its own, so location
        // is not optional there -- it is the only thing standing between a
        // real arrival and someone who was sent a photo of the poster.
        if (viaPoster && (typeof lat !== 'number' || typeof lng !== 'number')) {
          return res.status(403).json({
            success: false,
            error: '用海報 QR 簽到時必須開啟定位權限，請允許取得位置後再試一次'
          });
        }

        // GPS is the second proof. If the phone refused to give it we still
        // accept the code, but flag the record so a coordinator can review.
        if (typeof lat === 'number' && typeof lng === 'number') {
          const shelter = getShelterLocation();
          verifiedDistance = distanceMeters(lat, lng, shelter.lat, shelter.lng);
          if (verifiedDistance > GEOFENCE_RADIUS_METERS) {
            return res.status(403).json({
              success: false,
              error: `簽到失敗：您目前距離【${shelter.name}】約 ${verifiedDistance} 公尺，超過 ${GEOFENCE_RADIUS_METERS} 公尺的打卡範圍`
            });
          }
          locationVerified = true;
        }
      }

      const now = new Date();
      const record = insertAttendanceRecord({
        id: `att-${now.getTime()}-${randomUUID().slice(0, 8)}`,
        volunteerName,
        lineId: undefined,
        shiftId: shift.id,
        shiftTitle: shift.title,
        zone: shift.zone as any,
        date: shift.date,
        checkInTime: now.toLocaleString('sv-SE', { timeZone: 'Asia/Taipei' }),
        // The same moment, unambiguously. The line above is what the screens
        // show; this is what can be compared or sent anywhere else.
        checkInAt: now.toISOString(),
        status: 'checked_in',
        locationVerified,
        distanceMeters: verifiedDistance,
        qrCodeToken: '',
        checkInMethod: isAdmin ? 'staff' : 'self'
      } as any);

      // What they came to do, sent the moment they arrive.
      //
      // Fire and forget: a volunteer standing at the gate must not wait on a
      // LINE round trip to be told their check-in worked. The work itself is
      // always included -- it is the reason they are here -- while the material
      // links are the part a preference can decline.
      void sendArrivalBriefing(shift, volunteerName);

      broadcastChange('attendance');
      return res.json({
        success: true,
        record,
        note: !isAdmin && !locationVerified
          ? '已用現場簽到碼完成簽到，但未取得 GPS 定位，這筆紀錄會標記為待督導確認'
          : undefined
      });
    } catch (error: any) {
      console.error('Check-In Error:', error);
      return res.status(500).json({ success: false, error: error.message || '儲存簽到紀錄失敗' });
    }
  });

  /**
   * Hours credited for a shift, read from its scheduled time range.
   *
   * This is the same rule the browser was applying -- a completed shift credits
   * the hours the shift was scheduled for, not the minutes actually spent on
   * site. Volunteer hours work that way by convention, and switching to elapsed
   * time would quietly dock anyone who signed out a few minutes early and make
   * every existing record inconsistent with every new one.
   *
   * What changes is only who applies it. The number used to arrive in the
   * request body, which meant it was whatever the caller said it was.
   */
  function scheduledHoursFor(timeRange: string): number | null {
    const match = String(timeRange || '').match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
    if (!match) return null;
    const [, startHour, startMinute, endHour, endMinute] = match.map(Number);
    const start = startHour * 60 + startMinute;
    let end = endHour * 60 + endMinute;
    if (end <= start) end += 24 * 60; // a shift that runs past midnight
    return Math.round(((end - start) / 60) * 10) / 10;
  }

  app.post('/api/attendance/:id/check-out', (req: any, res) => {
    try {
      const { id } = req.params;
      const { rating, feedbackComment, photoBase64, mimeType } = req.body;

      // You may only sign yourself out. This took nothing but a record id
      // before, so any caller could close out somebody else's shift, attach a
      // photo to it and file feedback in their name.
      const target = getAllAttendanceRecords().find(r => r.id === id);
      if (!target) {
        return res.status(404).json({ success: false, error: '找不到該筆出勤紀錄' });
      }
      if (!isAdmin(req)) {
        const me = getVolunteerByEmail(sessionEmail(req));
        if (!me || target.volunteerName !== me.name) {
          return res.status(403).json({ success: false, error: '只能為自己簽退。' });
        }
      }

      // When, and how many hours it counts for, are both decided here now.
      //
      // The time used to be whatever string the request carried, and the hours
      // whatever number came with it -- so both were assertions by the caller
      // about facts the server already knew. The clock is the server's, and the
      // hours come from the shift's own schedule.
      const now = new Date();
      const checkOutTime = now.toLocaleString('sv-SE', { timeZone: 'Asia/Taipei' });
      const checkOutAt = now.toISOString();

      const shift = getAllShifts().find(sh => sh.id === target.shiftId);
      const hoursLogged = (shift && scheduledHoursFor(shift.timeRange)) ?? 3;

      let photoUrl: string | undefined;
      if (photoBase64 && mimeType) {
        const ext = mimeType === 'image/png' ? 'png' : 'jpg';
        const filename = `${id}.${ext}`;
        writeFileSync(path.join(photosDir, filename), Buffer.from(photoBase64, 'base64'));
        photoUrl = `/photos/${filename}`;
      }

      const updated = updateAttendanceCheckout(id, {
        checkOutTime,
        checkOutAt,
        hoursLogged,
        rating,
        feedbackComment,
        feedbackSubmittedAt: new Date().toLocaleString('zh-TW', { hour12: false }),
        lineReminderSent: true,
        photoUrl
      });

      if (!updated) {
        return res.status(404).json({ success: false, error: '找不到該筆出勤紀錄' });
      }

      // Credit the hours here instead of trusting a separate call from the
      // browser to do it. This can only ever credit the volunteer whose record
      // was just closed, and the status guard means a retried or double-tapped
      // check-out doesn't count the same shift twice.
      if (target.status !== 'completed') {
        addCompletedShiftHours(updated.volunteerName, hoursLogged);
      }

      // Best-effort real LINE push thanking the volunteer and confirming their
      // feedback -- replaces the old simulated "SMS" notification. Fire-and-forget
      // (doesn't block the check-out response) and silently no-ops if this
      // volunteer hasn't completed real LINE Login yet, same fallback pattern as
      // /api/line/push.
      const lineToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
      const linkedLine = getLineUserIdByName(updated.volunteerName);
      if (lineToken && linkedLine) {
        const stars = '⭐'.repeat(Math.max(1, Math.min(5, rating || 5)));
        const pushText = `【浪浪家園】親愛的 ${updated.volunteerName} 您好，感謝您完成本次志工服務（${updated.shiftTitle}）！服務時數 ${hoursLogged} 小時，我們已收到您 ${stars} 的回饋，謝謝您的付出 🐾`;
        fetch('https://api.line.me/v2/bot/message/push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${lineToken}` },
          body: JSON.stringify({ to: linkedLine.lineUserId, messages: [{ type: 'text', text: pushText }] })
        }).catch(() => { /* best-effort, ignore failures */ });
      }

      broadcastChange('attendance');
      broadcastChange('volunteers'); // hours changed
      return res.json({ success: true, record: updated });
    } catch (error: any) {
      console.error('Check-Out Persist Error:', error);
      return res.status(500).json({ success: false, error: error.message || '儲存簽退紀錄失敗' });
    }
  });

  // Volunteer tier promotion requests -- a volunteer submits/refreshes a
  // pending request once their growth checklist hits 100%, an admin reviews
  // it from the roster page. Previously this was just a client-side toast
  // with nothing persisted anywhere an admin could see it.
  app.post('/api/promotions/request', (req: any, res) => {
    try {
      const { currentTier, requestedTier, completedItems } = req.body;
      // Who is asking for the promotion is the session, not the form. An admin
      // may still file one on someone's behalf.
      const me = isAdmin(req) ? null : getVolunteerByEmail(sessionEmail(req));
      const volunteerEmail = me ? me.email : String(req.body?.volunteerEmail || '');
      const volunteerName = me ? me.name : String(req.body?.volunteerName || '');
      if (!volunteerEmail || !volunteerName || !currentTier || !requestedTier) {
        return res.status(400).json({ success: false, error: '缺少晉升申請所需欄位' });
      }
      const request = upsertPendingPromotionRequest({
        volunteerEmail,
        volunteerName,
        currentTier,
        requestedTier,
        completedItems: Array.isArray(completedItems) ? completedItems : []
      });
      broadcastChange('promotions');
      return res.json({ success: true, request });
    } catch (error: any) {
      console.error('Promotion Request Error:', error);
      return res.status(500).json({ success: false, error: error.message || '提交晉升申請失敗' });
    }
  });

  app.get('/api/promotions', (req: any, res) => {
    try {
      // A volunteer only ever gets their own latest request -- the email in the
      // query string is ignored for them. Admins get the review queue.
      // (This used to broadcast a 'promotions' change on every read, which had
      // every connected client re-fetch, which broadcast again. Reads don't
      // announce changes.)
      if (!isAdmin(req)) {
        const request = getLatestPromotionRequestForVolunteer(sessionEmail(req));
        return res.json({ success: true, request });
      }
      const { volunteerEmail } = req.query;
      if (typeof volunteerEmail === 'string' && volunteerEmail) {
        return res.json({ success: true, request: getLatestPromotionRequestForVolunteer(volunteerEmail) });
      }
      return res.json({ success: true, requests: getAllPromotionRequests() });
    } catch (error: any) {
      console.error('Fetch Promotion Requests Error:', error);
      return res.status(500).json({ success: false, error: error.message || '讀取晉升申請失敗' });
    }
  });

  app.post('/api/promotions/:id/approve', requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const requests = getAllPromotionRequests();
      const target = requests.find(r => r.id === id);
      if (!target) {
        return res.status(404).json({ success: false, error: '找不到該筆晉升申請' });
      }

      const updated = reviewPromotionRequest(id, 'approved');
      updateVolunteerTier(target.volunteerEmail, target.requestedTier);

      const lineToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
      const linkedLine = getLineUserIdByName(target.volunteerName);
      if (lineToken && linkedLine) {
        const pushText = `【浪浪家園】恭喜 ${target.volunteerName}！您的志工等級已審核通過，正式晉升為「${target.requestedTier}」🎉 感謝您長期以來的付出與陪伴。`;
        fetch('https://api.line.me/v2/bot/message/push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${lineToken}` },
          body: JSON.stringify({ to: linkedLine.lineUserId, messages: [{ type: 'text', text: pushText }] })
        }).catch(() => { /* best-effort, ignore failures */ });
      }

      broadcastChange('promotions');
      broadcastChange('volunteers'); // tier may have changed
      return res.json({ success: true, request: updated });
    } catch (error: any) {
      console.error('Approve Promotion Error:', error);
      return res.status(500).json({ success: false, error: error.message || '審核通過失敗' });
    }
  });

  app.post('/api/promotions/:id/reject', requireAdmin, (req, res) => {
    try {
      const { id } = req.params;
      const { reviewNote } = req.body;
      const updated = reviewPromotionRequest(id, 'rejected', reviewNote);
      if (!updated) {
        return res.status(404).json({ success: false, error: '找不到該筆晉升申請' });
      }
      broadcastChange('promotions');
      broadcastChange('volunteers'); // tier may have changed
      return res.json({ success: true, request: updated });
    } catch (error: any) {
      console.error('Reject Promotion Error:', error);
      return res.status(500).json({ success: false, error: error.message || '駁回失敗' });
    }
  });

  // Shift templates ("班次" cards) -- read by the create-shift form's "套用過去
  // 班次範本" dropdown, and kept up to date by /api/shift-templates/sync,
  // which App.tsx calls (fire-and-forget) right after every shift publish.
  app.get('/api/shift-templates', requireAdmin, (req, res) => {
    try {
      return res.json({ success: true, templates: getAllShiftTemplates() });
    } catch (error: any) {
      console.error('Fetch Shift Templates Error:', error);
      return res.status(500).json({ success: false, error: error.message || '讀取班次範本失敗' });
    }
  });

  app.post('/api/shift-templates/sync', requireAdmin, (req, res) => {
    try {
      const { title, zone, timeRange, requiredCount, skillRequired, description, tasks, locationDetails, attachmentUrl } = req.body;
      if (!title || !zone || !timeRange || !requiredCount || !skillRequired) {
        return res.status(400).json({ success: false, error: '缺少班次範本所需欄位' });
      }
      const template = upsertShiftTemplate({
        title, zone, timeRange,
        requiredCount: Number(requiredCount),
        skillRequired, description: description || '',
        tasks: Array.isArray(tasks) ? tasks : [],
        locationDetails: locationDetails || '',
        attachmentUrl: attachmentUrl || undefined
      });
      return res.json({ success: true, template });
    } catch (error: any) {
      console.error('Sync Shift Template Error:', error);
      return res.status(500).json({ success: false, error: error.message || '同步班次範本失敗' });
    }
  });

  app.delete('/api/admin/shift-templates/:id', (req, res) => {
    try {
      deleteShiftTemplate(req.params.id);
      return res.json({ success: true });
    } catch (error: any) {
      console.error('Delete Shift Template Error:', error);
      return res.status(500).json({ success: false, error: error.message || '刪除班次範本失敗' });
    }
  });

  // API endpoint: Fetch the signed-in Google account's basic profile (name, email)
  app.post('/api/auth/google-userinfo', async (req, res) => {
    try {
      const { accessToken } = req.body;
      if (!accessToken) {
        return res.status(400).json({ success: false, error: '缺少 Google 存取權杖' });
      }

      // Same verification the sign-in below uses, audience check included --
      // this answer says whether an address is already registered here, so it
      // should only ever be given to the person who holds that Google account.
      const profile = await verifyGoogleAccessToken(String(accessToken));
      if (!profile) {
        return res.status(401).json({ success: false, error: 'Google 授權驗證失敗，請重新登入' });
      }

      const email = profile.email;
      const existing = getVolunteerByEmail(email);

      return res.json({
        success: true,
        name: profile.name || '',
        email,
        existingPhone: existing?.phone || null,
        existingTier: existing?.tier || null,
        existingTotalHours: existing?.totalHours ?? null
      });
    } catch (error: any) {
      console.error('Google userinfo Error:', error?.message || error);
      return res.status(500).json({ success: false, error: error?.message || '查詢 Google 帳號資料失敗' });
    }
  });

  // API endpoint: Real LINE push via the Messaging API. Falls back to a no-op success
  // (matching the Gemini fallback pattern above) until LINE_CHANNEL_ACCESS_TOKEN is set.
  // Accepts either a raw LINE `to` userId, or an `email` — in which case the volunteer's
  // linked lineUserId (from real LINE Login) is looked up server-side.
  app.post('/api/line/push', async (req: any, res) => {
    try {
      const { message, notificationType } = req.body;

      // A volunteer can send to themselves and nobody else -- that is what the
      // "test this notification" button in their settings does. Admins address
      // anyone, which is how approval and reminder messages go out. Before
      // this, an unauthenticated caller could name any recipient and send
      // whatever they liked from the shelter's official account.
      const admin = isAdmin(req);
      const to = admin ? req.body?.to : undefined;
      const email = admin ? req.body?.email : sessionEmail(req);
      let recipient = to;

      // Enforce the volunteer's own notification preference (stored server-side —
      // see getLinePreferences) before ever attempting to send. This is the one place
      // every push call site funnels through, so it can't be bypassed by forgetting to
      // check on the frontend.
      if (email && notificationType) {
        const prefs = getLinePreferences(email);
        if (prefs[notificationType as keyof typeof prefs] === false) {
          return res.json({
            success: true,
            isFallback: true,
            note: `此志工已關閉「${notificationType}」類型的 LINE 通知偏好，依規定不發送`
          });
        }
      }

      if (!recipient && email) {
        const linked = getLineUserId(email);
        if (!linked) {
          return res.json({
            success: true,
            isFallback: true,
            note: '此志工尚未完成真實 LINE Login 連結，這是模擬回應'
          });
        }
        recipient = linked.lineUserId;
      }

      if (!recipient || !message) {
        return res.status(400).json({ success: false, error: '缺少收件人 LINE userId/email 或訊息內容' });
      }

      const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
      if (!token) {
        return res.json({
          success: true,
          isFallback: true,
          note: 'LINE_CHANNEL_ACCESS_TOKEN 尚未設定，這是模擬回應，尚未真正發送 LINE 訊息'
        });
      }

      const lineRes = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ to: recipient, messages: [{ type: 'text', text: message }] })
      });

      if (!lineRes.ok) {
        const errText = await lineRes.text();
        return res.status(lineRes.status).json({ success: false, error: `LINE API 錯誤: ${errText}` });
      }

      return res.json({ success: true });
    } catch (error: any) {
      console.error('LINE Push Error:', error);
      return res.status(500).json({ success: false, error: error.message || 'LINE 推播失敗' });
    }
  });

  // API endpoint: Real LINE broadcast — sends to every friend of the official account.
  // No per-user LINE userId needed, so this works today without LINE Login.
  app.post('/api/line/broadcast', requireAdmin, async (req, res) => {
    try {
      const { message } = req.body;
      if (!message || !message.trim()) {
        return res.status(400).json({ success: false, error: '缺少訊息內容' });
      }

      const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
      if (!token) {
        return res.json({
          success: true,
          isFallback: true,
          note: 'LINE_CHANNEL_ACCESS_TOKEN 尚未設定，這是模擬回應，尚未真正發送 LINE 廣播'
        });
      }

      const lineRes = await fetch('https://api.line.me/v2/bot/message/broadcast', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ messages: [{ type: 'text', text: message }] })
      });

      if (!lineRes.ok) {
        const errText = await lineRes.text();
        return res.status(lineRes.status).json({ success: false, error: `LINE API 錯誤: ${errText}` });
      }

      return res.json({ success: true });
    } catch (error: any) {
      console.error('LINE Broadcast Error:', error);
      return res.status(500).json({ success: false, error: error.message || 'LINE 廣播發送失敗' });
    }
  });

  // API endpoint: LINE Messaging API webhook. Receives events (user messages, follows)
  // from the official account and auto-replies -- text questions are answered via the
  // same rulebook RAG logic as /api/ai/rag-ask, so "問手冊 AI 小幫手" also works as a
  // LINE chat, not just inside the web app. Register this exact URL as the channel's
  // Webhook URL in the LINE Developers Console (Messaging API channel, not LINE Login).
  app.post('/api/line/webhook', async (req, res) => {
    // LINE expects a fast 200 to consider the webhook healthy (its Console "Verify"
    // button sends a request with no events at all and just checks the status code).
    res.sendStatus(200);
    console.log('LINE Webhook: received', (req.body?.events || []).length, 'event(s)');

    const channelSecret = process.env.LINE_CHANNEL_SECRET;
    const signature = req.get('x-line-signature');
    if (channelSecret) {
      const rawBody: Buffer | undefined = (req as any).rawBody;
      const expected = createHmac('sha256', channelSecret).update(rawBody || Buffer.alloc(0)).digest('base64');
      const expectedBuf = Buffer.from(expected);
      const actualBuf = Buffer.from(String(signature || ''));
      const valid = expectedBuf.length === actualBuf.length && timingSafeEqual(expectedBuf, actualBuf);
      if (!valid) {
        console.warn('LINE Webhook: signature mismatch, ignoring event batch');
        return;
      }
    } else {
      console.warn('LINE_CHANNEL_SECRET 尚未設定，略過簽章驗證（僅建議本機測試時如此）');
    }

    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    const events = req.body?.events || [];

    for (const event of events) {
      try {
        if (event.type === 'follow') {
          await replyToLine(event.replyToken, '嗨，我是浪浪家園的志工小幫手 🐾 直接傳訊息問我志工手冊 / SOP 相關問題，我會幫你從手冊裡找答案！');
          continue;
        }
        if (event.type === 'message' && event.message?.type === 'text') {
          const result = await answerRulebookQuestion(event.message.text);
          await replyToLine(event.replyToken, result.answer);
        }
      } catch (error: any) {
        console.error('LINE Webhook Event Error:', error?.message || error);
      }
    }

    async function replyToLine(replyToken: string, text: string) {
      if (!token) {
        console.warn('LINE Webhook: LINE_CHANNEL_ACCESS_TOKEN not set, skipping reply');
        return;
      }
      if (!replyToken) return;
      const lineRes = await fetch('https://api.line.me/v2/bot/message/reply', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ replyToken, messages: [{ type: 'text', text: text.slice(0, 5000) }] })
      });
      if (lineRes.ok) {
        console.log('LINE Webhook: reply sent successfully');
      }
      if (!lineRes.ok) {
        console.error('LINE Reply API 錯誤:', await lineRes.text());
      }
    }
  });

  // API endpoint: LINE Login OAuth callback. Exchanges the authorization code for a
  // token, fetches the real LINE profile (userId), and links it to the volunteer
  // identified by the `state` param (their email). Redirects back into the SPA.
  // OAuth `state` must be an unguessable, single-use value -- it used to carry
  // the volunteer's email in plain text, which meant anyone could craft a LINE
  // Login URL with someone else's email as the state and bind their own LINE
  // account to that volunteer's record. That was already an impersonation risk
  // for push notifications; now that a bound LINE account can *sign in*, it
  // would have been full account takeover. States are issued here, are random,
  // expire quickly, and are consumed on first use.
  //
  // Held in memory rather than SQLite deliberately: they live for minutes, and
  // a server restart invalidating a half-finished login is the safe failure.
  interface PendingLineState { mode: 'bind' | 'login'; email?: string; expiresAt: number }
  const pendingLineStates = new Map<string, PendingLineState>();
  const LINE_STATE_TTL_MS = 10 * 60 * 1000;

  function issueLineState(payload: Omit<PendingLineState, 'expiresAt'>): string {
    // Opportunistic sweep so the map can't grow unbounded.
    const now = Date.now();
    for (const [key, value] of pendingLineStates) {
      if (value.expiresAt < now) pendingLineStates.delete(key);
    }
    const state = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
    pendingLineStates.set(state, { ...payload, expiresAt: now + LINE_STATE_TTL_MS });
    return state;
  }

  function consumeLineState(state: string): PendingLineState | null {
    const entry = pendingLineStates.get(state);
    if (!entry) return null;
    pendingLineStates.delete(state); // single use
    if (entry.expiresAt < Date.now()) return null;
    return entry;
  }

  // One-time tickets that hand a completed LINE *login* back to the browser.
  // The callback is a redirect, and putting the volunteer's email/name straight
  // into the query string would leak personal data into history and logs, so the
  // redirect carries only an opaque ticket the client exchanges for the profile.
  interface LoginTicket { email: string; expiresAt: number }
  const loginTickets = new Map<string, LoginTicket>();
  const LOGIN_TICKET_TTL_MS = 2 * 60 * 1000;

  // Returns the LINE authorize URL for either binding (to a known volunteer) or
  // signing in. Building it server-side is what lets the state stay secret.
  app.post('/api/auth/line-login-url', (req, res) => {
    try {
      const { mode, email } = req.body || {};
      const channelId = process.env.LINE_LOGIN_CHANNEL_ID;
      const appUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;

      if (!channelId) {
        return res.status(503).json({ success: false, error: 'LINE Login 尚未設定（缺少 LINE_LOGIN_CHANNEL_ID）' });
      }
      if (mode !== 'bind' && mode !== 'login') {
        return res.status(400).json({ success: false, error: '未知的 LINE 授權模式' });
      }

      // Signing in with LINE has to work before there is a session, so this
      // endpoint stays reachable signed-out. Binding does not: it decides which
      // volunteer account a LINE userId will unlock from then on. Taking that
      // email from the request body let anyone bind their own LINE account to
      // someone else's volunteer record and then sign in as them.
      let normalizedEmail: string | undefined;
      if (mode === 'bind') {
        const session = (req as any).session;
        if (!session) {
          return res.status(401).json({ success: false, error: '綁定 LINE 需要先完成登入。' });
        }
        normalizedEmail = session.role === 'admin'
          ? String(email || '').toLowerCase().trim()
          : String(session.identity || '').toLowerCase().trim();
        if (!normalizedEmail) {
          return res.status(400).json({ success: false, error: '綁定 LINE 需要先完成 Google 登入' });
        }
      }

      const state = issueLineState({ mode, email: normalizedEmail });
      const params = new URLSearchParams({
        response_type: 'code',
        client_id: channelId,
        redirect_uri: `${appUrl}/api/auth/line-callback`,
        state,
        scope: 'profile openid'
      });

      return res.json({ success: true, url: `https://access.line.me/oauth2/v2.1/authorize?${params.toString()}` });
    } catch (error: any) {
      console.error('Issue LINE Login URL Error:', error);
      return res.status(500).json({ success: false, error: error.message || '無法產生 LINE 授權連結' });
    }
  });

  // Exchanges the one-time ticket from a LINE sign-in for the volunteer profile.
  app.post('/api/auth/line-session', (req, res) => {
    try {
      const ticket = String(req.body?.ticket || '');
      const entry = loginTickets.get(ticket);
      loginTickets.delete(ticket); // single use
      if (!entry || entry.expiresAt < Date.now()) {
        return res.status(401).json({ success: false, error: '登入憑證已失效，請重新以 LINE 登入' });
      }
      const volunteer = getVolunteerByEmail(entry.email);
      if (!volunteer) {
        return res.status(404).json({ success: false, error: '找不到對應的志工資料' });
      }
      const token = createSession('volunteer', volunteer.email, volunteer.name);
      return res.json({ success: true, token, volunteer });
    } catch (error: any) {
      console.error('LINE Session Exchange Error:', error);
      return res.status(500).json({ success: false, error: error.message || '登入失敗' });
    }
  });

  app.get('/api/auth/line-callback', async (req, res) => {
    const appUrl = process.env.APP_URL || 'http://localhost:3000';

    try {
      const code = String(req.query.code || '');
      const channelId = process.env.LINE_LOGIN_CHANNEL_ID;
      const channelSecret = process.env.LINE_LOGIN_CHANNEL_SECRET;

      if (req.query.error) {
        return res.redirect(`${appUrl}/?lineLinked=0&error=${encodeURIComponent(String(req.query.error))}`);
      }

      const stateEntry = consumeLineState(String(req.query.state || ''));
      if (!code || !stateEntry) {
        return res.redirect(`${appUrl}/?lineLinked=0&error=invalid_or_expired_state`);
      }
      const email = stateEntry.email || '';
      if (!channelId || !channelSecret) {
        return res.redirect(`${appUrl}/?lineLinked=0&error=line_login_not_configured`);
      }

      const redirectUri = `${appUrl}/api/auth/line-callback`;

      const tokenRes = await fetch('https://api.line.me/oauth2/v2.1/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          client_id: channelId,
          client_secret: channelSecret
        })
      });

      if (!tokenRes.ok) {
        const errText = await tokenRes.text();
        console.error('LINE token exchange failed:', errText);
        return res.redirect(`${appUrl}/?lineLinked=0&error=token_exchange_failed`);
      }

      const tokenData: any = await tokenRes.json();

      const profileRes = await fetch('https://api.line.me/v2/profile', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` }
      });

      if (!profileRes.ok) {
        return res.redirect(`${appUrl}/?lineLinked=0&error=profile_fetch_failed`);
      }

      const profile: any = await profileRes.json();

      if (stateEntry.mode === 'login') {
        // Signing in with LINE alone: the userId must already be bound to a
        // volunteer (which only happens during Google onboarding), otherwise
        // there's no verified identity behind it and we must not create one.
        const volunteer = getVolunteerByLineUserId(profile.userId);
        if (!volunteer) {
          return res.redirect(`${appUrl}/?lineLoggedIn=0&error=line_not_registered`);
        }
        const ticket = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
        loginTickets.set(ticket, { email: volunteer.email, expiresAt: Date.now() + LOGIN_TICKET_TTL_MS });
        return res.redirect(`${appUrl}/?lineLoggedIn=1&ticket=${ticket}`);
      }

      setLineUserId(email, profile.userId, profile.displayName || '');
      return res.redirect(`${appUrl}/?lineLinked=1&lineName=${encodeURIComponent(profile.displayName || '')}`);
    } catch (error: any) {
      console.error('LINE Login Callback Error:', error);
      return res.redirect(`${appUrl}/?lineLinked=0&error=${encodeURIComponent(error.message || 'unknown')}`);
    }
  });

  // API endpoint: check whether a volunteer has completed real LINE Login
  app.get('/api/volunteers/line-status', (req: any, res) => {
    try {
      const email = isAdmin(req) ? String(req.query.email || '') : sessionEmail(req);
      if (!email) {
        return res.status(400).json({ success: false, error: '缺少 email' });
      }
      const linked = getLineUserId(email);
      return res.json({ success: true, linked: !!linked, lineDisplayName: linked?.lineDisplayName || null });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error.message || '查詢失敗' });
    }
  });

  // Turns a typed address into real coordinates. Tries Google Maps Geocoding
  // first when GOOGLE_MAPS_API_KEY is set (best accuracy for Taiwanese street
  // addresses), and otherwise falls back to OpenStreetMap's Nominatim, which
  // needs no API key or billing account -- so address lookup genuinely works
  // out of the box instead of silently doing nothing.
  //
  // Nominatim's usage policy requires an identifying User-Agent and at most
  // 1 request/sec; both are satisfied here since this only runs when an admin
  // saves the shelter address (a rare, manual action).
  async function geocodeAddress(address: string): Promise<{ lat: number; lng: number; provider: 'google' | 'osm' } | null> {
    const mapsKey = process.env.GOOGLE_MAPS_API_KEY;

    if (mapsKey) {
      try {
        const geoRes = await fetch(
          `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${mapsKey}`
        );
        const geoData: any = await geoRes.json();
        const loc = geoData?.results?.[0]?.geometry?.location;
        if (geoData.status === 'OK' && loc) {
          return { lat: loc.lat, lng: loc.lng, provider: 'google' };
        }
        console.warn('Google Geocoding returned no result:', geoData.status, '-- falling back to OpenStreetMap');
      } catch (geoErr) {
        console.warn('Google Geocoding call failed, falling back to OpenStreetMap:', geoErr);
      }
    }

    // Nominatim's Taiwan coverage has road names ("安興路", "重慶南路一段")
    // but NOT house numbers or lane numbers -- "安興路88號" returns nothing
    // while "安興路" resolves fine. So drop the most specific parts step by
    // step until something matches, which still lands on the right street
    // (well inside the 500m check-in geofence) instead of failing outright.
    const candidates = Array.from(new Set([
      address.trim(),
      address.replace(/\d+\s*號.*$/, '').trim(),               // drop "88號" and any floor/room after it
      address.replace(/\d+\s*[巷弄].*$/, '').trim()            // drop "88巷12號" down to the road
    ].filter(Boolean)));

    for (let i = 0; i < candidates.length; i++) {
      const query = candidates[i];
      try {
        const osmRes = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`,
          { headers: { 'User-Agent': 'PawRescue-VolunteerSystem/1.0 (shelter address geocoding)' } }
        );
        const osmData: any = await osmRes.json();
        const hit = Array.isArray(osmData) ? osmData[0] : null;
        if (hit?.lat && hit?.lon) {
          if (query !== address.trim()) {
            console.log(`OpenStreetMap Geocoding matched at street level ("${query}") for: ${address}`);
          }
          // Nominatim returns lat/lon as strings
          return { lat: Number(hit.lat), lng: Number(hit.lon), provider: 'osm' };
        }
      } catch (osmErr) {
        console.warn('OpenStreetMap Geocoding call failed:', osmErr);
      }

      // Nominatim's usage policy caps callers at 1 request/sec.
      if (i < candidates.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1100));
      }
    }

    console.warn('OpenStreetMap Geocoding returned no result for:', address);
    return null;
  }

  // The shelter's single physical location (previously 3 fixed hardcoded
  // "branches" -- that whole architecture was removed since the org only
  // ever operates from one place). GET is public (volunteers need the
  // address/hours/map link); PUT is admin-only and re-geocodes the address
  // through geocodeAddress above.
  app.get('/api/shelter-location', (req, res) => {
    try {
      return res.json({ success: true, location: getShelterLocation() });
    } catch (error: any) {
      console.error('Fetch Shelter Location Error:', error);
      return res.status(500).json({ success: false, error: error.message || '讀取地點失敗' });
    }
  });

  // LINE official account shown in the UI for volunteers to add as a friend.
  // GET is public; PUT is admin-only. Same shape as shelter-location above.
  app.get('/api/line-official-account', (req, res) => {
    try {
      return res.json({ success: true, account: getLineOfficialAccount() });
    } catch (error: any) {
      console.error('Fetch LINE Official Account Error:', error);
      return res.status(500).json({ success: false, error: error.message || '讀取 LINE 官方帳號失敗' });
    }
  });

  app.put('/api/admin/line-official-account', (req, res) => {
    try {
      const basicId = String(req.body?.basicId || '').trim();
      const displayName = String(req.body?.displayName || '').trim();
      const avatarUrl = String(req.body?.avatarUrl || '').trim();
      if (!basicId || !displayName) {
        return res.status(400).json({ success: false, error: '缺少 LINE ID 或顯示名稱' });
      }
      if (!basicId.startsWith('@')) {
        return res.status(400).json({ success: false, error: 'LINE ID 需以 @ 開頭，例如 @233bvcuk' });
      }
      const updated = updateLineOfficialAccount({ basicId, displayName, avatarUrl });
      return res.json({ success: true, account: updated });
    } catch (error: any) {
      console.error('Update LINE Official Account Error:', error);
      return res.status(500).json({ success: false, error: error.message || '更新 LINE 官方帳號失敗' });
    }
  });

  app.put('/api/admin/shelter-location', async (req, res) => {
    try {
      const { name, address, openHours } = req.body;
      if (!name || !address || !openHours) {
        return res.status(400).json({ success: false, error: '缺少名稱、地址或開放時間' });
      }

      const geocoded = await geocodeAddress(address);

      const updated = updateShelterLocation({
        name, address, openHours,
        ...(geocoded
          ? {
              lat: geocoded.lat,
              lng: geocoded.lng,
              // Always a Google Maps link regardless of who resolved the
              // coordinates -- it's what volunteers tap for navigation.
              googleMapsUrl: `https://maps.google.com/?q=${geocoded.lat},${geocoded.lng}`,
              geocoded: true
            }
          : { geocoded: false })
      });

      return res.json({
        success: true,
        location: updated,
        note: geocoded
          ? (geocoded.provider === 'osm' && !process.env.GOOGLE_MAPS_API_KEY
              ? '已使用 OpenStreetMap 免費定位服務完成定位'
              : undefined)
          : '地址定位失敗，地圖座標維持原樣，請確認地址是否正確（建議填寫完整門牌，例如「新北市新店區安興路88號」）'
      });
    } catch (error: any) {
      console.error('Update Shelter Location Error:', error);
      return res.status(500).json({ success: false, error: error.message || '更新地點失敗' });
    }
  });

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Vite integration
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // ==========================================================================
  // Backups
  // --------------------------------------------------------------------------
  // data/volunteers.db has never had one. It holds every volunteer record,
  // every shift, every logged hour and the SOP corpus, on a single file on one
  // machine -- so the whole system is one bad disk away from starting over.
  // One snapshot at boot (so a fresh deploy has a floor immediately) and one a
  // day after that; backupDatabase keeps the newest 14 and drops the rest.
  // ==========================================================================
  const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
  const REMINDER_SWEEP_MS = 5 * 60 * 1000;

  function runBackup() {
    try {
      const { file, bytes } = backupDatabase();
      console.log(`DB backup written: ${path.basename(file)} (${Math.round(bytes / 1024)} KB)`);
    } catch (error: any) {
      // A failed backup must never take the server down with it.
      console.error('Database Backup Error:', error?.message || error);
    }
  }

  /**
   * Files away suspensions nobody attended to. Runs beside the backup because
   * it wants the same once-a-day cadence, and because a state change nobody
   * requested should be logged where someone will see it.
   */
  function runSuspensionSweep() {
    try {
      const { restored, filed } = sweepSuspensions();
      for (const person of restored) {
        console.log(`SQLite: ${person.name} 停權已滿 ${person.days} 天，自動恢復搶班權限`);
        // Being let back in is not much use to somebody who does not know it
        // happened -- they would go on believing they are still shut out.
        void notifyVolunteerDirect(
          person.email,
          `【浪浪家園】${person.name} 您好，您的停權已滿 ${SUSPENSION_DAYS} 天並自動解除，`
          + `現在可以重新報名班次了。缺席次數也已重新計算。期待再見到您 🐾`
        );
      }
      for (const person of filed) {
        console.log(`SQLite: ${person.name} 第二次停權後 ${person.days} 天未聯繫，轉為離退`);
        // Sent because it is still not too late: nothing has been deleted and a
        // coordinator can put them back the moment they hear from them.
        void notifyVolunteerDirect(
          person.email,
          `【浪浪家園】${person.name} 您好，因第二次停權後超過 ${APPEAL_WINDOW_DAYS} 天未與社工督導聯繫，`
          + `您的帳號已轉為離退狀態。您的服務時數與出勤紀錄都完整保留，`
          + `隨時與督導聯繫就可以恢復，我們仍然歡迎您回來 🐾`
        );
      }
    } catch (error: any) {
      console.error('Suspension Sweep Error:', error?.message || error);
    }
  }

  /**
   * Closes substitution requests for shifts that have already been and gone.
   *
   * An open request for last Tuesday is not a request, it is a record that
   * nobody came forward -- and left open it would keep offering volunteers a
   * shift they cannot take.
   */
  function runSubstitutionSweep() {
    try {
      const closed = expireStaleSubstitutions();
      if (closed > 0) {
        console.log(`SQLite: ${closed} 筆代班請求因班次已過期而關閉（無人接手）`);
      }
    } catch (error: any) {
      console.error('Substitution Sweep Error:', error?.message || error);
    }
  }

  /**
   * Sends the shift reminder the settings panel has been promising.
   *
   * Runs every few minutes rather than daily, because the lead times on offer
   * are as short as one hour -- a once-a-day pass would miss most of them.
   *
   * Three things this deliberately does:
   *
   * It honours the volunteer's preference. Unlike a suspension notice, a
   * reminder is exactly the kind of message somebody may reasonably not want,
   * and the switch to decline it already exists.
   *
   * It records a send only after LINE accepted it. Recording first would mean a
   * push that failed is never retried; recording after means a transient
   * failure is picked up on the next tick, and the window closes by itself once
   * the shift starts.
   *
   * It skips volunteers with no LINE binding rather than marking them done, so
   * somebody who links their account later still gets reminded.
   */
  async function runReminderSweep() {
    try {
      const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
      let sent = 0;
      for (const candidate of getReminderCandidates(today)) {
        const hours = hoursUntilShift(candidate.shiftId);
        if (hours === null || hours <= 0) continue;

        const prefs = getLinePreferences(candidate.volunteerEmail);
        if (!prefs.checkInReminder) continue;
        if (hours > prefs.reminderTimingHours) continue;

        const whenLeft = hours < 1
          ? `${Math.max(1, Math.round(hours * 60))} 分鐘`
          : `${Math.round(hours)} 小時`;
        const delivered = await notifyVolunteerDirect(
          candidate.volunteerEmail,
          `⏰【浪浪家園】${candidate.volunteerName} 您好，提醒您的志工班次即將開始：\n`
          + `${candidate.title}\n${candidate.date} ${candidate.timeRange}（約剩 ${whenLeft}）\n`
          + `抵達園區後請開啟「手機掃碼簽到」完成報到。路上小心，浪浪等你 🐾`
        );
        if (delivered) {
          markReminderSent(candidate.signupId);
          sent++;
        }
      }
      if (sent > 0) console.log(`LINE: 已送出 ${sent} 則出勤提醒`);
    } catch (error: any) {
      console.error('Reminder Sweep Error:', error?.message || error);
    }
  }

  runBackup();
  runSuspensionSweep();
  runSubstitutionSweep();
  void runReminderSweep();
  setInterval(runBackup, BACKUP_INTERVAL_MS).unref();
  setInterval(runSuspensionSweep, BACKUP_INTERVAL_MS).unref();
  setInterval(runSubstitutionSweep, BACKUP_INTERVAL_MS).unref();
  // Its own cadence: the shortest lead time on offer is one hour, so a daily
  // pass would deliver most reminders after the shift they were about.
  setInterval(() => void runReminderSweep(), REMINDER_SWEEP_MS).unref();

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🐾 Animal Shelter Volunteer HR Server running on http://localhost:${PORT}`);
  });
}

startServer();
