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

## 還沒做 / 已知限制
- `GEMINI_API_KEY` 沒接真的金鑰,AI 生成貼文/預測那些功能還是 fallback 範本文字。
- LINE Broadcast 沒辦法依志工個人偏好過濾(LINE 廣播本來就是發給所有好友,沒有個別排除的概念,除非改用 multicast 精準名單)。
- `data/volunteers.db` 是本機檔案,沒有雲端備份,重灌電腦前記得備份。

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
