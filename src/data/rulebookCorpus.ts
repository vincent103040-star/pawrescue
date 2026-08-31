// Static corpus for the RAG rulebook Q&A feature. Extracted verbatim from the
// rulebook/SOP copy already shown in RulebookManualModal.tsx and
// VolunteerSopGuide.tsx, so the AI answers are grounded in the same rules
// volunteers already see in the app -- not invented content.
export interface RulebookChunk {
  id: string;
  title: string;
  text: string;
}

export const RULEBOOK_CORPUS: RulebookChunk[] = [
  {
    id: 'dress-and-access',
    title: '園區出入與防護紀律',
    text: '服務期間須穿著志工背心，進入狗園請穿長褲與不露趾平底運動鞋，嚴禁穿著拖鞋或高跟鞋。貓舍與犬舍均設有雙重隔絕門，進出必須貫徹「關一門、再開一門」原則，嚴防浪浪脫逃。帶大狗放風須使用「雙重安全扣環」與胸背牽繩，黃色/紅色標籤犬隻須由資深志工陪同。嚴禁未經社工或獸醫許可私自餵食非園區指定之零食，每 15 分鐘需為運動場犬隻補充乾淨飲水。'
  },
  {
    id: 'volunteer-tiers',
    title: '志工成長階級與考核升級制度',
    text: '實習志工（Novice）考核目標：完成 1 次園區實體培訓 + 完成 10 小時服務（配合資深志工）。正式志工（Regular）考核目標：累積 30 小時 + 獨立完成大狗放風與貓房照護 SOP 檢定。資深志工（Senior Leader）考核目標：累積 50 小時 + 通過急救與醫療投藥認證，系統將自動通知管理者審核。'
  },
  {
    id: 'leave-policy',
    title: '請假、代班與誠信管理規範',
    text: '若因故無法出席已報名之班次，請務必於班次開始 24 小時前於系統或 LINE 志工大群組發起「代班請求」。無故缺席（曠工）達 2 次者，系統將暫停該帳號未來 30 天之搶班權限，以保障浪浪照顧不中斷。'
  },
  // The entry that used to sit here described clicking「AI 一鍵補班」to have
  // Gemini "自動分析志工技能並直錄最佳人選". No button of that name exists, and
  // nothing fills a shift by itself. It also named three sites (新店總部、
  // 草山狗園、淡水貓島館) that are not this shelter's zones.
  //
  // A stale sentence in a manual is a stale sentence. The same sentence here is
  // the AI answering "how do I fill a shift?" with an invented button and a
  // citation for it, so it was worth getting exactly right rather than roughly
  // right: the recommendation and the direct enrolment are both real, and both
  // are one volunteer at a time, chosen by a person. Only the automation was
  // invented.
  {
    id: 'admin-shortage-dashboard',
    title: '（管理端）缺工統計看板與補人力的方式',
    text: '「缺工統計看板」顯示招募與排班指標、志工參與熱力圖、資源需求預警、每日勤務執行追蹤、月度報表匯出、志工回饋彙整與各場域即時排班卡片。班次缺人時，可在「職位與班次發布」對某一個班次開啟 AI 排班建議，系統會依技能、等級與服務時數排出推薦名單；管理者再逐一決定要發送 LINE 邀約，或直接錄取該名志工。沒有任何按鈕會自動把整個班次或整期班表補滿 —— 推薦是系統做的，決定是人做的，每一位都要管理者按一次。'
  },
  {
    id: 'admin-shift-publish',
    title: '（管理端）班次發布與 Google 地圖日曆同步',
    text: '在「職位與班次發布」建立新班次，系統會自動生成 Google Maps GPS 導航定位，並產出可一鍵加入 Google Calendar 的預約時間檔與 LINE 群組宣傳文案。'
  },
  {
    id: 'admin-talent-pool',
    title: '（管理端）志工人才庫與自動升級通知',
    text: '於「志工人才庫名冊」掌握全隊志工時數。當志工完成志工成長軌跡考核項目並達成門檻，系統將發送卡片通知管理員進行資深級別審核與證書頒發。'
  },
  {
    id: 'admin-forecast-sop',
    title: '（管理端）雙週物資人力 AI 預警地圖與 SOP 追蹤',
    text: '透過「資源需求預警地圖」預測下一週飼料與醫療器材缺口；使用「每日志工勤務看板」讓值班志工勾選完成 SOP，確保浪浪照顧品質。'
  },
  {
    id: 'volunteer-apply-portal',
    title: '（志工端）志工線上搶班門戶',
    text: '切換至「志工線上搶班門戶」，選擇意向院區與場域班次，填寫基本資料即可即時預約報名，並收到 LINE 自動確認通知。'
  },
  {
    id: 'volunteer-checkin',
    title: '（志工端）現場 QR Code 簽到與簽退打卡',
    text: '抵達園區後點擊「志工掃碼簽到」，輸入姓名選擇今日班次進行打卡；服務結束後填寫體驗評分並打卡簽退，時數自動累加。'
  },
  {
    id: 'volunteer-growth-cert',
    title: '（志工端）志工成長軌跡與數位服務證明',
    text: '於個人資料頁查看志工成長軌跡進度條，逐步打勾解鎖實習/正式/資深志工考核項目；時數符合條件可線上下載列印官方服務證明。'
  },
  {
    id: 'volunteer-daily-sop',
    title: '（志工端）勤務看板 SOP 現場執行打勾',
    text: '在首頁「每日志工勤務看板」查看當日值班 SOP（如給水、出犬檢查、貓房消毒），每完成一項點擊打勾核銷，系統同步紀錄。'
  },
  {
    id: 'sop-dog-walk',
    title: '大狗運動場與放風散步 SOP',
    text: '雙扣牽繩規範：胸背帶與項圈必須使用雙頭安全扣，出舍前確認鎖緊。防爆衝距離：放風時兩犬距離保持至少 3 公尺，嚴禁讓未社會化犬隻正面嗅聞接觸。高溫防燙爪：夏季地面超過 35°C 時縮短柏油路行走，改至遮蔭草坪。'
  },
  {
    id: 'sop-cat-room',
    title: '貓舍區清消與陪伴 SOP',
    text: '進出雙道門：進入貓舍必須「關一扇才能開下一扇」，嚴防貓咪奪門暴衝。分區清消不混用：隔離房抹布與拖把不得跨房使用，每次接觸後使用次氯酸消毒手部。安撫觀察情緒：若貓咪飛機耳或低吼，請暫停互動並通知資深隊長。'
  },
  {
    id: 'sop-puppy-nursery',
    title: '幼犬育幼與保暖 SOP',
    text: '泡奶溫度測試：代母乳泡製以 38°C 微溫為準，手背測試不燙方可餵食。定時排便刺激：餵食後使用微濕溫棉花輕柔刺激肛門與尿道排泄。保暖燈監測：確認保暖燈高度維持 45 公分，避免幼犬過熱或受寒。'
  },
  {
    id: 'emergency-protocol',
    title: '緊急事件處置與受傷第一道防線',
    text: '若不幸遭犬貓咬傷抓傷，請立即使用大量生理食鹽水沖洗 15 分鐘，並立即告知督導安排就醫破傷風評估。園區值班社工專線：(02) 2211-8899 #108。'
  }
];
