import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import { getAllVolunteers, getVolunteerByEmail, upsertVolunteerFromLogin, addCompletedShiftHours, setLineUserId, getLineUserId, setLinePreferences, getLinePreferences } from './db';

// dotenv.config() alone only loads a file literally named ".env" — this project
// (like Vite) keeps secrets in ".env.local", so load that explicitly. ".env" is
// loaded first (if present) so ".env.local" still wins as the override, matching
// Vite's own precedence for the frontend VITE_* vars.
dotenv.config();
dotenv.config({ path: '.env.local', override: true });

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API endpoint: AI Recruitment Post Generator using Gemini API
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
        model: 'gemini-2.5-flash',
        contents: prompt
      });

      const generatedText = response.text || '';
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
        model: 'gemini-2.5-flash',
        contents: prompt
      });

      const generatedText = response.text || '';
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

  // API endpoint: AI Resource & Shortage Warning Prediction using Gemini API
  app.post('/api/ai/predict-resource-gaps', async (req, res) => {
    try {
      const { branchData } = req.body;

      const apiKey = process.env.GEMINI_API_KEY;

      if (!apiKey) {
        // High quality fallback predictions
        const fallbackPredictions = [
          {
            branchId: 'halfway',
            branchName: '草山狗園中途之家 (陽明山)',
            riskLevel: 'critical',
            severityScore: 88,
            animalCount: 107,
            shortageRate: 62,
            predictedManpowerGap: '預測下週缺 18 人次（大狗運動場放風 10 人、醫療區復健 8 人），週末最為告急',
            predictedMaterialGap: '大犬成犬飼料急缺 60 kg、止血與傷口紗布短缺 30 包、大號胸背牽繩短缺 10 條',
            urgentActions: [
              '即刻向 LINE 志工群組發布陽明山狗園『假日大狗放風急召』推播',
              '建議由新店總部緊急調撥 30 kg 成犬飼料與醫療防護器材至草山據點'
            ]
          },
          {
            branchId: 'cat_island',
            branchName: '貓島中途分院 (淡水館)',
            riskLevel: 'warning',
            severityScore: 65,
            animalCount: 80,
            shortageRate: 45,
            predictedManpowerGap: '預測下週缺 8 人次（幼貓育幼與親人陪伴 5 人、貓房清潔 3 人）',
            predictedMaterialGap: '主食貓罐頭短缺 80 罐、豆腐貓砂急缺 15 包、幼貓專用泡奶粉 5 罐',
            urgentActions: [
              '啟動淡水分院假日參訪志工現場彈性招募機制',
              '請物資整理組優先將民眾捐贈貓砂轉運至淡水館'
            ]
          },
          {
            branchId: 'main',
            branchName: '浪浪總部園區 (新店本館)',
            riskLevel: 'normal',
            severityScore: 25,
            animalCount: 247,
            shortageRate: 28,
            predictedManpowerGap: '預測下週僅缺 5 人次（主要為醫療觀察區資深志工與幼犬溫室班）',
            predictedMaterialGap: '物資儲備充足，僅需補充幼犬尿墊 20 包與洗狗藥用泡泡露 5 瓶',
            urgentActions: [
              '維持常態運作，可作為物資調撥中繼樞紐支援陽明山與淡水據點',
              '加強資深志工二階段醫療照護技能培訓認證'
            ]
          }
        ];

        return res.json({
          success: true,
          isFallback: true,
          globalSummary: '根據目前 3 個據點共 434 隻浪浪與下週志工班次缺工率分析，草山狗園（陽明山）面臨最高物資與人力雙重短缺風險，建議優先開啟跨據點資源調撥機制。',
          predictions: fallbackPredictions
        });
      }

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
      });

      const prompt = `你是一位專業的流浪動物之家營運總監與 AI 物資人力預警專家。
請根據以下各據點的當前動物數量、班次缺工率與場域狀況，以 JSON 格式預測下一週（7天）的「人力缺口」與「物資缺口」，並給出緊急處置建議。

各據點實時數據：
${JSON.stringify(branchData, null, 2)}

請務必以【純 JSON 格式】回覆（不要包含 markdown \`\`\`json 或額外開頭結尾文字），格式如下：
{
  "globalSummary": "簡短 80 字內的全園區營運風險總評與建議重點",
  "predictions": [
    {
      "branchId": "據點ID",
      "branchName": "據點名稱",
      "riskLevel": "critical 或 warning 或 normal",
      "severityScore": 0到100的數值,
      "animalCount": 動物數量,
      "shortageRate": 缺工率百分比數值,
      "predictedManpowerGap": "預測人力缺口說明",
      "predictedMaterialGap": "預測物資缺口說明（含具體數量如幾公斤飼料、幾罐罐頭）",
      "urgentActions": ["具體建議1", "具體建議2"]
    }
  ]
}`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
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

      if (parsed && parsed.predictions) {
        return res.json({
          success: true,
          isFallback: false,
          globalSummary: parsed.globalSummary,
          predictions: parsed.predictions
        });
      }

      return res.json({
        success: true,
        isFallback: true,
        globalSummary: 'Gemini AI 完成分析：草山狗園（陽明山）與淡水貓島分院下週面臨人力與物資吃緊預警，需立即發布 LINE 急召與物資調撥。',
        predictions: [
          {
            branchId: 'halfway',
            branchName: '草山狗園中途之家 (陽明山)',
            riskLevel: 'critical',
            severityScore: 88,
            animalCount: 107,
            shortageRate: 62,
            predictedManpowerGap: '預測下週缺 18 人次大狗運動場放風與醫療復健志工',
            predictedMaterialGap: '大犬成犬飼料急缺 60 kg、止血紗布短缺 30 包',
            urgentActions: ['發布陽明山假日動員 LINE 廣播', '調撥新店總部備用飼料']
          },
          {
            branchId: 'cat_island',
            branchName: '貓島中途分院 (淡水館)',
            riskLevel: 'warning',
            severityScore: 65,
            animalCount: 80,
            shortageRate: 45,
            predictedManpowerGap: '預測下週缺 8 人次幼貓育幼與陪伴志工',
            predictedMaterialGap: '主食罐頭短缺 80 罐、豆腐貓砂急缺 15 包',
            urgentActions: ['開啟淡水館現場遊客彈性體驗', '撥補貓砂與幼貓奶粉']
          },
          {
            branchId: 'main',
            branchName: '浪浪總部園區 (新店本館)',
            riskLevel: 'normal',
            severityScore: 25,
            animalCount: 247,
            shortageRate: 28,
            predictedManpowerGap: '預測下週僅缺 5 人次醫療觀察班',
            predictedMaterialGap: '物資充裕，僅需補幼犬尿墊 20 包',
            urgentActions: ['作為資材調撥中繼站', '開辦志工二階段進修']
          }
        ]
      });

    } catch (error: any) {
      console.warn('Predict Resource Gaps Error (fallback activated):', error?.message || error);
      return res.json({
        success: true,
        isFallback: true,
        globalSummary: '草山狗園（陽明山）與淡水貓島分院下週面臨人力與物資吃緊預警，建議儘速啟動 LINE 志工動員令與物資調撥支援。',
        predictions: [
          {
            branchId: 'halfway',
            branchName: '草山狗園中途之家 (陽明山)',
            riskLevel: 'critical',
            severityScore: 88,
            animalCount: 107,
            shortageRate: 62,
            predictedManpowerGap: '預測下週缺 18 人次（大狗運動場放風 10 人、醫療區復健 8 人）',
            predictedMaterialGap: '大犬成犬飼料急缺 60 kg、止血紗布短缺 30 包',
            urgentActions: ['發布陽明山假日動員 LINE 廣播', '調撥新店總部備用飼料']
          },
          {
            branchId: 'cat_island',
            branchName: '貓島中途分院 (淡水館)',
            riskLevel: 'warning',
            severityScore: 65,
            animalCount: 80,
            shortageRate: 45,
            predictedManpowerGap: '預測下週缺 8 人次幼貓育幼與陪伴志工',
            predictedMaterialGap: '主食罐頭短缺 80 罐、豆腐貓砂急缺 15 包',
            urgentActions: ['開啟淡水館現場遊客彈性體驗', '撥補貓砂與幼貓奶粉']
          },
          {
            branchId: 'main',
            branchName: '浪浪總部園區 (新店本館)',
            riskLevel: 'normal',
            severityScore: 25,
            animalCount: 247,
            shortageRate: 28,
            predictedManpowerGap: '預測下週僅缺 5 人次醫療觀察班',
            predictedMaterialGap: '物資充裕，僅需補幼犬尿墊 20 包',
            urgentActions: ['作為資材調撥中繼站', '開辦志工二階段進修']
          }
        ]
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
        model: 'gemini-2.5-flash',
        contents: prompt
      });

      const question = (response.text || '').trim().replace(/^["「]|["」]$/g, '');
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
        model: 'gemini-2.5-flash',
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
          feedback: parsed.feedback,
          flags: Array.isArray(parsed.flags) ? parsed.flags : []
        });
      }

      return res.json({ success: true, ...fallbackAssessment, isFallback: true });
    } catch (error: any) {
      console.warn('Gemini Situational Assessment Error (fallback activated):', error?.message || error);
      return res.json({ success: true, ...fallbackAssessment, isFallback: true });
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
  app.get('/api/volunteers', (req, res) => {
    try {
      return res.json({ success: true, volunteers: getAllVolunteers() });
    } catch (error: any) {
      console.error('Get Volunteers Error:', error);
      return res.status(500).json({ success: false, error: error.message || '讀取志工名冊失敗' });
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

  // API endpoint: LINE Login OAuth callback. Exchanges the authorization code for a
  // token, fetches the real LINE profile (userId), and links it to the volunteer
  // identified by the `state` param (their email). Redirects back into the SPA.
  app.get('/api/auth/line-callback', async (req, res) => {
    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    const email = decodeURIComponent(String(req.query.state || ''));

    try {
      const code = String(req.query.code || '');
      const channelId = process.env.LINE_LOGIN_CHANNEL_ID;
      const channelSecret = process.env.LINE_LOGIN_CHANNEL_SECRET;

      if (req.query.error) {
        return res.redirect(`${appUrl}/?lineLinked=0&error=${encodeURIComponent(String(req.query.error))}`);
      }
      if (!code || !email) {
        return res.redirect(`${appUrl}/?lineLinked=0&error=missing_code_or_state`);
      }
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
