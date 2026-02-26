import type { VercelRequest, VercelResponse } from "@vercel/node"
import { createHmac, timingSafeEqual } from "crypto"
import { google } from "googleapis"

// Disable Vercel's body parser — we need the raw body for LINE HMAC verification
export const config = {
  api: { bodyParser: false },
}

// ── Env ────────────────────────────────────────────────────────────────────

const CHANNEL_SECRET    = process.env.LINE_CHANNEL_SECRET!
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN ?? ""
const SPREADSHEET_ID    = process.env.SPREADSHEET_ID!
const SHEET_RAW         = process.env.SHEET_NAME        ?? "Sheet1"
const SHEET_CATEGORIZED = process.env.SHEET_CATEGORIZED ?? "分類紀錄"
const SHEET_ROSTER      = process.env.SHEET_ROSTER      ?? "名單"
const SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON

// ── Google Sheets ──────────────────────────────────────────────────────────

function buildSheets() {
  const authConfig = SERVICE_ACCOUNT_JSON
    ? { credentials: JSON.parse(SERVICE_ACCOUNT_JSON) }
    : { keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS }
  const auth = new google.auth.GoogleAuth({
    ...authConfig,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  })
  return google.sheets({ version: "v4", auth })
}

async function appendRow(
  sheets: ReturnType<typeof buildSheets>,
  sheet: string,
  row: (string | number)[],
) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheet}!A:E`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [row] },
  })
}

// ── Roster：UID → 暱稱 ─────────────────────────────────────────────────────

async function buildRoster(sheets: ReturnType<typeof buildSheets>): Promise<Map<string, string>> {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_ROSTER}!A:B`,
    })
    const map = new Map<string, string>()
    for (const row of res.data.values ?? []) {
      const uid  = (row[0] ?? "").trim()
      const name = (row[1] ?? "").trim()
      if (uid && name && !/^uid$/i.test(uid)) map.set(uid, name)
    }
    return map
  } catch {
    return new Map()
  }
}

// ── LINE helpers ───────────────────────────────────────────────────────────

function verifySignature(rawBody: string, sig: string): boolean {
  const expected = createHmac("sha256", CHANNEL_SECRET).update(rawBody).digest("base64")
  try { return timingSafeEqual(Buffer.from(expected), Buffer.from(sig)) } catch { return false }
}

async function getDisplayName(userId: string): Promise<string> {
  if (!CHANNEL_ACCESS_TOKEN) return userId
  try {
    const r = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
      headers: { Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}` },
    })
    if (!r.ok) return userId
    const { displayName } = await r.json() as { displayName?: string }
    return displayName ?? userId
  } catch { return userId }
}

// ── Message parser：「客戶 金額」 ──────────────────────────────────────────

function parseDelivery(text: string): { customer: string; price: number } | null {
  const t = text.trim()
  const i = t.lastIndexOf(" ")
  if (i === -1) return null
  const customer = t.slice(0, i).trim()
  const price = Number(t.slice(i + 1).trim().replace(/,/g, ""))
  if (!customer || !Number.isFinite(price) || price <= 0) return null
  return { customer, price }
}

// ── Raw body ───────────────────────────────────────────────────────────────

function readBody(req: VercelRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ""
    req.on("data", chunk => { data += chunk })
    req.on("end", () => resolve(data))
    req.on("error", reject)
  })
}

// ── LINE event types ───────────────────────────────────────────────────────

interface LineEvent {
  type: string
  timestamp: number
  replyToken: string
  source: { userId: string }
  message: { type: string; text: string }
}

// ── Handler ────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(404).send("Not Found")

  const rawBody  = await readBody(req)
  const sig      = (req.headers["x-line-signature"] as string) ?? ""
  if (!verifySignature(rawBody, sig)) return res.status(401).send("Unauthorized")

  let events: LineEvent[]
  try { events = JSON.parse(rawBody).events ?? [] }
  catch { return res.status(400).send("Bad Request") }

  const textEvents = events.filter(e => e.type === "message" && e.message?.type === "text")
  if (!textEvents.length) return res.status(200).send("OK")

  const sheets = buildSheets()
  const roster = await buildRoster(sheets)

  for (const event of textEvents) {
    const text   = event.message.text.trim()
    const record = parseDelivery(text)

    if (!record) { console.log(`⏭ 跳過：${text}`); continue }

    const now     = new Date(event.timestamp + 8 * 3600_000)
    const date    = now.toISOString().slice(0, 10)
    const time    = now.toISOString().slice(11, 16)
    const userId  = event.source.userId
    const display = await getDisplayName(userId)
    const nickname = roster.get(userId) ?? display

    try {
      await appendRow(sheets, SHEET_RAW, [date, time, userId, record.customer, record.price])
      await appendRow(sheets, SHEET_CATEGORIZED, [date, time, nickname, record.customer, record.price])
      console.log(`✅ [line] ${date} ${time} | ${nickname}(${userId}) → ${record.customer} $${record.price}`)
    } catch (e: any) {
      console.error("Sheets error:", e?.message)
    }
  }

  return res.status(200).send("OK")
}
