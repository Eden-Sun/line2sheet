import type { VercelRequest, VercelResponse } from "@vercel/node"
import { google } from "googleapis"
import { promises as fs } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const FORM_TOKEN = process.env.FORM_TOKEN ?? ""
const SPREADSHEET_ID = process.env.SPREADSHEET_ID
const SHEET_ROSTER = process.env.SHEET_ROSTER?.trim() || "名單"
const SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON

let htmlCache: string | null = null

async function getNickname(userId: string): Promise<string | null> {
  if (!SERVICE_ACCOUNT_JSON || !SPREADSHEET_ID) return null
  try {
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(SERVICE_ACCOUNT_JSON),
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    })
    const sheets = google.sheets({ version: "v4", auth })
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

async function readIndexHtml(): Promise<string> {
  if (htmlCache) return htmlCache

  const baseDir = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [
    path.resolve(process.cwd(), "dist/index.html"),
    path.resolve(baseDir, "../dist/index.html"),
  ]

  for (const file of candidates) {
    try {
      htmlCache = await fs.readFile(file, "utf8")
      return htmlCache
    } catch {
      // try next path
    }
  }

  throw new Error("dist/index.html not found. Run frontend build first.")
}

function scriptSafeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c")
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const userId = String(req.query.userId ?? "")
  const nickname = userId ? await getNickname(userId) : null

  const config = {
    token: FORM_TOKEN,
    userId,
    senderValue: nickname || "",
    senderReadonly: Boolean(nickname),
  }

  try {
    const html = await readIndexHtml()
    const injected = html.replace(
      "</head>",
      `<script>window.__FORM_CONFIG__=${scriptSafeJson(config)};</script></head>`,
    )

    res.setHeader("Content-Type", "text/html; charset=utf-8")
    res.setHeader("Cache-Control", "no-store")
    return res.status(200).send(injected)
  } catch (error: any) {
    console.error("[form] failed to load dist/index.html:", error?.message)
    return res.status(500).setHeader("Content-Type", "text/plain; charset=utf-8").send(
      "Frontend not built. Run `npm run build` to generate dist/index.html.",
    )
  }
}
