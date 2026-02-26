import { Bot, InlineKeyboard } from "grammy"
import { google } from "googleapis"
import { readFileSync, writeFileSync, mkdirSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const __dir = dirname(fileURLToPath(import.meta.url))

// ── Env ────────────────────────────────────────────────────────────────────

const BOT_TOKEN            = process.env.TG_BOT_TOKEN!
const SPREADSHEET_ID       = process.env.SPREADSHEET_ID!
const SHEET_RAW            = process.env.SHEET_NAME        ?? "Sheet1"
const SHEET_CATEGORIZED    = process.env.SHEET_CATEGORIZED ?? "分類紀錄"
const SHEET_ROSTER         = process.env.SHEET_ROSTER      ?? "名單"
const SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON!

// ── Amount history ─────────────────────────────────────────────────────────

const DATA_FILE = join(__dir, "data", "amounts.json")
mkdirSync(join(__dir, "data"), { recursive: true })

function loadAmounts(): Record<string, number[]> {
  try { return JSON.parse(readFileSync(DATA_FILE, "utf8")) } catch { return {} }
}
function saveAmounts(d: Record<string, number[]>) {
  writeFileSync(DATA_FILE, JSON.stringify(d, null, 2))
}
function recordAmount(customer: string, amount: number) {
  const d = loadAmounts()
  const list = [amount, ...(d[customer] ?? []).filter(x => x !== amount)].slice(0, 5)
  d[customer] = list
  saveAmounts(d)
}
function getRecentAmounts(customer: string): number[] {
  const d = loadAmounts()
  // merge customer-specific + global presets
  const specific = d[customer] ?? []
  const global = d["__global__"] ?? [1000, 3000, 5000, 10000, 20000]
  const merged = [...new Set([...specific, ...global])].slice(0, 6)
  return merged
}

// ── Google Sheets ──────────────────────────────────────────────────────────

function buildSheets() {
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(SERVICE_ACCOUNT_JSON),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  })
  return google.sheets({ version: "v4", auth })
}

async function getRoster(): Promise<string[]> {
  try {
    const res = await buildSheets().spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID, range: `${SHEET_ROSTER}!A:B`,
    })
    return (res.data.values ?? [])
      .filter(r => r[1] && !/^uid$/i.test(r[0] ?? ""))
      .map(r => r[1].trim())
  } catch { return [] }
}

async function writeRecord(sender: string, customer: string, price: number) {
  const sheets = buildSheets()
  const now  = new Date(Date.now() + 8 * 3600_000)
  const date = now.toISOString().slice(0, 10)
  const time = now.toISOString().slice(11, 16)
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID, range: `${SHEET_RAW}!A:E`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[date, time, `tg:${sender}`, customer, price]] },
  })
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID, range: `${SHEET_CATEGORIZED}!A:E`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[date, time, sender, customer, price]] },
  })
  return { date, time }
}

// ── State ──────────────────────────────────────────────────────────────────

interface State {
  step: "customer" | "amount" | "custom_amount" | "confirm"
  sender: string
  customer?: string
  amount?: number
}
const sessions = new Map<number, State>()

// ── Keyboards ──────────────────────────────────────────────────────────────

async function customerKeyboard(): Promise<{ kb: InlineKeyboard; text: string }> {
  const names = await getRoster()
  const kb = new InlineKeyboard()
  names.forEach((name, i) => {
    kb.text(name, `c:${name}`)
    if ((i + 1) % 3 === 0) kb.row()
  })
  if (names.length % 3 !== 0) kb.row()
  kb.text("✏️ 自行輸入", "c:__custom__")
  return { kb, text: "👤 選擇客戶：" }
}

function amountKeyboard(customer: string): { kb: InlineKeyboard; text: string } {
  const amounts = getRecentAmounts(customer)
  const kb = new InlineKeyboard()
  amounts.forEach((a, i) => {
    kb.text(`$${a.toLocaleString()}`, `a:${a}`)
    if ((i + 1) % 3 === 0) kb.row()
  })
  if (amounts.length % 3 !== 0) kb.row()
  kb.text("✏️ 自行輸入", "a:__custom__")
  return { kb, text: `📋 客戶：*${customer}*\n\n💰 選擇金額：` }
}

function confirmKeyboard(customer: string, amount: number): { kb: InlineKeyboard; text: string } {
  const kb = new InlineKeyboard()
    .text("✅ 確認記帳", "confirm")
    .text("❌ 取消", "cancel")
    .row()
    .text("↩️ 重選客戶", "back:customer")
    .text("↩️ 重選金額", "back:amount")
  return {
    kb,
    text: `📦 *確認記帳*\n\n👤 客戶：*${customer}*\n💰 金額：*$${amount.toLocaleString()}*\n\n送出？`
  }
}

// ── Bot ────────────────────────────────────────────────────────────────────

const bot = new Bot(BOT_TOKEN)

async function startAdd(ctx: any) {
  const sender = ctx.from?.first_name ?? String(ctx.from?.id ?? "用戶")
  sessions.set(ctx.chat.id, { step: "customer", sender })
  const { kb, text } = await customerKeyboard()
  await ctx.reply(text, { reply_markup: kb, parse_mode: "Markdown" })
}

bot.command("start", ctx => ctx.reply(
  "📦 *出貨記帳 Bot*\n\n傳 /add 或「記帳」開始\n\n或直接傳 `客戶名稱 金額` 快速記帳",
  { parse_mode: "Markdown" }
))
bot.command("add", startAdd)
bot.hears(/^記帳$/, startAdd)

// ── Callback handlers ──────────────────────────────────────────────────────

// 選客戶
bot.callbackQuery(/^c:(.+)$/, async ctx => {
  await ctx.answerCallbackQuery()
  const chatId = ctx.chat!.id
  const s = sessions.get(chatId)
  if (!s) return

  const val = ctx.match[1]
  if (val === "__custom__") {
    sessions.set(chatId, { ...s, step: "customer" })
    await ctx.editMessageText("✏️ 請輸入客戶名稱：")
    return
  }

  sessions.set(chatId, { ...s, step: "amount", customer: val })
  const { kb, text } = amountKeyboard(val)
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "Markdown" })
})

// 選金額
bot.callbackQuery(/^a:(.+)$/, async ctx => {
  await ctx.answerCallbackQuery()
  const chatId = ctx.chat!.id
  const s = sessions.get(chatId)
  if (!s || !s.customer) return

  const val = ctx.match[1]
  if (val === "__custom__") {
    sessions.set(chatId, { ...s, step: "custom_amount" })
    await ctx.editMessageText(`📋 客戶：*${s.customer}*\n\n✏️ 請輸入金額：`, { parse_mode: "Markdown" })
    return
  }

  const amount = Number(val)
  sessions.set(chatId, { ...s, step: "confirm", amount })
  const { kb, text } = confirmKeyboard(s.customer, amount)
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "Markdown" })
})

// 確認記帳
bot.callbackQuery("confirm", async ctx => {
  await ctx.answerCallbackQuery()
  const chatId = ctx.chat!.id
  const s = sessions.get(chatId)
  if (!s?.customer || !s.amount) return

  sessions.delete(chatId)
  await ctx.editMessageText("⏳ 記帳中…")

  try {
    const { date, time } = await writeRecord(s.sender, s.customer, s.amount)
    recordAmount(s.customer, s.amount)

    const kb = new InlineKeyboard()
      .text("📦 繼續記帳", "restart")
      .text("✅ 完成", "done")
    await ctx.editMessageText(
      `✅ *已記帳！*\n\n👤 ${s.sender}\n📋 ${s.customer}\n💰 $${s.amount.toLocaleString()}\n🕐 ${date} ${time}`,
      { reply_markup: kb, parse_mode: "Markdown" }
    )
  } catch (e: any) {
    await ctx.editMessageText(`❌ 記帳失敗：${e.message}`)
  }
})

// 取消
bot.callbackQuery("cancel", async ctx => {
  await ctx.answerCallbackQuery("已取消")
  sessions.delete(ctx.chat!.id)
  await ctx.editMessageText("已取消 ✋")
})

// 返回
bot.callbackQuery(/^back:(.+)$/, async ctx => {
  await ctx.answerCallbackQuery()
  const chatId = ctx.chat!.id
  const s = sessions.get(chatId)
  if (!s) return

  if (ctx.match[1] === "customer") {
    sessions.set(chatId, { ...s, step: "customer", customer: undefined, amount: undefined })
    const { kb, text } = await customerKeyboard()
    await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "Markdown" })
  } else {
    sessions.set(chatId, { ...s, step: "amount", amount: undefined })
    const { kb, text } = amountKeyboard(s.customer!)
    await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "Markdown" })
  }
})

// 重新開始 / 完成
bot.callbackQuery("restart", async ctx => {
  await ctx.answerCallbackQuery()
  await ctx.editMessageReplyMarkup()
  await startAdd(ctx)
})
bot.callbackQuery("done", async ctx => {
  await ctx.answerCallbackQuery("👍")
  await ctx.editMessageReplyMarkup()
})

// ── 文字訊息 ───────────────────────────────────────────────────────────────

bot.on("message:text", async ctx => {
  const chatId = ctx.chat.id
  const text   = ctx.message.text.trim()
  const s      = sessions.get(chatId)

  // 等待客戶名稱（自行輸入）
  if (s?.step === "customer") {
    sessions.set(chatId, { ...s, step: "amount", customer: text })
    const { kb, text: t } = amountKeyboard(text)
    await ctx.reply(t, { reply_markup: kb, parse_mode: "Markdown" })
    return
  }

  // 等待金額（自行輸入）
  if (s?.step === "custom_amount") {
    const price = Number(text.replace(/,/g, ""))
    if (!Number.isFinite(price) || price <= 0) {
      await ctx.reply("❌ 金額格式不對，請輸入數字：")
      return
    }
    sessions.set(chatId, { ...s, step: "confirm", amount: price })
    const { kb, text: t } = confirmKeyboard(s.customer!, price)
    await ctx.reply(t, { reply_markup: kb, parse_mode: "Markdown" })
    return
  }

  // 快捷格式：「客戶 金額」
  const i = text.lastIndexOf(" ")
  if (i !== -1) {
    const customer = text.slice(0, i).trim()
    const price = Number(text.slice(i + 1).replace(/,/g, ""))
    if (customer && Number.isFinite(price) && price > 0) {
      const sender = ctx.from?.first_name ?? String(ctx.from?.id)
      // 直接確認不走按鈕流程
      sessions.set(chatId, { step: "confirm", sender, customer, amount: price })
      const { kb, text: t } = confirmKeyboard(customer, price)
      await ctx.reply(t, { reply_markup: kb, parse_mode: "Markdown" })
      return
    }
  }

  await ctx.reply("傳 /add 開始記帳，或輸入 `客戶名稱 金額`", { parse_mode: "Markdown" })
})

bot.start({ onStart: info => console.log(`🤖 @${info.username} 已啟動`) })
