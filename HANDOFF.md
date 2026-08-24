# 交接筆記(給接續開發用)

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
`scripts/security-smoke.ts` 會逐一戳 46 個受保護端點(未帶 token 必須回 401)、11 個白名單端點
(必須維持可達,否則沒人能登入)、以及 2 種曾經有效的偽造登入。全部是唯讀或注定被拒的請求,
用的都是不存在的 id,所以通過的話不會改到任何資料,失敗的話是指出漏洞而不是造成漏洞。

任何一項失敗就代表某條路由失去保護。它驗不到真實的 Google/LINE 登入、現場簽到與 LINE 推播 ——
那些只能真的走一次。

### 還沒補的洞
- `/photos`、`/avatars` 仍是公開靜態目錄,頭像檔名可從 email 推出來。要修得走簽名 URL,
  因為 `<img src>` 不會帶 Authorization header。
- 簽退時數雖然限制在 0–24 且由後端記帳,數值本身仍來自客戶端;要真正杜絕得從簽到/簽退時間戳計算,
  這牽涉到時區表示法的整理(見整合藍圖的 R6)。

## 還沒做 / 已知限制
- `GEMINI_API_KEY` 沒接真的金鑰,AI 生成貼文/預測那些功能還是 fallback 範本文字。
- LINE Broadcast 沒辦法依志工個人偏好過濾(LINE 廣播本來就是發給所有好友,沒有個別排除的概念,除非改用 multicast 精準名單)。
- `data/volunteers.db` 現在有本機每日快照(`data/backups/`),但仍沒有**異地**備份 —— 整台機器壞掉還是全沒了。

## 怎麼跑起來
```bash
npm install
npm run dev   # http://localhost:3000
```

## Git 狀態
2026-08-18 建了第一個 commit `51996fd`。之後在新電腦上如果要推到 GitHub:
```bash
git remote add origin <你的 repo URL>
git branch -M main
git push -u origin main
```
