import type { VercelRequest, VercelResponse } from "@vercel/node"
import { google } from "googleapis"

const FORM_TOKEN       = process.env.FORM_TOKEN ?? ""
const SPREADSHEET_ID   = process.env.SPREADSHEET_ID!
const SHEET_RAW        = process.env.SHEET_NAME        ?? "Sheet1"
const SHEET_CATEGORIZED = process.env.SHEET_CATEGORIZED ?? "分類紀錄"
const SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON

function escHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (char) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] || char
  ))
}

function wantsHtml(req: VercelRequest): boolean {
  const accept = String(req.headers.accept ?? "")
  const contentType = String(req.headers["content-type"] ?? "")
  return accept.includes("text/html") && !contentType.includes("application/json")
}

function normalizeBody(body: unknown): Record<string, unknown> {
  if (!body) return {}
  if (typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>
  if (typeof body !== "string") return {}

  try {
    const parsed = JSON.parse(body)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed
  } catch {}

  const params = new URLSearchParams(body)
  const out: Record<string, string> = {}
  for (const [key, value] of params.entries()) out[key] = value
  return out
}

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

  const body = normalizeBody(req.body)
  const token = String(body.token ?? "")
  const sender = String(body.sender ?? "")
  const customer = String(body.customer ?? "")
  const amount = body.amount
  const paymentStatus = String(body.paymentStatus ?? "")

  if (FORM_TOKEN && token !== FORM_TOKEN)
    return wantsHtml(req)
      ? res.status(401).setHeader("Content-Type", "text/html; charset=utf-8").send("<h1>Unauthorized</h1>")
      : res.status(401).json({ ok: false, error: "Unauthorized" })
  if (!customer?.trim() || !amount || isNaN(Number(amount)) || Number(amount) <= 0)
    return wantsHtml(req)
      ? res.status(400).setHeader("Content-Type", "text/html; charset=utf-8").send("<h1>Invalid input</h1>")
      : res.status(400).json({ ok: false, error: "Invalid input" })
  if (!paymentStatus || (paymentStatus !== "已收" && paymentStatus !== "未收"))
    return wantsHtml(req)
      ? res.status(400).setHeader("Content-Type", "text/html; charset=utf-8").send("<h1>請選擇收款狀態</h1>")
      : res.status(400).json({ ok: false, error: "請選擇收款狀態" })

  const now  = new Date(Date.now() + 8 * 3600_000)  // Taiwan time
  const date = now.toISOString().slice(0, 10)
  const time = now.toISOString().slice(11, 16)
  const name = (sender ?? "").trim() || "表單"
  const price = Number(amount)

  try {
    const sheets = buildSheets()
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_RAW}!A:F`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[date, time, `form:${name}`, customer.trim(), price, paymentStatus]] },
    })
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_CATEGORIZED}!A:F`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[date, time, name, customer.trim(), price, paymentStatus]] },
    })
    console.log(`✅ [form] ${date} ${time} | ${name} → ${customer} $${price} [${paymentStatus}]`)
    const payload = { ok: true, date, time, name, customer: customer.trim(), amount: price, paymentStatus }
    if (!wantsHtml(req)) return res.status(200).json(payload)
    return res.status(200).setHeader("Content-Type", "text/html; charset=utf-8").send(`<!DOCTYPE html>
<html lang="zh-TW">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>記帳完成</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:24px">
  <h1 style="color:#06c755;font-size:24px;margin-bottom:10px">記帳成功</h1>
  <p style="font-size:16px;margin:0 0 6px">${escHtml(customer)} $${price.toLocaleString()}</p>
  <p style="font-size:14px;margin:0 0 18px;color:#666">收款狀態：${escHtml(paymentStatus)}</p>
  <button onclick="history.back()" style="padding:10px 14px;border:none;border-radius:10px;background:#06c755;color:#fff;font-size:16px">返回表單</button>
</body>
</html>`)
  } catch (e: any) {
    console.error("record error:", e?.message)
    return wantsHtml(req)
      ? res.status(500).setHeader("Content-Type", "text/html; charset=utf-8").send("<h1>Server error</h1>")
      : res.status(500).json({ ok: false, error: e?.message })
  }
}
