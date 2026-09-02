# 浪浪家園 PawRescue

流浪動物收容所的志工招募與排班管理系統。

社工要掌握全局 —— 今天誰有班、誰沒到、哪個場域缺人、時數怎麼認證。志工只想知道跟自己有關的事 —— 我什麼時候有班、今天要做什麼、這項工作的規範在哪。這套系統讓兩邊看同一份資料，但各自只看到該看的部分。

實際部署在 GCP 的 e2-micro（1 GB 記憶體）上，整個系統就一台機器、一個 Node 行程、一個檔案型資料庫。

---

## 功能

**志工端**

- 班次月曆與卡片清單，線上報名搶班
- 我的排班與出勤紀錄，可匯出服務證明 PDF
- 現場簽到：GPS 定位 + 櫃台輪動碼，或掃描列印的簽到海報
- 今日勤務清單，完成一項勾一項，社工端同步看到
- 代班請求：臨時無法出席時公開釋出，其他志工接手即錄取
- 規章與 SOP 問答，AI 只根據手冊內容回答並附上出處頁碼
- LINE 通知：出勤提醒、簽到後推送當天工作內容

**管理端**

- 報名審核、志工名冊、人才庫
- 每日勤務看板，含當天才發生的臨時任務
- 整期自動產生班表：照護量 × 班次範本，先產草稿、確認後才發布
- 缺工統計、出勤點名、服務回饋彙整
- 規章與 SOP 內容管理，儲存後自動重建問答索引
- 停權制度：缺席累計自動停權、30 天後恢復、二次停權有 14 天申訴期
- LINE 官方帳號廣播

---

## 技術架構

| 層 | 用什麼 | 為什麼 |
|---|---|---|
| 前端 | React 19 + Vite 6 + Tailwind 4 | — |
| 後端 | Express（TypeScript，用 esbuild 打包成單一 `dist/server.cjs`） | — |
| 資料庫 | Node 內建的 `node:sqlite`，WAL 模式 | 不需要額外行程或連線池；1 GB 的機器上省下的記憶體直接給網站服務 |
| 即時更新 | Server-Sent Events | 資料一變動就推給前端，不用輪詢 |
| AI 問答 | Google Gemini（向量 + 生成） | 同一組金鑰就能做兩件事 |
| 文件辨識 | Azure Document Intelligence | **只在手動執行匯入腳本時**用到，不在請求路徑上 |

1 GB 的記憶體限制形塑了不少決定：PDF 文字擷取設了大小上限（V8 的記憶體不足是攔不住的，會把整個伺服器帶走）、OCR 做成獨立腳本而不是 API 端點、向量比對在記憶體裡做而不裝向量資料庫。

### 幾條反覆出現的設計原則

- **衍生，而不是儲存** —— 能算出來的就不要存。班次已報名人數、是否額滿、缺席次數、停權次數都是從紀錄現算的。
- **停用，而不是刪除** —— 場域、勤務項目、志工帳號、取消的報名都只標記狀態，歷史紀錄才不會變成謊言。
- **回報，而不是推論** —— 點名表顯示「這些人沒有簽到紀錄」，而不是「這些人缺席」。判斷留給社工。
- **預設拒絕** —— `/api` 底下的每個端點都需要憑證，除非列在 `server.ts` 的 `PUBLIC_ENDPOINTS` 白名單。忘記保護新端點的後果是鎖住，不是敞開。
- **不編造數字** —— 沒有的資料就留白。服務證明書上曾經有「實際班次數 + 8」和所有人共用的證書編號。

---

## 執行

需要 Node.js 22 以上（`node:sqlite` 是內建模組）。

```bash
npm install
cp .env.example .env.local     # 再把金鑰填進去
npm run dev                    # http://localhost:3000
```

第一次啟動時，如果沒有設定 `ADMIN_PASSWORD`，伺服器會產生一組隨機管理員密碼印在主控台。

### 環境變數

都放在 `.env.local`（不會進 git）。`.env.example` 裡有每個變數的申請說明。

| 變數 | 用途 | 沒有會怎樣 |
|---|---|---|
| `ADMIN_PASSWORD` | 管理員登入密碼 | 每次啟動產生隨機密碼 |
| `GEMINI_API_KEY` | AI 問答的向量與生成 | 問答退回關鍵字搜尋 |
| `VITE_GOOGLE_CLIENT_ID` | 志工用 Google 登入 | 無法用 Google 登入 |
| `LINE_CHANNEL_ACCESS_TOKEN`<br>`LINE_CHANNEL_SECRET` | LINE 推播與 webhook | LINE 通知靜默略過 |
| `LINE_LOGIN_CHANNEL_ID`<br>`LINE_LOGIN_CHANNEL_SECRET`<br>`VITE_LINE_LOGIN_CHANNEL_ID` | LINE 登入與帳號綁定 | 無法用 LINE 登入 |
| `VITE_LIFF_ID` | 在 LINE 內開啟時的整合 | 一般瀏覽器行為 |
| `APP_URL` | 產生對外連結（簽到海報等）用 | 由請求推斷 |
| `AZURE_DOC_ENDPOINT`<br>`AZURE_DOC_KEY` | OCR 匯入腳本 | 只影響 `npm run ocr:pdfs` |

LINE Login 頻道要跟 Messaging API 頻道在**同一個 Provider** 底下，`userId` 才會一致。

---

## 部署

在機器上跑一次即可，之後每次更新重複後三步：

```bash
git pull
npm install          # 只有依賴變更時才需要
npm run build
sudo systemctl restart pawrescue
```

`npm run build` 會做兩件事：Vite 打包前端到 `dist/assets/`，esbuild 把後端打包成 `dist/server.cjs`。生產模式下 Express 直接服務 `dist/`。

---

## 備份

三層，每一層擋的是不同的失效方式。

**第一層：本機快照。**資料庫每次啟動、以及每天，都會自動備份到 `data/backups/`（用 `VACUUM INTO`，服務執行中取快照是安全的），保留最近 14 份。擋的是「改壞了想倒回去」。

**第二層：異地。**

```bash
BACKUP_BUCKET=gs://your-bucket npm run backup:offsite
npm run backup:offsite -- --dry-run     # 只做本地的部分，不碰網路
```

擋的是「快照跟正本一起沒了」——機器故障、誤刪整個目錄、或有人拿到這台機器。它上傳的是 `data/backups/` 裡最新的那一份，**不是** `data/volunteers.db`：那個檔案開著 WAL，跑著的時候直接複製會拿到不一致的快照，而壞掉的備份跟好的長得一模一樣。

資料庫和 manifest 每天各是一個新物件；頭像、照片、教材用 `rsync` 累積（只會新增，所以只傳新的）。manifest 記下雜湊和**每個資料表的筆數** —— 大小和雜湊只能證明檔案沒壞，證明不了裡面有東西。

**第三層：確認它還原得回來。**

```bash
BACKUP_BUCKET=gs://your-bucket npm run check:backup
npm run check:backup -- --local data/backups/volunteers-XXXX.db
```

擋的是最惡劣的那種：備份每天都成功，檔案每天都在，需要用的那天才發現它是空的、截斷的、或根本不是資料庫 —— 而中間那段時間，它看起來一直是好的。所以這支腳本問到底：雜湊對不對、`PRAGMA integrity_check` 過不過、資料表在不在、筆數跟 manifest 一不一樣、最後能不能真的讀出一筆志工資料。失敗回傳 1，可以直接掛在 cron 上。

**排程與權限。**兩支都放進 crontab（先備份，隔一段時間再驗證）：

```
30 3 * * *  cd ~/pawrescue && BACKUP_BUCKET=gs://your-bucket npm run backup:offsite
0  4 * * *  cd ~/pawrescue && BACKUP_BUCKET=gs://your-bucket npm run check:backup
```

VM 的服務帳號對備份 bucket 建議只給 `roles/storage.objectCreator` —— 能寫、不能讀、不能刪。備份最常見的失效方式不是沒備份，是跟正本一起被毀掉；這台機器萬一被入侵，歷史備份也拿不走、刪不掉。再開 Object Versioning 和 Lifecycle rule 控制成本。

`.env.local` **不要**放進同一個 bucket。弄丟它等於所有金鑰重新申請，但它外洩比資料庫外洩更糟 —— 有人能拿去冒用 LINE 官方帳號發訊息給全部志工。放 Secret Manager，或另一個權限更嚴的地方。

---

## 檢查

```bash
npm run lint                # TypeScript 型別檢查
npm run check:security      # 89 項授權檢查，需要伺服器在跑
npm run check:ocr-chunking  # 13 項 OCR 頁碼對照檢查
```

`check:security` 只發出唯讀、或本來就該被拒絕的請求，所以通過時不會改變任何資料，失敗時揭露一個漏洞而不是製造一個。每次部署前跑。

### OCR 匯入（選用）

掃描型 PDF 的文字擷取。Azure 只在這裡用到一次，跑完就結束 —— 網站與問答完全不依賴它。

```bash
npm run ocr:pdfs -- --dry-run   # 只辨識和報告，不寫入
npm run ocr:pdfs                # 正式匯入
```

匯入後要重啟服務，因為向量是開機時讀進記憶體的。

---

## 資料與隱私

`data/volunteers.db` 裡有志工的姓名、電話、電子郵件與緊急聯絡人。這個檔案、它的 WAL sidecar、以及 `data/backups/` 都在 `.gitignore` 裡。

匯出給外部系統的統計資料只給數字，不給名冊。

---

## 已知限制

- **備份與資料庫在同一顆磁碟。**機器毀損的話兩者一起消失，還沒有異地副本。
- **單機部署，沒有備援。**更新時服務會中斷約一秒；機器本身故障就是全停。
- **GPS 可以被偽造。**有螢幕的據點靠每 60 秒輪動的簽到碼補強，沒有螢幕的據點只能靠定位，這一塊較弱。
- **教學影片的內容沒有進問答索引**，只有標題和說明。
- **「每月取消三次」的規則還沒實作。**取消已改成軟性標記所以算得出來，但還沒有人去算它。

---

## 專案結構

```
server.ts                 Express API、排程、AI、LINE webhook（約 4,400 行）
db.ts                     SQLite 結構、遷移、查詢（約 3,500 行）
src/App.tsx               前端路由與資料載入
src/components/           39 個元件
src/utils/                session、時間、weekday 等共用邏輯
scripts/security-smoke.ts 授權檢查
scripts/ocr-import.ts     OCR 匯入
data/                     資料庫、上傳檔案、備份（不進 git）
```

開發歷程與每個決定的理由記在 commit 訊息裡（`git log`），接手開發前可以先看 [HANDOFF.md](HANDOFF.md)。
