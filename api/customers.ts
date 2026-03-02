import type { VercelRequest, VercelResponse } from "@vercel/node"
import { google } from "googleapis"

const SPREADSHEET_ID = process.env.SPREADSHEET_ID
const SHEET_CUSTOMERS = process.env.SHEET_CUSTOMERS?.trim() || "客戶"
const SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON

function buildSheets() {
  if (!SERVICE_ACCOUNT_JSON) {
    throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_JSON")
  }
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(SERVICE_ACCOUNT_JSON),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  })
  return google.sheets({ version: "v4", auth })
}

function normalizeCustomers(values: (string | null | undefined)[][]): string[] {
  const skip = /^(客戶|name|客戶名稱|客户)$/i
  const out: string[] = []
  const seen = new Set<string>()

  for (const row of values) {
    const name = String(row?.[0] ?? "").trim()
    if (!name || skip.test(name) || seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")

  if (req.method === "OPTIONS") return res.status(200).end()
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" })
  if (!SPREADSHEET_ID) return res.status(500).json({ error: "Missing SPREADSHEET_ID" })

  try {
    const sheets = buildSheets()
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_CUSTOMERS}!A:A`,
    })
    const customers = normalizeCustomers((result.data.values ?? []) as string[][])
    return res.status(200).json(customers)
  } catch (error: any) {
    console.error("[customers] fetch failed:", error?.message)
    return res.status(500).json({ error: "Failed to fetch customers" })
  }
}
