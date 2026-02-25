# line2sheet

透過 LINE Bot Webhook 接收訊息，自動解析並記錄到 Google Sheet，追蹤每天送了多少錢的貨。

---

## 用途

LINE 群組（或個人）傳送出貨訊息時，系統自動：

1. 接收 LINE Webhook 通知
2. 解析訊息格式：`客戶名稱 金額`
3. 寫入 Google Sheet 一筆記錄

### 使用場景

每次出貨後，在 LINE 輸入：

```
某客戶 14600
```

Google Sheet 自動新增一行：

| 日期 | 時間 | 傳送者 | 客戶 | 金額 |
|------|------|--------|------|------|
| 2026-02-25 | 21:03 | Eden | 某客戶 | 14600 |

今天送出去的總金額一目了然。

---

## 訊息格式

```
<客戶名稱> <金額>
```

- 客戶名稱：任意文字（支援中文），不含空格
- 金額：整數，單位元
- 以**一個空格**分隔

### 範例

```
台北科技 14600
新竹客戶 8500
測試公司 120000
```

### 不符合格式的訊息

若訊息無法解析（格式不符、金額非數字），系統會：
- **不寫入** Google Sheet
- 在後台 log 記錄跳過原因

---

## Google Sheet 欄位

| 欄 | 欄位名稱 | 說明 | 範例 |
|----|----------|------|------|
| A | 日期 | YYYY-MM-DD | 2026-02-25 |
| B | 時間 | HH:mm | 21:03 |
| C | 傳送者 | LINE 顯示名稱（誰傳的） | Eden |
| D | 客戶 | 解析出的客戶名稱 | 某客戶 |
| E | 金額 | 解析出的金額（數字） | 14600 |

> **第一行建議設為標題列**（日期 / 時間 / 傳送者 / 客戶 / 金額），方便篩選與加總。

---

## 環境設定

### 1. 複製並填寫 .env

```bash
cp .env.example .env
```

編輯 `.env`：

```env
LINE_CHANNEL_SECRET=你的_channel_secret
LINE_CHANNEL_ACCESS_TOKEN=你的_channel_access_token
SPREADSHEET_ID=試算表網址中的那串 ID
SHEET_NAME=Sheet1
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json
PORT=3000
```

### 2. 放入 Google Service Account

從 [Google Cloud Console](https://console.cloud.google.com/) → IAM → Service Accounts → 建立 → 下載 JSON 金鑰

```bash
mv ~/Downloads/xxx.json /home/r7/line2sheet/service-account.json
```

把 service account 的 email 加入 Google Sheet **共用編輯者**。

### 3. LINE Developers 設定

前往 [LINE Developers](https://developers.line.biz) → Messaging API：
- 取得 **Channel Secret** 和 **Channel Access Token**
- Webhook URL 設定（見下一節）

---

## 部署到 Vercel（推薦）

### 1. 設定環境變數

在 Vercel Dashboard → Project → Settings → **Environment Variables** 新增：

| 變數名稱 | 說明 |
|----------|------|
| `LINE_CHANNEL_SECRET` | LINE Channel Secret |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE Channel Access Token |
| `SPREADSHEET_ID` | Google Sheet 網址的 ID |
| `SHEET_NAME` | 工作表名稱（預設 Sheet1） |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | service-account.json 的**完整 JSON 內容**（貼上整個 JSON 字串） |

> ⚠️ `GOOGLE_SERVICE_ACCOUNT_JSON` 是 JSON 字串，不是檔案路徑。打開 service-account.json，全選複製，直接貼到 Vercel env value 欄位。

### 2. 關閉 Deployment Protection

LINE webhook 需要公開存取，否則 Vercel SSO 會擋掉：

Vercel Dashboard → Project → **Settings → Deployment Protection**
→ 把保護設定改為 **"Only Preview Deployments"**（或直接關閉）

### 3. LINE Webhook URL

部署完成後，填入 LINE Developers 後台：

```
https://你的專案.vercel.app/api/webhook
```

> 注意是 `/api/webhook`，不是 `/webhook`。

---

## 本機開發（Bun + ngrok）

```bash
cd /home/r7/line2sheet
./start.sh
```

腳本會自動：
1. 啟動 Bun server（port 3000）
2. 啟動 ngrok（暴露公開 HTTPS URL）
3. 印出 Webhook URL → 填入 LINE Developers 後台

```
✅ 啟動完成！

📋 填入 LINE Developers 後台：
   Webhook URL: https://xxxx.ngrok-free.app/webhook
```

---

## 每日統計

在 Google Sheet 用 SUMIF 加總當天總金額：

```
=SUMIF(A:A, TEXT(TODAY(), "YYYY-MM-DD"), E:E)
```

或用 SUM + FILTER（新版 Sheets）：

```
=SUM(FILTER(E:E, A:A=TEXT(TODAY(), "YYYY-MM-DD")))
```

---

## 技術棧

- **Runtime**: Bun（TypeScript）
- **HTTP**: Bun.serve()
- **LINE**: Messaging API Webhook + HMAC-SHA256 驗簽
- **Google Sheets**: googleapis npm 套件 + Service Account 認證
- **隧道**: ngrok（本機開發用）
