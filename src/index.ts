import { createHmac, timingSafeEqual } from "crypto";
import { google } from "googleapis";

const PORT = Number(process.env.PORT) || 3000;
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET!;
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN ?? ""  // optional;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID!;
const SHEET_NAME = process.env.SHEET_NAME ?? "Sheet1";

// ── Startup check ──────────────────────────────────────────────────────────

for (const [k, v] of Object.entries({
  LINE_CHANNEL_SECRET: CHANNEL_SECRET,
  SPREADSHEET_ID,
  GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_APPLICATION_CREDENTIALS,
})) {
  if (!v) { console.error(`❌ Missing env: ${k}`); process.exit(1); }
}
if (!CHANNEL_ACCESS_TOKEN) console.warn("⚠️ LINE_CHANNEL_ACCESS_TOKEN not set — sender will show as userId")

// ── 訊息解析：「客戶名稱 金額」─────────────────────────────────────────────
// 格式：<客戶> <金額>，例如「某客戶 14600」
// 回傳 null 代表格式不符，不寫入

interface DeliveryRecord {
  customer: string  // 客戶名稱
  price: number     // 金額（整數）
}

function parseDelivery(text: string): DeliveryRecord | null {
  const trimmed = text.trim()
  // 最後一個 token 為金額，前面為客戶名稱（支援客戶名稱含空格）
  const lastSpace = trimmed.lastIndexOf(" ")
  if (lastSpace === -1) return null

  const customer = trimmed.slice(0, lastSpace).trim()
  const priceStr = trimmed.slice(lastSpace + 1).trim().replace(/,/g, "")
  const price = Number(priceStr)

  if (!customer || !Number.isFinite(price) || price <= 0) return null
  return { customer, price }
}

// ── LINE ───────────────────────────────────────────────────────────────────

function verifySignature(rawBody: string, signature: string): boolean {
  const expected = createHmac("sha256", CHANNEL_SECRET)
    .update(rawBody)
    .digest("base64");
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

const _nameCache = new Map<string, string>();

async function getDisplayName(userId: string): Promise<string> {
  if (!CHANNEL_ACCESS_TOKEN) return userId;  // skip if no token
  if (_nameCache.has(userId)) return _nameCache.get(userId)!;
  try {
    const res = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
      headers: { Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}` },
    });
    if (!res.ok) return userId;
    const { displayName } = (await res.json()) as { displayName?: string };
    const name = displayName ?? userId;
    _nameCache.set(userId, name);
    return name;
  } catch {
    return userId;
  }
}

// ── Google Sheets ──────────────────────────────────────────────────────────

const auth = new google.auth.GoogleAuth({
  keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });

// 欄位：日期 | 時間 | 傳送者 | 客戶 | 金額
async function appendRecord(
  date: string,
  time: string,
  sender: string,
  customer: string,
  price: number,
): Promise<void> {
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:E`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[date, time, sender, customer, price]] },
  });
}

// ── LINE event types ───────────────────────────────────────────────────────

interface LineSource {
  type: "user" | "group" | "room";
  userId: string;
}

interface LineEvent {
  type: string;
  timestamp: number;
  source: LineSource;
  message: { type: string; text: string };
}

// ── Server ─────────────────────────────────────────────────────────────────

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const { pathname } = new URL(req.url);

    if (pathname === "/health" && req.method === "GET")
      return new Response("OK");

    if (pathname !== "/webhook" || req.method !== "POST")
      return new Response("Not Found", { status: 404 });

    const rawBody = await req.text();
    const signature = req.headers.get("x-line-signature") ?? "";

    if (!verifySignature(rawBody, signature))
      return new Response("Unauthorized", { status: 401 });

    let events: LineEvent[];
    try {
      ({ events } = JSON.parse(rawBody) as { events: LineEvent[] });
    } catch {
      return new Response("Bad Request", { status: 400 });
    }

    // 非同步處理，確保 5s 內回 OK 給 LINE
    processEvents(events).catch(e => console.error("processEvents error:", e));

    return new Response("OK");
  },
});

async function processEvents(events: LineEvent[]): Promise<void> {
  for (const event of events) {
    if (event.type !== "message" || event.message?.type !== "text") continue;

    const text = event.message.text.trim();
    const record = parseDelivery(text);

    if (!record) {
      console.log(`⏭ 跳過（格式不符）：${text}`);
      continue;
    }

    const ts = new Date(event.timestamp);
    // 台北時間 UTC+8
    const tpe = new Date(ts.getTime() + 8 * 3600 * 1000);
    const date = tpe.toISOString().slice(0, 10)          // YYYY-MM-DD
    const time = tpe.toISOString().slice(11, 16)         // HH:mm

    const sender = await getDisplayName(event.source.userId);

    try {
      await appendRecord(date, time, sender, record.customer, record.price);
      console.log(`✅ ${date} ${time} | ${sender} → ${record.customer} $${record.price.toLocaleString()}`);
    } catch (e) {
      console.error(`❌ Sheets error: ${e}`);
    }
  }
}

console.log(`✅ Listening on http://localhost:${server.port}/webhook`);
