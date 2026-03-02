import type { VercelRequest, VercelResponse } from "@vercel/node"
import { google } from "googleapis"

const SPREADSHEET_ID = process.env.SPREADSHEET_ID
const SHEET_ROSTER = process.env.SHEET_ROSTER?.trim() || "名單"
const SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON

function buildSheets() {
  if (!SERVICE_ACCOUNT_JSON) {
    throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_JSON")
  }
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(SERVICE_ACCOUNT_JSON),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  })
  return google.sheets({ version: "v4", auth })
}

// 查詢 UID 對應的名稱
async function getNameByUid(userId: string): Promise<string | null> {
  if (!SPREADSHEET_ID) return null
  try {
    const sheets = buildSheets()
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_ROSTER}!A:B`,
    })
    const row = (res.data.values ?? []).find((r) => r[0]?.trim() === userId)
    return row?.[1]?.trim() || null
  } catch {
    return null
  }
}

// 新增 UID-名稱對應
async function addRosterEntry(userId: string, name: string): Promise<void> {
  if (!SPREADSHEET_ID) throw new Error("Missing SPREADSHEET_ID")
  const sheets = buildSheets()
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_ROSTER}!A:B`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[userId.trim(), name.trim()]] },
  })
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")
  
  if (req.method === "OPTIONS") return res.status(200).end()
  
  const userId = String(req.query.userId ?? "")
  if (!userId) return res.status(400).json({ error: "Missing userId" })

  // GET: 查詢名稱
  if (req.method === "GET") {
    const name = await getNameByUid(userId)
    return res.status(200).json({ userId, name, exists: Boolean(name) })
  }

  // POST: 新增對應
  if (req.method === "POST") {
    const { name } = req.body ?? {}
    if (!name?.trim()) return res.status(400).json({ error: "Missing name" })
    
    // 檢查是否已存在
    const existing = await getNameByUid(userId)
    if (existing) {
      return res.status(409).json({ error: "UserId already exists", name: existing })
    }

    try {
      await addRosterEntry(userId, name)
      console.log(`✅ [roster] Added: ${userId} -> ${name}`)
      return res.status(201).json({ userId, name: name.trim(), created: true })
    } catch (e: any) {
      console.error("[roster] add failed:", e?.message)
      return res.status(500).json({ error: "Failed to add roster entry" })
    }
  }

  return res.status(405).json({ error: "Method not allowed" })
}