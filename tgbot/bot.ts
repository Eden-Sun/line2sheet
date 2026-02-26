import { Bot, InlineKeyboard } from "grammy"
import { google } from "googleapis"

// ── Env ────────────────────────────────────────────────────────────────────

const BOT_TOKEN         = process.env.TG_BOT_TOKEN!
const SPREADSHEET_ID    = process.env.SPREADSHEET_ID!
const SHEET_RAW         = process.env.SHEET_NAME        ?? "Sheet1"
const SHEET_CATEGORIZED = process.env.SHEET_CATEGORIZED ?? "分類紀錄"
const SHEET_ROSTER      = process.env.SHEET_ROSTER      ?? "名單"
const SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON!

if (!BOT_TOKEN || !SPREADSHEET_ID || !SERVICE_ACCOUNT_JSON) {
  console.error("❌ Missing required env vars: TG_BOT_TOKEN, SPREADSHEET_ID, GOOGLE_SERVICE_ACCOUNT_JSON")
  process.exit(1)
}

// ── Google Sheets ──────────────────────────────────────────────────────────

function buildSheets() {
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(SERVICE_ACCOUNT_JSON),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  })
  return google.sheets({ version: "v4", auth })
}

async function getRoster(): Promise<{ uid: string; name: string }[]> {
  try {
    const sheets = buildSheets()
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_ROSTER}!A:B`,
    })
    return (res.data.values ?? [])
      .filter(r => r[0] && r[1] && !/^uid$/i.test(r[0]))
      .map(r => ({ uid: r[0].trim(), name: r[1].trim() }))
  } catch { return [] }
}

async function writeRecord(sender: string, customer: string, price: number) {
  const sheets = buildSheets()
  const now  = new Date(Date.now() + 8 * 3600_000)
  const date = now.toISOString().slice(0, 10)
  const time = now.toISOString().slice(11, 16)
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_RAW}!A:E`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[date, time, `tg:${sender}`, customer, price]] },
  })
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_CATEGORIZED}!A:E`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[date, time, sender, customer, price]] },
  })
  return { date, time }
}

// ── State machine (per chat) ───────────────────────────────────────────────

interface State {
  step: "await_customer" | "await_amount"
  sender: string
  customer?: string
}
const state = new Map<number, State>()

// ── Bot ────────────────────────────────────────────────────────────────────

const bot = new Bot(BOT_TOKEN)

// /start
bot.command("start", ctx => ctx.reply(
  "📦 *出貨記帳 Bot*\n\n傳送 /add 開始記帳，或直接輸入 `客戶名稱 金額`",
  { parse_mode: "Markdown" }
))

// /add 或「記帳」
async function startRecord(ctx: any) {
  const userId = ctx.from?.id
  if (!userId) return

  const roster = await getRoster()
  const senderName = ctx.from?.first_name ?? String(userId)

  if (roster.length === 0) {
    // 沒有名單，直接問客戶名稱
    state.set(ctx.chat.id, { step: "await_customer", sender: senderName })
    await ctx.reply("📋 請輸入客戶名稱：")
    return
  }

  // 建立名單按鈕
  const kb = new InlineKeyboard()
  roster.forEach((r, i) => {
    kb.text(r.name, `customer:${r.name}`)
    if ((i + 1) % 3 === 0) kb.row()
  })
  kb.row().text("✏️ 自行輸入", "customer:__custom__")

  state.set(ctx.chat.id, { step: "await_customer", sender: senderName })
  await ctx.reply("👤 選擇客戶：", { reply_markup: kb })
}

bot.command("add", startRecord)
bot.hears(/^記帳$/, startRecord)

// Inline button callback
bot.callbackQuery(/^customer:(.+)$/, async ctx => {
  const chatId = ctx.chat?.id
  if (!chatId) return
  const s = state.get(chatId)
  if (!s) return await ctx.answerCallbackQuery()

  const name = ctx.match[1]
  await ctx.answerCallbackQuery()

  if (name === "__custom__") {
    state.set(chatId, { ...s, step: "await_customer" })
    await ctx.editMessageText("✏️ 請輸入客戶名稱：")
    return
  }

  state.set(chatId, { step: "await_amount", sender: s.sender, customer: name })
  await ctx.editMessageText(`📋 客戶：*${name}*\n\n💰 請輸入金額：`, { parse_mode: "Markdown" })
})

// Message handler
bot.on("message:text", async ctx => {
  const chatId = ctx.chat.id
  const text = ctx.message.text.trim()
  const s = state.get(chatId)

  // ── 1. Shortcut：直接「客戶 金額」格式 ───────────────────────────────
  if (!s) {
    const i = text.lastIndexOf(" ")
    if (i !== -1) {
      const customer = text.slice(0, i).trim()
      const price = Number(text.slice(i + 1).replace(/,/g, ""))
      if (customer && Number.isFinite(price) && price > 0) {
        const sender = ctx.from?.first_name ?? String(ctx.from?.id)
        try {
          const { date, time } = await writeRecord(sender, customer, price)
          await ctx.reply(
            `✅ 已記帳\n\n👤 ${sender}\n📋 ${customer}\n💰 $${price.toLocaleString()}\n🕐 ${date} ${time}`,
            { parse_mode: "Markdown" }
          )
        } catch (e: any) {
          await ctx.reply(`❌ 記帳失敗：${e.message}`)
        }
        return
      }
    }
    // 不認識的訊息
    await ctx.reply("傳 /add 開始記帳，或直接輸入 `客戶名稱 金額`", { parse_mode: "Markdown" })
    return
  }

  // ── 2. Step: 等待客戶名稱 ────────────────────────────────────────────
  if (s.step === "await_customer") {
    state.set(chatId, { ...s, step: "await_amount", customer: text })
    await ctx.reply(`📋 客戶：*${text}*\n\n💰 請輸入金額：`, { parse_mode: "Markdown" })
    return
  }

  // ── 3. Step: 等待金額 ─────────────────────────────────────────────────
  if (s.step === "await_amount") {
    const price = Number(text.replace(/,/g, ""))
    if (!Number.isFinite(price) || price <= 0) {
      await ctx.reply("❌ 金額格式不對，請重新輸入數字：")
      return
    }

    state.delete(chatId)
    try {
      const { date, time } = await writeRecord(s.sender, s.customer!, price)
      const kb = new InlineKeyboard()
        .text("📦 繼續記帳", "restart")
        .text("✅ 完成", "done")
      await ctx.reply(
        `✅ 已記帳！\n\n👤 ${s.sender}\n📋 ${s.customer}\n💰 $${price.toLocaleString()}\n🕐 ${date} ${time}`,
        { reply_markup: kb }
      )
    } catch (e: any) {
      await ctx.reply(`❌ 記帳失敗：${e.message}`)
    }
  }
})

// 繼續/完成按鈕
bot.callbackQuery("restart", async ctx => {
  await ctx.answerCallbackQuery()
  await ctx.editMessageReplyMarkup()
  await startRecord(ctx)
})
bot.callbackQuery("done", async ctx => {
  await ctx.answerCallbackQuery("👍 完成！")
  await ctx.editMessageReplyMarkup()
})

bot.start({ onStart: info => console.log(`🤖 Bot @${info.username} started`) })
