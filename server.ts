import express from 'express';
import path from 'path';
import { createHmac, timingSafeEqual, randomUUID } from 'crypto';
import { writeFileSync, mkdirSync, createWriteStream, statSync, readFileSync, unlinkSync } from 'fs';
import { gzipSync } from 'zlib';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import { getSession, createSession, destroySession, verifyAdminCredentials, changeAdminPassword, getAllShifts, insertShift, updateShift, deleteShift, adjustShiftCount, getAllApplications, insertApplication, updateApplicationStatus, deleteApplication, getAllVolunteers, getVolunteerByEmail, getVolunteerByLineUserId, updateVolunteerDetails, deleteVolunteer, upsertVolunteerFromLogin, updateVolunteerProfileExtras, addCompletedShiftHours, setLineUserId, getLineUserId, getLineUserIdByName, setLinePreferences, getLinePreferences, getAllAttendanceRecords, insertAttendanceRecord, updateAttendanceCheckout, getOpenAttendanceFor, getAppSecret, getSopContent, saveSopContent, getAllRagChunks, replaceRagChunks, deleteRagChunks, getAllSopDocuments, insertSopDocument, deleteSopDocument, backfillSopDocumentSizes, getSopDocumentText, getAllSopVideos, insertSopVideo, deleteSopVideo, getAllPromotionRequests, upsertPendingPromotionRequest, getLatestPromotionRequestForVolunteer, reviewPromotionRequest, updateVolunteerTier, getAllShiftTemplates, upsertShiftTemplate, deleteShiftTemplate, getShelterLocation, updateShelterLocation, getLineOfficialAccount, updateLineOfficialAccount } from './db';
import { PDFParse } from 'pdf-parse';
import type { SopContent, SopDocument, SopVideo } from './src/types';

// dotenv.config() alone only loads a file literally named ".env" — this project
// (like Vite) keeps secrets in ".env.local", so load that explicitly. ".env" is
// loaded first (if present) so ".env.local" still wins as the override, matching
// Vite's own precedence for the frontend VITE_* vars.
dotenv.config();
dotenv.config({ path: '.env.local', override: true });

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
  const PORT = 3000;

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

  app.use(attachSession);
  // Every current and future /api/admin/* route is covered by this one line,
  // rather than relying on each handler remembering to check.
  app.use('/api/admin', requireAdmin);

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
  type ChangeKind = 'attendance' | 'shifts' | 'applications' | 'volunteers' | 'promotions';
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
        model: 'gemini-3.6-flash',
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
        model: 'gemini-3.6-flash',
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
        model: 'gemini-3.6-flash',
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
        model: 'gemini-3.6-flash',
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
        model: 'gemini-3.6-flash',
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
        model: 'gemini-embedding-001',
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
        model: 'gemini-3.6-flash',
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
    if (!apiKey) return null;
    try {
      const ai = new GoogleGenAI({ apiKey, httpOptions: { headers: { 'User-Agent': 'aistudio-build' } } });
      const res = await ai.models.embedContent({ model: 'gemini-embedding-001', contents: text });
      return res.embeddings?.[0]?.values || null;
    } catch (error: any) {
      console.warn('Embed Text Error:', error?.message || error);
      return null;
    }
  }

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

  // API endpoint (admin only, enforced client-side by the tab it's wired into):
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

      for (const section of content.sections) {
        const text = `${section.title}\n${section.items.map(i => `${i.label}：${i.text}`).join('\n')}`;
        const embedding = await embedText(text);
        if (embedding) {
          replaceRagChunks('section', section.id, [{ title: section.title, text, embedding }]);
        }
        // If embedding fails (no API key / quota), the old vectors for this
        // section just stay as-is -- the displayed content still updates either way.
      }

      const emergencyText = `${content.emergencyTitle}\n${content.emergencyText}\n值班社工專線：${content.emergencyPhone}`;
      const emergencyEmbedding = await embedText(emergencyText);
      if (emergencyEmbedding) {
        replaceRagChunks('emergency', 'emergency-protocol', [{ title: content.emergencyTitle, text: emergencyText, embedding: emergencyEmbedding }]);
      }

      refreshRulebookEmbeddings();
      return res.json({ success: true, content: getSopContent() });
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
        model: 'gemini-3.6-flash',
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

  // API endpoint: Google login / self profile-edit upsert into the persistent SQLite volunteer DB
  app.post('/api/auth/google-phone-login', async (req, res) => {
    try {
      const { idToken, googleProfile, phoneNumber, lineId, linePreferences } = req.body;

      if (!idToken && !googleProfile) {
        return res.status(400).json({ success: false, error: '缺少 Google 憑證或個人資料' });
      }

      const email = (googleProfile?.email || '').toLowerCase().trim();
      const name = googleProfile?.name || '熱血志工';
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
          checkInReminder: !!linePreferences.checkInReminder
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
  // Shifts & applications -- the server is now the source of truth for both,
  // so a shift published on one device is immediately visible on every other.
  // ==========================================================================
  app.get('/api/shifts', (req, res) => {
    try {
      return res.json({ success: true, shifts: getAllShifts() });
    } catch (error: any) {
      console.error('Get Shifts Error:', error);
      return res.status(500).json({ success: false, error: error.message || '讀取班次失敗' });
    }
  });

  app.post('/api/shifts', requireAdmin, (req, res) => {
    try {
      const shift = req.body;
      if (!shift?.id || !shift?.title || !shift?.date) {
        return res.status(400).json({ success: false, error: '缺少班次必要欄位' });
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
      broadcastChange('applications'); // its applications went with it
      return res.json({ success: true });
    } catch (error: any) {
      console.error('Delete Shift Error:', error);
      return res.status(500).json({ success: false, error: error.message || '刪除班次失敗' });
    }
  });

  app.get('/api/applications', (req, res) => {
    try {
      return res.json({ success: true, applications: getAllApplications() });
    } catch (error: any) {
      console.error('Get Applications Error:', error);
      return res.status(500).json({ success: false, error: error.message || '讀取報名紀錄失敗' });
    }
  });

  // Applying both records the application and takes a seat on the shift, so the
  // two stay consistent even if two volunteers apply from different devices at
  // the same time -- the headcount is incremented server-side, not sent up by
  // whichever client happened to compute it last.
  app.post('/api/applications', requireAuth, (req, res) => {
    try {
      const application = req.body;
      if (!application?.id || !application?.shiftId || !application?.volunteerName) {
        return res.status(400).json({ success: false, error: '缺少報名必要欄位' });
      }

      // Who this booking belongs to comes from the session, never from the
      // form. It used to be whatever the sign-up field contained, which is how
      // bookings ended up owned by an address their owner couldn't match --
      // and therefore couldn't cancel. Admins may still file one for someone
      // else, since that's a real thing coordinators do over the phone.
      const owned = (req as any).session.role === 'volunteer'
        ? { ...application, volunteerEmail: (req as any).session.identity }
        : application;

      const saved = insertApplication(owned);
      const shift = adjustShiftCount(application.shiftId, 1);
      broadcastChange('applications');
      broadcastChange('shifts');
      return res.json({ success: true, application: saved, shift });
    } catch (error: any) {
      console.error('Create Application Error:', error);
      return res.status(500).json({ success: false, error: error.message || '送出報名失敗' });
    }
  });

  // Rejecting a previously-approved application frees the seat back up; the
  // client no longer has to work that out for itself.
  app.put('/api/applications/:id/status', requireAdmin, (req, res) => {
    try {
      const { status, reviewNotes } = req.body || {};
      if (!status) {
        return res.status(400).json({ success: false, error: '缺少審核狀態' });
      }

      const before = getAllApplications().find(a => a.id === req.params.id);
      if (!before) {
        return res.status(404).json({ success: false, error: '找不到該筆報名' });
      }

      const updated = updateApplicationStatus(req.params.id, status, reviewNotes);
      let shift = null;
      const wasHolding = before.status === 'pending' || before.status === 'approved';
      if (wasHolding && (status === 'rejected' || status === 'absent')) {
        shift = adjustShiftCount(before.shiftId, -1);
      }
      broadcastChange('applications');
      broadcastChange('shifts');
      return res.json({ success: true, application: updated, shift });
    } catch (error: any) {
      console.error('Update Application Status Error:', error);
      return res.status(500).json({ success: false, error: error.message || '更新報名狀態失敗' });
    }
  });

  app.delete('/api/applications/:id', requireAuth, (req: any, res) => {
    try {
      // A volunteer may cancel their own application; anything else is an
      // admin action. Without this check any signed-in volunteer could cancel
      // somebody else's shift just by knowing its id.
      const target = getAllApplications().find(a => a.id === req.params.id);
      if (!target) {
        return res.status(404).json({ success: false, error: '找不到該筆報名' });
      }
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

      const me = req.session.role === 'volunteer' ? getVolunteerByEmail(req.session.identity) : null;

      // Normally the email settles it. Bookings made before the server started
      // stamping the owner can have a blank email though, and refusing those
      // forever would leave volunteers unable to cancel their own shift -- so
      // fall back to name plus phone, which together are specific enough.
      const isOwner = req.session.role === 'volunteer' && (
        (target.volunteerEmail && norm(target.volunteerEmail) === norm(req.session.identity)) ||
        (!norm(target.volunteerEmail) && !!me &&
          norm(target.volunteerName) === norm(me.name) &&
          samePhone(target.volunteerPhone, me.phone))
      );

      if (req.session.role !== 'admin' && !isOwner) {
        return res.status(403).json({ success: false, error: '只能取消自己的報名。' });
      }

      const removed = deleteApplication(req.params.id);
      if (!removed) {
        return res.status(404).json({ success: false, error: '找不到該筆報名' });
      }
      const shift = adjustShiftCount(removed.shiftId, -1);
      broadcastChange('applications');
      broadcastChange('shifts');
      return res.json({ success: true, application: removed, shift });
    } catch (error: any) {
      console.error('Delete Application Error:', error);
      return res.status(500).json({ success: false, error: error.message || '取消報名失敗' });
    }
  });

  app.get('/api/volunteers', (req, res) => {
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
  app.get('/api/volunteers/profile', (req, res) => {
    try {
      const email = String(req.query.email || '');
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
  app.post('/api/volunteers/profile-extras', (req, res) => {
    try {
      const { email, emergencyContact, avatarBase64, avatarMimeType } = req.body;
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

  // API endpoint: increment a volunteer's hours/shift count after a check-out
  app.post('/api/volunteers/log-hours', (req, res) => {
    try {
      const { name, hoursLogged } = req.body;
      if (!name || typeof hoursLogged !== 'number') {
        return res.status(400).json({ success: false, error: '缺少志工姓名或服務時數' });
      }
      addCompletedShiftHours(name, hoursLogged);
      return res.json({ success: true });
    } catch (error: any) {
      console.error('Log Hours Error:', error);
      return res.status(500).json({ success: false, error: error.message || '更新服務時數失敗' });
    }
  });

  // API endpoint: attendance records — single source of truth (was localStorage-only
  // before, so different devices/browsers never saw each other's check-ins)
  app.get('/api/attendance', (req, res) => {
    try {
      return res.json({ success: true, records: getAllAttendanceRecords() });
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
  // be today and roughly now, you must have an approved application for it,
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

        const application = getAllApplications().find(
          a => a.shiftId === shiftId &&
               a.status === 'approved' &&
               (a.volunteerEmail || '').toLowerCase() === volunteerEmail.toLowerCase()
        );
        if (!application) {
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
        status: 'checked_in',
        locationVerified,
        distanceMeters: verifiedDistance,
        qrCodeToken: '',
        checkInMethod: isAdmin ? 'staff' : 'self'
      } as any);

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

  app.post('/api/attendance/:id/check-out', (req, res) => {
    try {
      const { id } = req.params;
      const { checkOutTime, hoursLogged, rating, feedbackComment, photoBase64, mimeType } = req.body;
      if (!checkOutTime || typeof hoursLogged !== 'number') {
        return res.status(400).json({ success: false, error: '缺少簽退時間或服務時數' });
      }

      let photoUrl: string | undefined;
      if (photoBase64 && mimeType) {
        const ext = mimeType === 'image/png' ? 'png' : 'jpg';
        const filename = `${id}.${ext}`;
        writeFileSync(path.join(photosDir, filename), Buffer.from(photoBase64, 'base64'));
        photoUrl = `/photos/${filename}`;
      }

      const updated = updateAttendanceCheckout(id, {
        checkOutTime,
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
  app.post('/api/promotions/request', (req, res) => {
    try {
      const { volunteerEmail, volunteerName, currentTier, requestedTier, completedItems } = req.body;
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

  app.get('/api/promotions', (req, res) => {
    try {
      const { volunteerEmail } = req.query;
      if (typeof volunteerEmail === 'string' && volunteerEmail) {
        const request = getLatestPromotionRequestForVolunteer(volunteerEmail);
        broadcastChange('promotions');
      return res.json({ success: true, request });
      }
      const requests = getAllPromotionRequests();
      return res.json({ success: true, requests });
    } catch (error: any) {
      console.error('Fetch Promotion Requests Error:', error);
      return res.status(500).json({ success: false, error: error.message || '讀取晉升申請失敗' });
    }
  });

  app.post('/api/promotions/:id/approve', async (req, res) => {
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

  app.post('/api/promotions/:id/reject', (req, res) => {
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
  app.get('/api/shift-templates', (req, res) => {
    try {
      return res.json({ success: true, templates: getAllShiftTemplates() });
    } catch (error: any) {
      console.error('Fetch Shift Templates Error:', error);
      return res.status(500).json({ success: false, error: error.message || '讀取班次範本失敗' });
    }
  });

  app.post('/api/shift-templates/sync', (req, res) => {
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

      const userinfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      if (!userinfoRes.ok) {
        const errText = await userinfoRes.text();
        return res.status(userinfoRes.status).json({ success: false, error: `Google userinfo 錯誤: ${errText}` });
      }

      const profile: any = await userinfoRes.json();
      const email = (profile.email || '').toLowerCase().trim();
      const existing = getVolunteerByEmail(email);

      return res.json({
        success: true,
        name: profile.name || '',
        email: profile.email || '',
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
  app.post('/api/line/push', async (req, res) => {
    try {
      const { to, email, message, notificationType } = req.body;
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
  app.post('/api/line/broadcast', async (req, res) => {
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
      const normalizedEmail = mode === 'bind' ? String(email || '').toLowerCase().trim() : undefined;
      if (mode === 'bind' && !normalizedEmail) {
        return res.status(400).json({ success: false, error: '綁定 LINE 需要先完成 Google 登入' });
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
  app.get('/api/volunteers/line-status', (req, res) => {
    try {
      const email = String(req.query.email || '');
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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🐾 Animal Shelter Volunteer HR Server running on http://localhost:${PORT}`);
  });
}

startServer();
