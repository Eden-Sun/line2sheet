import type { VercelRequest, VercelResponse } from "@vercel/node"
import { createHmac, timingSafeEqual } from "crypto"
import { google } from "googleapis"

// Disable Vercel's body parser — we need the raw body for LINE HMAC verification
export const config = {
  api: { bodyParser: false },
}

// ── Env ────────────────────────────────────────────────────────────────────

const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET!
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN ?? ""  // optional
const SPREADSHEET_ID = process.env.SPREADSHEET_ID!
const SHEET_NAME = process.env.SHEET_NAME ?? "Sheet1"
// On Vercel: paste the full service-account JSON content as this env var
const SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON

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

// ── Display name (no cache in serverless — stateless) ─────────────────────

async function getDisplayName(userId: string): Promise<string> {
  if (!CHANNEL_ACCESS_TOKEN) return userId  // skip if no token
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

// ── Google Sheets ──────────────────────────────────────────────────────────

async function appendRecord(
  date: string, time: string, sender: string, customer: string, price: number,
): Promise<void> {
  const authConfig = SERVICE_ACCOUNT_JSON
    ? { credentials: JSON.parse(SERVICE_ACCOUNT_JSON) }
    : { keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS }

  const auth = new google.auth.GoogleAuth({
    ...authConfig,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  })
  const sheets = google.sheets({ version: "v4", auth })
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:E`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[date, time, sender, customer, price]] },
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

  for (const event of events) {
    if (event.type !== "message" || event.message?.type !== "text") continue

    const record = parseDelivery(event.message.text)
    if (!record) {
      console.log(`⏭ 跳過：${event.message.text}`)
      continue
    }

    const ts = new Date(event.timestamp)
    const tpe = new Date(ts.getTime() + 8 * 3600_000)
    const date = tpe.toISOString().slice(0, 10)
    const time = tpe.toISOString().slice(11, 16)
    const sender = await getDisplayName(event.source.userId)

    try {
      await appendRecord(date, time, sender, record.customer, record.price)
      console.log(`✅ ${date} ${time} | ${sender} → ${record.customer} $${record.price}`)
    } catch (e) {
      console.error("Sheets error:", e)
    }
  }

  return res.status(200).send("OK")
}
