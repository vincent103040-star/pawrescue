# 交接筆記(給接續開發用)

**最後更新:2026-08-29。**涵蓋到 commit `c2160b9`,共 134 次提交。

給接手這個對話/專案的人(不管是我自己新開一個對話,還是 Vincent 自己看):這份筆記讓你不用重新爬完整個對話紀錄也能快速搞懂現況。

## 這個專案是什麼
浪浪家園 PawRescue —— 流浪動物之家志工招募與排班管理系統。React 19 + Vite + Express + Tailwind + SQLite(`node:sqlite`)。原本是 Google AI Studio 匯出的純前端 mock 專案,這次 session 把它接成有真實第三方串接的完整全端應用。

## 已經做完、確認真的能動的功能
- **Google 登入**:真的 OAuth(Google Identity Services),`VITE_GOOGLE_CLIENT_ID` 設定在 `.env.local`。登入後手動輸入聯絡電話(嘗試過用 Google People API 自動抓已驗證電話,不可靠,已放棄改手動)。
- **志工資料持久化**:`db.ts` 用 Node 內建 `node:sqlite`(這台機器沒裝 Visual Studio Build Tools,不能編譯 better-sqlite3,所以改用零編譯的內建方案)。資料庫檔案 `data/volunteers.db`,重啟不會消失。
- **Google 日曆**:真的「加入行事曆」連結(`src/utils/googleCalendar.ts`,`calendar.google.com/render`),不需要 API 金鑰。接在報名審核、我的排班、搶班月曆等多處。
- **LINE Messaging API**:真的廣播(`/api/line/broadcast`)、真的個別推播(`/api/line/push`)。金鑰 `LINE_CHANNEL_ACCESS_TOKEN`。
- **LINE Login**:志工可以連結真實 LINE 帳號拿到 `lineUserId`(跟人工輸入的「LINE ID」是兩回事)。金鑰 `LINE_LOGIN_CHANNEL_ID` / `LINE_LOGIN_CHANNEL_SECRET`(在 LINE Developers 開一個獨立的 **LINE Login** 頻道,要跟 Messaging API 頻道**同一個 Provider**,userId 才會一致)。
- **LINE 通知偏好**:志工可以個別關閉「班次異動/緊急招募/簽到提醒」,**後端**(`/api/line/push` 裡)會真的檢查這個偏好,不會漏發。這個曾經是個 bug(偏好只存在志工瀏覽器 localStorage,管理端完全不知道),已修好。
- **登入頁改版**:情感故事型設計 —— 照片 Hero 橫幅、真實志工心得引用、「領養成功牆」(4 隻毛孩的送養故事,每隻都列出多位接力照顧的志工,不是只掛一個人名)、成功牆區塊有輕量滑鼠跟隨爪印效果(尊重 `prefers-reduced-motion`)。

## 環境變數(`.env.local`,不會被 git 追蹤)
```
GEMINI_API_KEY=            # 目前還是預留值,沒接真的 Gemini
APP_URL=http://localhost:3000
VITE_GOOGLE_CLIENT_ID=
LINE_CHANNEL_ACCESS_TOKEN=
LINE_LOGIN_CHANNEL_ID=
LINE_LOGIN_CHANNEL_SECRET=
VITE_LINE_LOGIN_CHANNEL_ID=
```
`.env.example` 裡有每個變數的申請說明。這些金鑰不在 git 裡,回到新電腦要手動補上(存在密碼管理器比較安全)。

## 授權基線(2026-08-24 這次 session 做的)
整合到 StrayHub CRM 之前的止血。重點是**預設拒絕**:`/api` 底下的每一個端點都需要 session,
除非列在 `server.ts` 的 `PUBLIC_ENDPOINTS` 白名單裡(健康檢查、SSE、收容所地點/LINE 官方帳號、
各個登入端點、LINE webhook)。新加的端點忘記保護時,結果是鎖住而不是敞開。

- **管理員密碼不再有預設值。**`0000` 已移除。伺服器第一次啟動會產生一組隨機密碼印在主控台,
  或用 `.env.local` 的 `ADMIN_PASSWORD` 指定(設了就每次啟動都以它為準)。既有資料庫若還是弱密碼會被強制輪替。
- **Google 登入現在真的驗證。**先前前端送 `idToken: 'google-oauth-verified'` 這個字串加上 body 裡的 email,
  伺服器完全採信 —— 等於帶任何 email 都能拿到那個志工的 session。現在後端拿 access token 去 Google 驗,
  身分只從 Google 的回覆取,並檢查 `aud` 是不是本專案的 client_id。
- **擁有者檢查。**志工只能讀寫自己的資料:profile、profile-extras、line-status、簽退、晉升申請、
  LINE 綁定、LINE 測試推播。名冊、廣播、晉升審核、班次範本、時數調整都是管理員限定。
- **讀取範圍縮小。**`/api/applications` 與 `/api/attendance` 對志工只回自己的;過去是整包送出再由瀏覽器過濾。
- **時數改由後端計算。**簽退時後端從剛關閉的紀錄記帳(含重複簽退防呆),`/api/volunteers/log-hours` 改成管理員專用。
- **速率限制。**`/api/ai/*` 每分鐘 20 次、admin-login 每 15 分鐘 10 次,in-memory 固定窗口,沒有新依賴。
- **SQLite WAL + 每日備份。**`data/backups/` 保留最近 14 份,用 `VACUUM INTO` 產生(可在服務執行中安全取得快照)。
  備份檔與 WAL sidecar 都已加進 `.gitignore` —— 那裡面是全體志工的個資。
- `PORT` 環境變數可覆寫 3000,方便另開一份測試而不影響正在跑的服務。

前端所有受保護的呼叫都改用 `authFetch`(`src/utils/session.ts`);公開的那幾支仍用一般 `fetch`。
App.tsx 的資料載入改成跟著 `userRole` 走,登入後才抓、換身分會重抓。

### 怎麼確認授權還沒被改壞
```bash
npm run check:security          # 針對 http://localhost:3000
BASE=http://localhost:3100 npm run check:security
```
`scripts/security-smoke.ts` 會逐一戳 76 個受保護端點(未帶 token 必須回 401)、11 個白名單端點
(必須維持可達,否則沒人能登入)、以及 2 種曾經有效的偽造登入,合計 89 項。全部是唯讀或注定被拒的請求,
用的都是不存在的 id,所以通過的話不會改到任何資料,失敗的話是指出漏洞而不是造成漏洞。

任何一項失敗就代表某條路由失去保護。它驗不到真實的 Google/LINE 登入、現場簽到與 LINE 推播 ——
那些只能真的走一次。

### 還沒補的洞
- `/photos`、`/avatars` 仍是公開靜態目錄,頭像檔名可從 email 推出來。要修得走簽名 URL,
  因為 `<img src>` 不會帶 Authorization header。
- 簽退時數雖然限制在 0–24 且由後端記帳,數值本身仍來自客戶端;要真正杜絕得從簽到/簽退時間戳計算,
  這牽涉到時區表示法的整理(見整合藍圖的 R6)。


## 2026-08-25 ～ 08-29 做了什麼

這幾天的量比前面全部加起來還多,分幾塊記。

### 資料模型:能算出來的就不要存
過去很多數字是存欄位再想辦法維護,結果就是遲早跟真相不一致。這幾天陸續改成讀取時計算:

- **班次已報名人數**不再是欄位,從報名紀錄現算(`HEADCOUNT_SQL`,排除 rejected/absent/cancelled/substituted)。
- **班次是否額滿**同理,不再存 `status='full'`;既有資料庫裡存過的 `full` 會在啟動時正規化掉。
- **勤務定義**與**完成紀錄**拆成兩張表 —— 之前混在一起,改一次勤務內容就會弄髒歷史。
- **場域**從編譯進程式改成資料庫可編輯(`zones`),前端十六個元件讀的是同一份 runtime 查表。
- **停權次數**從 `account_status_events` 事件表衍生,不存計數器。

### 排班
- **代班請求**(`substitution_requests`):志工臨時不能到就公開釋出,別人接下直接錄取。開班前 24 小時是界線,
  過了就不能自行取消,只能走代班。partial unique index 保證一筆報名同時只有一個未結案的代班請求。
- **整期自動產生班表**:照護量 × 班次範本 → 產草稿 → 人看過再發布(或整批丟棄)。
  草稿不會被志工看到,`POST /api/shift-signups` 也擋掉對草稿的報名。
- **需要幾個人是掃描線算的,不是把人數加起來**。早上九點的牽繩和下午兩點的清消不需要同一批人。
- **勤務可以指定星期幾**,時段從一個自由文字欄位拆成起訖兩欄(舊資料會在遷移時解析)。

### 出勤與紀律
- **點名**只回報「這些人沒有簽到紀錄」,不說「這些人缺席」。是不是缺席由社工按下確認。
- 缺席累計到門檻**自動停權**,滿 **30 天自動恢復**(督導也可以提前解除),恢復時**缺席次數歸零**。
- **第二次停權**:14 天內沒有向管理員申訴就轉為離退。申訴與狀態變更都記在 `account_status_events`。
- 簽到:GPS + 櫃台每 60 秒輪動的六位數碼;沒有螢幕的據點改用列印海報(`/?c=<token>`),
  這條路不用碼,改由伺服器核對座標 —— 海報的照片會轉傳,位置不會。

### 志工端(這一整塊之前幾乎是空的)
- **今日勤務看板**:只顯示自己今天班次所在場域的勤務,勾完社工端同步看到。
- **當天臨時任務**:綁定單一班次,那天過了自己消失,不需要有人回來停用。
- **勤務可以掛 SOP 章節與示範影片**,出勤前看;同一個 modal 管理端與志工端共用。
- **簽到後 LINE 推送當天工作內容**(必出現),SOP 提醒可個別關閉。
- **志工手冊**只顯示志工該看的部分,管理者章節不會露出。

### AI 與教材
- **RAG 問答**:手冊章節 / 上傳 PDF / 影片說明切段 → 產生向量存 `rag_chunks` → 問題取相似度前三段 →
  提示詞限制只能根據摘錄回答,並回傳出處。AI 不可用時退回關鍵字搜尋,不會靜默失敗。
  網頁與 LINE webhook 共用同一個 `answerRulebookQuestion`。
- **AI 狀態面板**,模型名稱可用環境變數設定(`GEMINI_TEXT_MODEL` / `GEMINI_EMBED_MODEL`)。
- **OCR 匯入腳本**(`npm run ocr:pdfs`):掃描型 PDF 送 Azure Document Intelligence 辨識再重建索引,
  引用標到**頁碼**而不是段號。Azure 只在這支腳本用到,**不在請求路徑上** —— 訂閱到期不影響任何線上功能。

### 修掉的 bug(每一個都值得記,因為都是會再犯的類型)
- **志工用 Google 登入拿到憑證卻沒存下來。**後端有發 token,前端只收下 profile 就丟掉,
  於是每個請求都被預設拒絕擋掉 → 載入函式「保留畫面上原有的內容」→ 而原有的內容是內建示範資料 →
  示範身分的電話 `0912-345-678` 剛好跟示範資料裡某位志工相同 → **志工看到陌生人的班表**。
  六個各自合理的決定串成一個資安問題。修法:憑證存下來、身分比對只認 email、個人清單一開始是空的。
- **服務時數重複計算。**伺服器在簽退時已經記帳,前端又把同一批出勤紀錄加了一次(44 小時 vs 真實 34)。
- **證書編造數字。**「實際班次數 + 8」、寫死的緊急聯絡人、**所有人共用的證書編號**
  (傳進去的 id 是字串 `'vol-my'`,數字濾光後落到預設值 `888`)、以及自動編出來的假 LINE 帳號。
- **報名成功訊息在請求送出前就跳出來。**而 HTTP 錯誤不會讓 `fetch` 進到 `.catch`,
  所以班次額滿或志工停權時,畫面照樣顯示「報名成功」。
- **PDF 匯出對所有人都壞著。**html2canvas 最後發布於 2022 年,看不懂 Tailwind v4 產生的 `oklab()` 色彩。
  換成 `html2canvas-pro`。第二層問題:它是把頁面複製到隱藏 iframe 再繪製,而複本要重新抓樣式表 ——
  抓完前就繪製會得到未套用 CSS 的結果。`onclone` 時把規則直接塞進去解決。
- **`parseWeekdays('')` 回傳 `[0]` 而不是 `[]`。**`''.split(',')` 是 `['']`,`Number('')` 是 `0`,
  而 `0` 是合法的星期日 —— 每個既有勤務都會變成只有星期日才做。
  **同一個錯誤在兩份重複的程式裡各犯了一次**,之後抽成 `src/utils/weekdays.ts`。

### 這幾天學到的事
- **同一段邏輯寫兩遍,就會有一天長得不一樣。**weekdays 解析、勤務教材 modal、PDF 擷取都是因此抽出去的。
- **沉默失敗最貴。**只寫 `console.error` 等於沒有處理 —— PDF 匯出壞了很久,表現出來只是「按鈕沒反應」。
- **絕對數字會騙人。**「88 MB 的 PDF 只擷取到 18,827 字」看起來像擷取不完整,
  除以 67 頁就知道每頁 290 字,本來就是完整的。那三份是內嵌照片的簡報,不是掃描件。
- **寫防護是在防未來的自己。**「辨識結果比現有索引短就不覆蓋」這條規則,實際擋下的是作者
  根據錯誤假設要做的破壞,而且如果沒擋,不會有任何症狀。

## 還沒做 / 已知限制
- LINE Broadcast 沒辦法依志工個人偏好過濾(LINE 廣播本來就是發給所有好友,沒有個別排除的概念,除非改用 multicast 精準名單)。
- `data/volunteers.db` 現在有本機每日快照(`data/backups/`),但仍沒有**異地**備份 —— 整台機器壞掉還是全沒了。
  這是目前最大的單點風險。
- **教學影片的內容沒有進問答索引**,只有標題和說明。要進去得先做語音轉文字。
- **「每月取消 3 次」的規則還沒實作。**取消已經改成軟性標記(`cancelled`)所以**算得出來**,但還沒有人去算它。
- **「多久沒聯絡算離開」還沒有答案。**這是收容所要決定的政策,不是程式問題。
- 部署在 GCP e2-micro(1 GB),**單機、沒有備援**。更新時中斷約一秒,機器故障就是全停。

## 怎麼跑起來
```bash
npm install
npm run dev   # http://localhost:3000
```

## Git 狀態
2026-08-18 第一個 commit `51996fd`,到 2026-08-29 共 **134 次提交**,已經推到 GitHub
(`github.com/vincent103040-star/pawrescue`)。

**每個決定的理由寫在 commit 訊息裡**,不是只寫「修 bug」。要理解某段程式為什麼長這樣,
`git log -p <檔案>` 比讀程式本身快。

部署流程(VM 上):
```bash
cd ~/pawrescue && git pull
npm install          # 只有依賴變更時才需要
npm run build
sudo systemctl restart pawrescue
```

**切過分支之後記得切回 main。**曾經因為停在一個已經被刪掉的遠端分支上,
`git pull` 只 fetch 不 merge,整次部署跑的還是舊程式碼 —— 建置輸出的檔案大小是最快的判斷依據。

## 動物狀態自動匯入(2026-08-31)

母系統 StrayHub 目前不開對外 API,所以動物狀態改用 email 傳送:對方每 6 小時
寄一封帶 CSV 附件的信到專用信箱,這邊定期收信、解析、寫進資料庫。

```
scripts/status-csv.ts        解析 CSV 與信件主旨(不碰網路,可單獨測)
scripts/status-mail.ts       IMAP 收信
scripts/status-ingest.ts     排程執行的那一支:收信 → 存檔 → 標示已讀
scripts/status-mail-check.ts 連線診斷,不寫入也不標示已讀,可重複跑
scripts/status-ingest-cron.sh cron 的包裝腳本
```

```bash
npm run check:status-csv    # 28 項
npm run check:status-mail   # 20 項
npm run check:status-db     # 20 項,每次建一個全新資料庫
npm run mail:check          # 連得上嗎?對方寄的格式對嗎?
npm run status:ingest -- --dry-run
```

`.env.local` 需要 `STATUS_MAIL_USER` 與 `STATUS_MAIL_APP_PASSWORD`
(Google 應用程式密碼,不是帳號密碼)。**`STATUS_MAIL_ALLOWED_SENDER` 應該要設**,
設了之後其他地址寄來的信不會被讀取內容;留空則任何人寄的 CSV 都會進來。

### 三個不能動的順序

- **先存檔,才標示已讀。**反過來的話,中間當掉就永遠失去那一批,而且失去得無聲無息
  —— 序號沒被記下來,連「掉了一批」都偵測不到。
- **永遠不刪信。**那封信是「對方到底寄了什麼」的唯一證據。
- **整批寫入或整批不寫。**批次那一列就是「#142 已經收到」的紀錄,只寫它而沒寫觀察
  資料,比整封信掉了更糟。

### 對照表是表,不是 AI

`status_duty_mappings` 存的是「這個狀態 = 這個勤務 = 幾分鐘」。**故意不用 AI 算。**
社工被告知星期二要多排四個人,有權問為什麼;來自表格的數字答得出來(哪個狀態、
哪個勤務、誰設定的),來自模型的數字答不出來,也改不了 —— 沒有東西可以編輯。

**這張表出廠是空的。**對方那 21 個觀察狀態目前只有「狗狗便便」是真的,其餘是佔位資料,
現在填分鐘數等於把猜測包裝成設定。`getUnmappedStatuses()` 會列出「真的被觀察到、
但還沒設規則」的狀態,由收容所自己填。**沒設規則的狀態算 0 分鐘工時** —— 這是對
「還沒有人回答的問題」的正確處理,但前提是那個問題持續被看見,所以每次執行都會列出來。

### 排程

VM 上 `crontab -e`,加這兩行(第一行不是註解,是必要的):

```
CRON_TZ=Asia/Taipei
15 0,6,12,18 * * * /home/使用者名稱/pawrescue/scripts/status-ingest-cron.sh
```

**`CRON_TZ` 不能省。**GCP VM 的時區是 UTC,少了它 `15 0` 會跑在台灣時間早上 8 點 15 分。

紀錄在 `data/logs/status-ingest.log`(超過 1 MB 會砍掉舊的一半)。這個目錄有進
`.gitignore` —— 裡面有寄件地址和動物資料。

### 還沒做

- **對照表沒有管理介面。**資料表和讀寫函式都有了,社工還不能自己編輯。
- **還沒接上排班產生器。**狀態存進來了,但還沒換算成人力缺口。
- **`STATUS_MAIL_ALLOWED_SENDER` 還沒設**,因為對方的寄件地址還沒確定。
- **對方的觀察狀態還沒真的產生。**所以這條管線的「語意層」兩邊都還沒辦法驗證 ——
  傳輸是通的,傳的內容還是假的。
