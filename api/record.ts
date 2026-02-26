import type { VercelRequest, VercelResponse } from "@vercel/node"
import { google } from "googleapis"

const FORM_TOKEN       = process.env.FORM_TOKEN ?? ""
const SPREADSHEET_ID   = process.env.SPREADSHEET_ID!
const SHEET_RAW        = process.env.SHEET_NAME        ?? "Sheet1"
const SHEET_CATEGORIZED = process.env.SHEET_CATEGORIZED ?? "分類紀錄"
const SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")
  if (req.method === "OPTIONS") return res.status(200).end()
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" })

  const { token, sender, customer, amount } = req.body ?? {}

  if (FORM_TOKEN && token !== FORM_TOKEN)
    return res.status(401).json({ ok: false, error: "Unauthorized" })
  if (!customer?.trim() || !amount || isNaN(Number(amount)) || Number(amount) <= 0)
    return res.status(400).json({ ok: false, error: "Invalid input" })

  const now  = new Date(Date.now() + 8 * 3600_000)  // Taiwan time
  const date = now.toISOString().slice(0, 10)
  const time = now.toISOString().slice(11, 16)
  const name = (sender ?? "").trim() || "表單"
  const price = Number(amount)

  try {
    const sheets = buildSheets()
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_RAW}!A:E`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[date, time, `form:${name}`, customer.trim(), price]] },
    })
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_CATEGORIZED}!A:E`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[date, time, name, customer.trim(), price]] },
    })
    console.log(`✅ [form] ${date} ${time} | ${name} → ${customer} $${price}`)
    return res.status(200).json({ ok: true, date, time, name, customer: customer.trim(), amount: price })
  } catch (e: any) {
    console.error("record error:", e?.message)
    return res.status(500).json({ ok: false, error: e?.message })
  }
}
