import type { VercelRequest, VercelResponse } from "@vercel/node"
import { createHmac, timingSafeEqual } from "crypto"
import { google } from "googleapis"

export const config = { api: { bodyParser: false } }

// ── Env ────────────────────────────────────────────────────────────────────

const CHANNEL_SECRET       = process.env.LINE_CHANNEL_SECRET!
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN!
const SPREADSHEET_ID       = process.env.SPREADSHEET_ID!
const SHEET_RAW            = process.env.SHEET_NAME        ?? "Sheet1"
const SHEET_CATEGORIZED    = process.env.SHEET_CATEGORIZED ?? "分類紀錄"
const SHEET_ROSTER         = process.env.SHEET_ROSTER      ?? "名單"
const SHEET_CUSTOMERS      = process.env.SHEET_CUSTOMERS   ?? "客戶"
const SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON!

// Amount preset buttons (3 per row)
const AMOUNT_PRESETS = (process.env.AMOUNT_PRESETS ?? "1000,3000,5000,8000,10000,20000")
  .split(",").map(Number).filter(Boolean)

// ── LINE API ───────────────────────────────────────────────────────────────

async function replyLine(replyToken: string, messages: object[]) {
  await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ replyToken, messages }),
  })
}

async function getDisplayName(userId: string): Promise<string> {
  try {
    const r = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
      headers: { Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}` },
    })
    if (!r.ok) return userId
    const { displayName } = await r.json() as { displayName?: string }
    return displayName ?? userId
  } catch { return userId }
}

// ── Google Sheets ──────────────────────────────────────────────────────────

function buildSheets() {
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(SERVICE_ACCOUNT_JSON),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  })
  return google.sheets({ version: "v4", auth })
}

// 客戶清單（優先顯示最近記帳，再補完整名單）
async function getCustomers(page = 0): Promise<{ names: string[]; total: number }> {
  const PER_PAGE = 12
  try {
    const sheets = buildSheets()
    // 從分類紀錄拉最近 100 筆，取不重複客戶（recency order）
    const recent = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID, range: `${SHEET_CATEGORIZED}!D:D`,
    }).catch(() => ({ data: { values: [] } }))
    const recentNames = [...new Set(
      (recent.data.values ?? []).map(r => String(r[0] ?? "").trim()).filter(Boolean).reverse()
    )].slice(0, 20)

    // 完整客戶清單
    const all = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID, range: `${SHEET_CUSTOMERS}!A:A`,
    })
    const allNames = (all.data.values ?? [])
      .map(r => String(r[0] ?? "").trim())
      .filter(n => n && !/^(客戶|name)$/i.test(n))

    // 合併：最近的優先，再補其他
    const merged = [...new Set([...recentNames, ...allNames])]
    const total = merged.length
    const start = page * PER_PAGE
    return { names: merged.slice(start, start + PER_PAGE), total }
  } catch { return { names: [], total: 0 } }
}

// UID → 暱稱對照（用於寫入 sheet）
async function getNickname(userId: string): Promise<string> {
  try {
    const res = await buildSheets().spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID, range: `${SHEET_ROSTER}!A:B`,
    })
    const row = (res.data.values ?? []).find(r => r[0]?.trim() === userId)
    if (row?.[1]) return String(row[1]).trim()
  } catch {}
  return getDisplayName(userId)
}

async function writeRecord(userId: string, nickname: string, customer: string, price: number) {
  const sheets = buildSheets()
  const now  = new Date(Date.now() + 8 * 3600_000)
  const date = now.toISOString().slice(0, 10)
  const time = now.toISOString().slice(11, 16)
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID, range: `${SHEET_RAW}!A:E`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[date, time, userId, customer, price]] },
  })
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID, range: `${SHEET_CATEGORIZED}!A:E`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[date, time, nickname, customer, price]] },
  })
  return { date, time }
}

// ── 最近紀錄 ───────────────────────────────────────────────────────────────

async function buildRecentFlex(): Promise<object> {
  try {
    const res = await buildSheets().spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID, range: `${SHEET_CATEGORIZED}!A:E`,
    })
    const rows = (res.data.values ?? []).filter(r => r[0] && r[0] !== "日期").slice(-5).reverse()
    if (!rows.length) return { type: "text", text: "還沒有任何記錄。" }

    const items = rows.map(r => ({
      type: "box", layout: "horizontal", paddingBottom: "8px",
      contents: [
        { type: "box", layout: "vertical", flex: 3, contents: [
          { type: "text", text: String(r[3] ?? "-"), weight: "bold", size: "sm", wrap: true },
          { type: "text", text: `${r[2] ?? ""} · ${r[0]} ${r[1]}`, size: "xs", color: "#888888" },
        ]},
        { type: "text", text: `$${Number(r[4] ?? 0).toLocaleString()}`,
          flex: 2, align: "end", weight: "bold", color: "#06c755", size: "sm" },
      ],
    }))

    return flexMsg("最近紀錄", {
      type: "bubble", size: "kilo",
      header: header("📋 最近 5 筆紀錄"),
      body: {
        type: "box", layout: "vertical",
        paddingAll: "12px", spacing: "sm",
        contents: [
          ...items,
          { type: "separator" },
          { type: "box", layout: "horizontal", paddingTop: "10px", contents: [
            btn("📦 記帳", "a=start"),
          ]},
        ],
      },
    })
  } catch (e: any) {
    return { type: "text", text: `讀取失敗：${e.message}` }
  }
}

// ── Flex Message builders ──────────────────────────────────────────────────

function btn(label: string, data: string) {
  return {
    type: "button",
    action: { type: "postback", label, data },
    style: "secondary", height: "sm", flex: 1,
  }
}

function row(...items: object[]) {
  return { type: "box", layout: "horizontal", spacing: "xs", contents: items }
}

function header(text: string) {
  return {
    type: "box", layout: "vertical",
    backgroundColor: "#06c755", paddingAll: "14px",
    contents: [{ type: "text", text, color: "#ffffff", weight: "bold", size: "md" }],
  }
}

function bubble(headerText: string, bodyContents: object[]): object {
  return {
    type: "bubble", size: "kilo",
    header: header(headerText),
    body: {
      type: "box", layout: "vertical",
      paddingAll: "12px", spacing: "sm",
      contents: bodyContents,
    },
  }
}

function flexMsg(altText: string, contents: object): object {
  return { type: "flex", altText, contents }
}

// 客戶選單（含翻頁）
function customerFlex(names: string[], page: number, total: number): object {
  const PER_PAGE = 12
  const rows: object[] = []
  for (let i = 0; i < names.length; i += 3) {
    rows.push(row(...names.slice(i, i + 3).map(n => btn(n, `a=sel_c&c=${encodeURIComponent(n)}`))))
  }
  // 翻頁列
  const navBtns: object[] = []
  if (page > 0)
    navBtns.push(btn(`◀ 上一頁`, `a=start&pg=${page - 1}`))
  navBtns.push(btn("✏️ 自輸入", "a=custom_c"))
  if ((page + 1) * PER_PAGE < total)
    navBtns.push(btn(`下一頁 ▶`, `a=start&pg=${page + 1}`))
  rows.push(row(...navBtns))

  const pageInfo = total > PER_PAGE ? `（第 ${page + 1}/${Math.ceil(total / PER_PAGE)} 頁）` : ""
  return flexMsg("選擇客戶", bubble(`👤 選擇客戶 ${pageInfo}`, rows))
}

// 金額選單
function amountFlex(customer: string): object {
  const ce = encodeURIComponent(customer)
  const rows: object[] = []
  for (let i = 0; i < AMOUNT_PRESETS.length; i += 3) {
    rows.push(row(...AMOUNT_PRESETS.slice(i, i + 3).map(a =>
      btn(`$${a.toLocaleString()}`, `a=sel_a&c=${ce}&p=${a}`)
    )))
  }
  rows.push(row(
    btn("✏️ 自行輸入", `a=custom_a&c=${ce}`),
    btn("↩️ 換客戶", "a=start"),
  ))
  return flexMsg("選擇金額", bubble(`📋 ${customer}\n💰 選擇金額`, rows))
}

// 確認畫面
function confirmFlex(customer: string, price: number): object {
  const ce = encodeURIComponent(customer)
  const body = [
    { type: "box", layout: "vertical", spacing: "xs", paddingBottom: "12px", contents: [
      { type: "box", layout: "horizontal", contents: [
        { type: "text", text: "客戶", color: "#888888", size: "sm", flex: 1 },
        { type: "text", text: customer, weight: "bold", flex: 3 },
      ]},
      { type: "box", layout: "horizontal", contents: [
        { type: "text", text: "金額", color: "#888888", size: "sm", flex: 1 },
        { type: "text", text: `$${price.toLocaleString()}`, weight: "bold", color: "#06c755", flex: 3 },
      ]},
    ]},
    { type: "separator" },
    { type: "box", layout: "horizontal", spacing: "sm", paddingTop: "12px", contents: [
      { ...btn("❌ 取消",   "a=cancel"),   style: "primary", color: "#ff3b30" },
      { ...btn("✅ 確認記帳", `a=record&c=${ce}&p=${price}`), style: "primary", color: "#06c755" },
    ]},
    row(
      btn("↩️ 換客戶", "a=start"),
      btn("↩️ 換金額", `a=sel_c&c=${ce}`),
    ),
  ]
  return flexMsg("確認記帳", bubble("📦 確認記帳", body))
}

// 成功訊息
function successFlex(nickname: string, customer: string, price: number, date: string, time: string): object {
  return flexMsg("記帳成功", {
    type: "bubble", size: "kilo",
    header: { type: "box", layout: "vertical", backgroundColor: "#06c755", paddingAll: "14px",
      contents: [{ type: "text", text: "✅ 記帳成功", color: "#ffffff", weight: "bold", size: "md" }] },
    body: {
      type: "box", layout: "vertical", paddingAll: "12px", spacing: "sm",
      contents: [
        row(
          { type: "text", text: "傳送者", color: "#888", size: "sm", flex: 1 },
          { type: "text", text: nickname, weight: "bold", flex: 3 },
        ),
        row(
          { type: "text", text: "客戶",   color: "#888", size: "sm", flex: 1 },
          { type: "text", text: customer, weight: "bold", flex: 3 },
        ),
        row(
          { type: "text", text: "金額",   color: "#888", size: "sm", flex: 1 },
          { type: "text", text: `$${price.toLocaleString()}`, weight: "bold", color: "#06c755", flex: 3 },
        ),
        row(
          { type: "text", text: "時間",   color: "#888", size: "sm", flex: 1 },
          { type: "text", text: `${date} ${time}`, size: "sm", flex: 3 },
        ),
        { type: "separator" },
        row(btn("📦 繼續記帳", "a=start")),
      ],
    },
  })
}

// ── Signature ──────────────────────────────────────────────────────────────

function verify(body: string, sig: string): boolean {
  const exp = createHmac("sha256", CHANNEL_SECRET).update(body).digest("base64")
  try { return timingSafeEqual(Buffer.from(exp), Buffer.from(sig)) } catch { return false }
}

function readBody(req: VercelRequest): Promise<string> {
  return new Promise((res, rej) => {
    let d = ""
    req.on("data", c => { d += c })
    req.on("end", () => res(d))
    req.on("error", rej)
  })
}

// ── Handler ────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(404).send("Not Found")

  const raw = await readBody(req)
  if (!verify(raw, (req.headers["x-line-signature"] as string) ?? ""))
    return res.status(401).send("Unauthorized")

  const events: any[] = JSON.parse(raw).events ?? []

  for (const event of events) {
    const token  = event.replyToken
    const userId = event.source?.userId ?? ""

    // ── POSTBACK ───────────────────────────────────────────────────────
    if (event.type === "postback") {
      const p       = new URLSearchParams(event.postback.data)
      const action  = p.get("a")
      const customer = p.get("c") ? decodeURIComponent(p.get("c")!) : ""
      const price   = Number(p.get("p") ?? 0)

      switch (action) {
        case "start": {
          const pg = Number(p.get("pg") ?? 0)
          const { names, total } = await getCustomers(pg)
          await replyLine(token, [customerFlex(names, pg, total)])
          break
        }
        case "sel_c": {
          await replyLine(token, [amountFlex(customer)])
          break
        }
        case "custom_c": {
          await replyLine(token, [{ type: "text", text: "✏️ 請輸入客戶名稱：" }])
          break
        }
        case "sel_a": {
          await replyLine(token, [confirmFlex(customer, price)])
          break
        }
        case "custom_a": {
          await replyLine(token, [{
            type: "text", text: `📋 客戶：${customer}\n\n✏️ 請輸入金額（數字）：`,
          }])
          break
        }
        case "record": {
          const nickname = await getNickname(userId)
          try {
            const { date, time } = await writeRecord(userId, nickname, customer, price)
            await replyLine(token, [successFlex(nickname, customer, price, date, time)])
            console.log(`✅ [line] ${nickname} → ${customer} $${price}`)
          } catch (e: any) {
            await replyLine(token, [{ type: "text", text: `❌ 記帳失敗：${e.message}` }])
          }
          break
        }
        case "recent": {
          const recentMsg = await buildRecentFlex()
          await replyLine(token, [recentMsg])
          break
        }
        case "cancel": {
          await replyLine(token, [{ type: "text", text: "已取消 ✋" }])
          break
        }
      }
      continue
    }

    // ── TEXT MESSAGE ───────────────────────────────────────────────────
    if (event.type === "message" && event.message?.type === "text") {
      const text = event.message.text.trim()

      // 記帳 keyword → 顯示客戶選單
      if (text === "記帳" || text === "記帳！" || text === "/add") {
        const { names, total } = await getCustomers(0)
        await replyLine(token, [customerFlex(names, 0, total)])
        continue
      }

      // 直接格式：「客戶 金額」
      const i = text.lastIndexOf(" ")
      if (i !== -1) {
        const cust  = text.slice(0, i).trim()
        const price = Number(text.slice(i + 1).replace(/,/g, ""))
        if (cust && Number.isFinite(price) && price > 0) {
          await replyLine(token, [confirmFlex(cust, price)])
          continue
        }
      }

      // 純數字 → 可能是 custom_a 後的金額輸入（無狀態，給提示）
      if (/^\d[\d,]*$/.test(text)) {
        await replyLine(token, [{
          type: "text",
          text: "請用「客戶名稱 金額」格式，例如：\n台北科技 14600",
        }])
        continue
      }
    }
  }

  return res.status(200).send("OK")
}
