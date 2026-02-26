import type { VercelRequest, VercelResponse } from "@vercel/node"
import { createHmac, timingSafeEqual } from "crypto"
import { google } from "googleapis"

// Disable Vercel's body parser — we need the raw body for LINE HMAC verification
export const config = {
  api: { bodyParser: false },
}

// ── Env ────────────────────────────────────────────────────────────────────

const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET!
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN ?? ""
const SPREADSHEET_ID = process.env.SPREADSHEET_ID!

// Sheet names (configurable via env)
const SHEET_RAW        = process.env.SHEET_NAME        ?? "Sheet1"   // 原始紀錄（含 UID）
const SHEET_CATEGORIZED = process.env.SHEET_CATEGORIZED ?? "分類紀錄"  // 附暱稱的紀錄
const SHEET_ROSTER     = process.env.SHEET_ROSTER      ?? "名單"      // UID ↔ 暱稱對照表

const SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON

// ── Google Auth (built once per cold start) ────────────────────────────────

function buildSheetsClient() {
  const authConfig = SERVICE_ACCOUNT_JSON
    ? { credentials: JSON.parse(SERVICE_ACCOUNT_JSON) }
    : { keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS }

  const auth = new google.auth.GoogleAuth({
    ...authConfig,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  })
  return google.sheets({ version: "v4", auth })
}

// ── LINE signature ─────────────────────────────────────────────────────────

function verifySignature(rawBody: string, signature: string): boolean {
  const expected = createHmac("sha256", CHANNEL_SECRET)
    .update(rawBody)
    .digest("base64")
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
  } catch {
    return false
  }
}

// ── Display name from LINE API ─────────────────────────────────────────────

async function getDisplayName(userId: string): Promise<string> {
  if (!CHANNEL_ACCESS_TOKEN) return userId
  try {
    const res = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
      headers: { Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}` },
    })
    if (!res.ok) return userId
    const { displayName } = (await res.json()) as { displayName?: string }
    return displayName ?? userId
  } catch {
    return userId
  }
}

// ── 名單：UID → 暱稱對照 ───────────────────────────────────────────────────
// 名單 sheet 格式：A欄=UID, B欄=暱稱（第一行可為標題，自動跳過）

async function buildRosterMap(sheets: ReturnType<typeof buildSheetsClient>): Promise<Map<string, string>> {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_ROSTER}!A:B`,
    })
    const rows = res.data.values ?? []
    const map = new Map<string, string>()
    for (const row of rows) {
      const uid = (row[0] ?? "").trim()
      const nickname = (row[1] ?? "").trim()
      if (uid && nickname && !uid.startsWith("UID") && !uid.startsWith("uid")) {
        map.set(uid, nickname)
      }
    }
    return map
  } catch (e) {
    console.warn("⚠️ 無法讀取名單 sheet:", e)
    return new Map()
  }
}

// ── 訊息解析：「客戶名稱 金額」──────────────────────────────────────────────

interface DeliveryRecord {
  customer: string
  price: number
}

function parseDelivery(text: string): DeliveryRecord | null {
  const trimmed = text.trim()
  const lastSpace = trimmed.lastIndexOf(" ")
  if (lastSpace === -1) return null
  const customer = trimmed.slice(0, lastSpace).trim()
  const priceStr = trimmed.slice(lastSpace + 1).trim().replace(/,/g, "")
  const price = Number(priceStr)
  if (!customer || !Number.isFinite(price) || price <= 0) return null
  return { customer, price }
}

// ── 寫入 Google Sheets ─────────────────────────────────────────────────────

async function appendToSheet(
  sheets: ReturnType<typeof buildSheetsClient>,
  sheetName: string,
  row: (string | number)[],
): Promise<void> {
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A:E`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [row] },
  })
}

// ── LINE types ─────────────────────────────────────────────────────────────

interface LineEvent {
  type: string
  timestamp: number
  source: { userId: string }
  message: { type: string; text: string }
}

// ── Raw body reader ────────────────────────────────────────────────────────

function readRawBody(req: VercelRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ""
    req.on("data", chunk => { data += chunk })
    req.on("end", () => resolve(data))
    req.on("error", reject)
  })
}

// ── Handler ────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(404).send("Not Found")
  }

  const rawBody = await readRawBody(req)
  const signature = (req.headers["x-line-signature"] as string) ?? ""
  if (!verifySignature(rawBody, signature)) {
    return res.status(401).send("Unauthorized")
  }

  let events: LineEvent[]
  try {
    events = JSON.parse(rawBody).events ?? []
  } catch {
    return res.status(400).send("Bad Request")
  }

  // 過濾出有效的訊息事件
  const textEvents = events.filter(
    e => e.type === "message" && e.message?.type === "text"
  )
  if (textEvents.length === 0) return res.status(200).send("OK")

  // 建立 Sheets client & 讀取名單（一次 per request）
  const sheets = buildSheetsClient()
  const roster = await buildRosterMap(sheets)

  for (const event of textEvents) {
    const record = parseDelivery(event.message.text)
    if (!record) {
      console.log(`⏭ 跳過：${event.message.text}`)
      continue
    }

    const ts = new Date(event.timestamp)
    const tpe = new Date(ts.getTime() + 8 * 3600_000)
    const date = tpe.toISOString().slice(0, 10)   // YYYY-MM-DD
    const time = tpe.toISOString().slice(11, 16)  // HH:mm
    const userId = event.source.userId

    // LINE 顯示名稱（若有 token）
    const displayName = await getDisplayName(userId)
    // 暱稱（從名單 sheet 查詢；找不到就用 displayName）
    const nickname = roster.get(userId) ?? displayName

    try {
      // 1. 原始紀錄（Sheet1）：存 UID，方便對照
      await appendToSheet(sheets, SHEET_RAW, [date, time, userId, record.customer, record.price])

      // 2. 分類紀錄：存暱稱，方便閱讀
      await appendToSheet(sheets, SHEET_CATEGORIZED, [date, time, nickname, record.customer, record.price])

      console.log(`✅ ${date} ${time} | ${nickname}(${userId}) → ${record.customer} $${record.price}`)
    } catch (e) {
      console.error("Sheets error:", e)
    }
  }

  return res.status(200).send("OK")
}
