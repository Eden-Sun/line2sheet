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

## Google Sheet 結構

系統使用三個分頁，只有 service account 可寫入，其他人設為「僅供檢視」即可。

### Sheet1（原始紀錄）

每筆訊息的完整記錄，**傳送者欄存 LINE userId**，方便對照名單。

| 欄 | 欄位名稱 | 說明 | 範例 |
|----|----------|------|------|
| A | 日期 | YYYY-MM-DD | 2026-02-25 |
| B | 時間 | HH:mm（台北時間） | 21:03 |
| C | 傳送者 | LINE userId（UID） | Uf1a2b3c4d5e6f... |
| D | 客戶 | 解析出的客戶名稱 | 某客戶 |
| E | 金額 | 解析出的金額（數字） | 14600 |

### 分類紀錄

同 Sheet1，但**傳送者欄顯示暱稱**（從名單對照）。方便日常閱讀與加總。

| 欄 | 說明 |
|----|------|
| A | 日期 |
| B | 時間 |
| C | 暱稱（從名單查出；找不到則顯示 LINE 顯示名稱） |
| D | 客戶 |
| E | 金額 |

### 名單（UID ↔ 暱稱對照）

手動維護。系統每次收到訊息時從這裡查出對應暱稱。

| 欄 | 說明 | 範例 |
|----|------|------|
| A | LINE userId（UID） | Uf1a2b3c4d5e6f7890abcdef |
| B | 暱稱 | Eden |

> 第一行可設標題列（UID / 暱稱），系統會自動跳過包含「uid」開頭的列。
>
> **取得自己的 UID：** 傳一條訊息給 bot，去 Sheet1 的 C 欄找那串 U 開頭的字串，貼到名單 A 欄即可。

---

> **第一行建議設為標題列**，方便篩選與加總。

---

## 環境設定

> 本機開發 和 Vercel 用不同的 Google 認證方式，**變數名稱不同，不要搞混**。

### 本機 `.env`（Bun 開發用）

```bash
cp .env.example .env
```

編輯 `.env`：

```env
# LINE（必填）
LINE_CHANNEL_SECRET=你的_channel_secret

# LINE（選填）— 沒填的話傳送者欄位會顯示 userId，而不是名稱
LINE_CHANNEL_ACCESS_TOKEN=你的_channel_access_token

# Google Sheet（必填）
SPREADSHEET_ID=試算表網址 /d/ 後面那串（例：1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms）
SHEET_NAME=Sheet1  # 選填，預設 Sheet1

# Google 認證（本機專用）— 指向本地 JSON 金鑰檔案路徑
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json

# 本機 port（選填，預設 3000）
PORT=3000
```

> ⚠️ `GOOGLE_APPLICATION_CREDENTIALS` 只用於本機，Vercel 上無效（沒有檔案系統）。

### 2. 建立 Google Service Account 並下載金鑰

Service Account 是讓程式代替「人」操作 Google API 的機器帳號，不需要瀏覽器登入。

#### 步驟一：建立 GCP 專案（已有可跳過）

1. 前往 [Google Cloud Console](https://console.cloud.google.com/)
2. 左上角點 **選取專案 → 新增專案**，輸入名稱後建立

#### 步驟二：啟用 Google Sheets API

1. 左側選單 → **API 和服務 → 程式庫**
2. 搜尋「Google Sheets API」→ 點進去 → **啟用**

#### 步驟三：建立 Service Account

1. 左側選單 → **IAM 與管理 → 服務帳號**
2. 上方點 **+ 建立服務帳號**
3. 填入名稱（例：`line2sheet`），點 **建立並繼續**
4. 角色選 **「編輯者」** 或跳過（這裡的角色是 GCP 內部權限，不影響 Sheet）
5. 點 **完成**

#### 步驟四：下載 JSON 金鑰

1. 在服務帳號清單找到剛建立的帳號，點右側 **⋮ → 管理金鑰**
2. **新增金鑰 → 建立新金鑰 → JSON** → 點 **建立**
3. 瀏覽器自動下載一個 `.json` 檔（例：`line2sheet-abc123.json`）

```bash
mv ~/Downloads/line2sheet-abc123.json /home/r7/line2sheet/service-account.json
```

JSON 內容長這樣（不要外洩）：

```json
{
  "type": "service_account",
  "project_id": "your-project-id",
  "private_key_id": "...",
  "private_key": "-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----\n",
  "client_email": "line2sheet@your-project-id.iam.gserviceaccount.com",
  "client_id": "...",
  ...
}
```

#### 步驟五：把 Service Account 加入 Google Sheet

> ⚠️ 這步最容易忘，忘了會寫入失敗（403 錯誤）

1. 打開你要寫入的 Google Sheet
2. 右上角點 **共用**
3. 在「新增對象」欄貼上 service-account.json 裡的 **`client_email`** 值
   （例：`line2sheet@your-project-id.iam.gserviceaccount.com`）
4. 權限選 **「編輯者」** → 點 **共用**

### 3. LINE Developers 設定

前往 [LINE Developers](https://developers.line.biz) → Messaging API：
- 取得 **Channel Secret** 和 **Channel Access Token**
- Webhook URL 設定（見下一節）

---

## 部署到 Vercel（推薦）

### 1. 設定環境變數

在 Vercel Dashboard → Project → Settings → **Environment Variables** 新增：

| 變數名稱 | 必填 | 說明 |
|----------|------|------|
| `LINE_CHANNEL_SECRET` | ✅ | LINE Channel Secret |
| `LINE_CHANNEL_ACCESS_TOKEN` | 選填 | LINE Channel Access Token；沒填的話傳送者欄位顯示 userId |
| `SPREADSHEET_ID` | ✅ | Google Sheet 網址的 ID（見下方說明） |
| `SHEET_NAME` | 選填 | 原始紀錄分頁名稱，預設 `Sheet1` |
| `SHEET_CATEGORIZED` | 選填 | 附暱稱分頁名稱，預設 `分類紀錄` |
| `SHEET_ROSTER` | 選填 | UID↔暱稱對照分頁名稱，預設 `名單` |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | ✅ | service-account.json 的**完整 JSON 內容**（貼上整個 JSON 字串） |

> ⚠️ Vercel 沒有檔案系統，**不能用** `GOOGLE_APPLICATION_CREDENTIALS`，改用 `GOOGLE_SERVICE_ACCOUNT_JSON`。

> ⚠️ **`GOOGLE_SERVICE_ACCOUNT_JSON` 填法**
>
> Vercel 上沒有檔案系統，不能放 `.json` 檔，改用環境變數傳入整個 JSON 內容：
>
> 1. 用文字編輯器打開 `service-account.json`
> 2. **全選（Ctrl+A）→ 複製（Ctrl+C）**
> 3. 貼到 Vercel 的 `GOOGLE_SERVICE_ACCOUNT_JSON` 欄位 value 裡
>
> 貼進去的值會是一大段 JSON，開頭像這樣：
> ```
> {"type":"service_account","project_id":"your-project",...}
> ```
> 不需要加引號或做任何修改，直接貼原始內容就好。

#### 如何取得 SPREADSHEET_ID

打開你的 Google Sheet，看網址列：

```
https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms/edit#gid=0
                                       ↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑
                                       這一段就是 SPREADSHEET_ID
```

`/d/` 後面、到 `/edit` 之前那一串就是 ID，複製貼上即可。

> ⚠️ 記得把 Service Account 的 email 加入 Google Sheet **共用編輯者**，否則會沒有寫入權限。

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
