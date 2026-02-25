import { createHmac, timingSafeEqual } from "crypto";
import { google } from "googleapis";

const PORT = Number(process.env.PORT) || 3000;
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET!;
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN!;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID!;
const SHEET_NAME = process.env.SHEET_NAME ?? "Sheet1";

// ── Startup check ──────────────────────────────────────────────────────────

for (const [k, v] of Object.entries({
  LINE_CHANNEL_SECRET: CHANNEL_SECRET,
  LINE_CHANNEL_ACCESS_TOKEN: CHANNEL_ACCESS_TOKEN,
  SPREADSHEET_ID,
  GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_APPLICATION_CREDENTIALS,
})) {
  if (!v) { console.error(`❌ Missing env: ${k}`); process.exit(1); }
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

// Cache display names to avoid repeated API calls
const _nameCache = new Map<string, string>();

async function getDisplayName(userId: string): Promise<string> {
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

async function appendRow(
  timestamp: string,
  username: string,
  text: string,
  source: string,
): Promise<void> {
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:D`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[timestamp, username, source, text]] },
  });
}

// ── LINE event types ───────────────────────────────────────────────────────

interface LineSource {
  type: "user" | "group" | "room";
  userId: string;
  groupId?: string;
  roomId?: string;
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

    // Health check
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

    // Process events async — return OK to LINE immediately (5s timeout)
    processEvents(events).catch(e => console.error("processEvents error:", e));

    return new Response("OK");
  },
});

async function processEvents(events: LineEvent[]): Promise<void> {
  for (const event of events) {
    if (event.type !== "message" || event.message?.type !== "text") continue;

    const timestamp = new Date(event.timestamp).toISOString();
    const userId = event.source.userId;
    const text = event.message.text;

    // Source label: user / group:groupId / room:roomId
    const sourceLabel =
      event.source.type === "group"
        ? `group:${event.source.groupId ?? "?"}`
        : event.source.type === "room"
          ? `room:${event.source.roomId ?? "?"}`
          : "user";

    const username = await getDisplayName(userId);

    try {
      await appendRow(timestamp, username, text, sourceLabel);
      console.log(`✅ [${timestamp}] ${sourceLabel} | ${username}: ${text}`);
    } catch (e) {
      console.error(`❌ Sheets error: ${e}`);
    }
  }
}

console.log(`✅ Listening on http://localhost:${server.port}/webhook`);
