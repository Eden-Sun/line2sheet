/**
 * LINE Rich Menu 設定腳本（兩欄版）
 * Usage: CHANNEL_ACCESS_TOKEN=xxx node scripts/setup-richmenu.mjs
 *
 * 版面：兩欄等寬
 *  [📦 記帳] [📋 最近紀錄]
 */

import { createCanvas, GlobalFonts } from "@napi-rs/canvas"
import { writeFileSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const __dir   = dirname(fileURLToPath(import.meta.url))
const TOKEN   = process.env.LINE_CHANNEL_ACCESS_TOKEN
const IMG_OUT = join(__dir, "richmenu.png")

if (!TOKEN) {
  console.error("❌ 請設定 LINE_CHANNEL_ACCESS_TOKEN 環境變數")
  process.exit(1)
}

// 載入 CJK 字體
GlobalFonts.registerFromPath(join(__dir, "fonts/NotoSansCJK-Bold.otf"), "NotoSansCJK")

// ── 1. 生成圖片 ─────────────────────────────────────────────────────────────
// LINE Rich Menu 標準尺寸 2500x843 (半螢幕)，兩欄等寬

// ── 向量 Icon 繪製 ────────────────────────────────────────────────────────────
// 每個 icon 接受 (ctx, cx, cy, size, color) 並自行繪製

function iconAdd(c, cx, cy, r, color) {
  // 圓框 + 十字（記帳）
  c.strokeStyle = color; c.lineWidth = r * 0.14; c.lineJoin = "round"
  c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.stroke()
  const arm = r * 0.55
  c.beginPath(); c.moveTo(cx, cy - arm); c.lineTo(cx, cy + arm)
  c.moveTo(cx - arm, cy); c.lineTo(cx + arm, cy); c.stroke()
}

function iconList(c, cx, cy, r, color) {
  // 三條橫線（最近紀錄）
  c.strokeStyle = color; c.lineWidth = r * 0.13; c.lineCap = "round"
  const w = r * 1.1, gap = r * 0.4
  for (let i = -1; i <= 1; i++) {
    const y = cy + i * gap
    c.beginPath(); c.moveTo(cx - w, y); c.lineTo(cx + w, y); c.stroke()
  }
}

function drawImage() {
  const W = 2500, H = 843
  const COL = Math.round(W / 2)  // 兩欄
  const canvas = createCanvas(W, H)
  const c = canvas.getContext("2d")

  const ICON_R = 130  // 圖標大一點（兩欄空間更大）
  const PAD_X  = 40   // 欄間距（水平）
  const PAD_Y  = 28   // 上下邊距
  const RADIUS = 36   // 圓角
  const STEP   = 22   // 3D 底座厚度

  // ── 深色底板 ──────────────────────────────────────────────────────────────
  c.fillStyle = "#081510"
  c.fillRect(0, 0, W, H)

  const cols = [
    { label: "記帳",     sub: "點選開始記帳",  drawIcon: iconAdd,  accent: true  },
    { label: "最近紀錄", sub: "查看最近 5 筆", drawIcon: iconList, accent: false },
  ]

  const ICON_CY  = H * 0.36
  const LABEL_CY = ICON_CY + ICON_R + 100
  const SUB_CY   = LABEL_CY + 115

  cols.forEach(({ label, sub, drawIcon, accent }, i) => {
    const BX = i * COL + PAD_X
    const BY = PAD_Y
    const BW = COL - PAD_X * 2
    const BH = H - PAD_Y * 2 - STEP
    const cx = i * COL + COL / 2

    // ── 1. 外部 drop shadow ───────────────────────────────────────────────
    c.fillStyle = "rgba(0,0,0,0.6)"
    c.beginPath()
    c.roundRect(BX + 8, BY + STEP + 14, BW, BH, RADIUS + 2)
    c.fill()

    // ── 2. 底座「ledge」────────────────────────────────────────────────────
    c.fillStyle = accent ? "#065a24" : "#054d1e"
    c.beginPath()
    c.roundRect(BX, BY + STEP, BW, BH, RADIUS)
    c.fill()

    // ── 3. 按鈕主體 ────────────────────────────────────────────────────────
    const grad = c.createLinearGradient(BX, BY, BX, BY + BH)
    if (accent) {
      grad.addColorStop(0,   "#52ec8e")
      grad.addColorStop(0.3, "#22cc5e")
      grad.addColorStop(0.7, "#17a84a")
      grad.addColorStop(1,   "#0d7a34")
    } else {
      grad.addColorStop(0,   "#3de07a")
      grad.addColorStop(0.3, "#18be50")
      grad.addColorStop(0.7, "#10993e")
      grad.addColorStop(1,   "#096d2c")
    }
    c.fillStyle = grad
    c.beginPath()
    c.roundRect(BX, BY, BW, BH, RADIUS)
    c.fill()

    // ── 4. 頂部光澤 ────────────────────────────────────────────────────────
    const sheen = c.createLinearGradient(BX, BY, BX, BY + BH * 0.42)
    sheen.addColorStop(0, "rgba(255,255,255,0.32)")
    sheen.addColorStop(0.5,"rgba(255,255,255,0.08)")
    sheen.addColorStop(1, "rgba(255,255,255,0.00)")
    c.fillStyle = sheen
    c.beginPath()
    c.roundRect(BX, BY, BW, BH, RADIUS)
    c.fill()

    // ── 5. 頂邊高光線 ──────────────────────────────────────────────────────
    c.strokeStyle = "rgba(255,255,255,0.55)"
    c.lineWidth = 4
    c.beginPath()
    c.roundRect(BX + 3, BY + 3, BW - 6, BH - 6, RADIUS - 1)
    c.stroke()

    // ── 6. 底部暗化 ────────────────────────────────────────────────────────
    const fade = c.createLinearGradient(BX, BY + BH * 0.65, BX, BY + BH)
    fade.addColorStop(0, "rgba(0,0,0,0.00)")
    fade.addColorStop(1, "rgba(0,0,0,0.30)")
    c.fillStyle = fade
    c.beginPath()
    c.roundRect(BX, BY, BW, BH, RADIUS)
    c.fill()

    // ── 7. ledge 交接線 ────────────────────────────────────────────────────
    c.strokeStyle = "rgba(0,0,0,0.45)"
    c.lineWidth = 6
    c.beginPath()
    c.moveTo(BX + RADIUS, BY + BH)
    c.lineTo(BX + BW - RADIUS, BY + BH)
    c.stroke()

    // ── Icon ──────────────────────────────────────────────────────────────
    drawIcon(c, cx, ICON_CY, ICON_R, "rgba(255,255,255,0.95)")

    // ── 主標籤 ────────────────────────────────────────────────────────────
    c.textAlign = "center"
    c.shadowColor = "rgba(0,0,0,0.4)"
    c.shadowBlur  = 12
    c.shadowOffsetY = 4
    c.fillStyle = "#ffffff"
    c.font = `bold ${accent ? 140 : 128}px NotoSansCJK`
    c.fillText(label, cx, LABEL_CY)

    // ── 副標籤 ────────────────────────────────────────────────────────────
    c.shadowBlur = 6; c.shadowOffsetY = 2
    c.fillStyle = "rgba(255,255,255,0.78)"
    c.font = "72px NotoSansCJK"
    c.fillText(sub, cx, SUB_CY)

    c.shadowColor = "transparent"; c.shadowBlur = 0; c.shadowOffsetY = 0
  })

  return canvas.toBuffer("image/png")
}

// ── 2. LINE Rich Menu API ────────────────────────────────────────────────────

async function lineAPI(method, path, body, raw) {
  const headers = { Authorization: `Bearer ${TOKEN}` }
  if (raw) {
    headers["Content-Type"] = "image/png"
  } else if (body) {
    headers["Content-Type"] = "application/json"
  }
  const fetchBody = raw ?? (body ? JSON.stringify(body) : undefined)
  if (method === "POST" && !fetchBody) {
    headers["Content-Length"] = "0"
  }
  const baseUrl = raw ? "https://api-data.line.me" : "https://api.line.me"
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: fetchBody,
  })
  const text = await res.text()
  try { return JSON.parse(text) } catch { return text }
}

// ── 3. 主流程 ────────────────────────────────────────────────────────────────

async function main() {
  console.log("🎨 生成 Rich Menu 圖片（兩欄版）...")
  const imgBuf = drawImage()
  writeFileSync(IMG_OUT, imgBuf)
  console.log(`✅ 圖片儲存：${IMG_OUT}`)

  console.log("\n🗑  刪除舊 Rich Menu...")
  const existing = await lineAPI("GET", "/v2/bot/richmenu/list")
  if (existing.richmenus?.length) {
    for (const m of existing.richmenus) {
      await lineAPI("DELETE", `/v2/bot/richmenu/${m.richMenuId}`)
      console.log(`  已刪：${m.richMenuId}`)
    }
  }

  const W = 2500, H = 843
  const COL = Math.round(W / 2)  // 兩欄

  console.log("\n📤 建立 Rich Menu（兩欄版）...")
  const menu = await lineAPI("POST", "/v2/bot/richmenu", {
    size: { width: W, height: H },
    selected: true,
    name: "記帳選單 v3",
    chatBarText: "📦 記帳 / 查詢",
    areas: [
      {
        bounds: { x: 0,       y: 0, width: COL, height: H },
        action: { type: "postback", label: "記帳", data: "a=start" },
      },
      {
        bounds: { x: COL,     y: 0, width: W - COL, height: H },
        action: { type: "postback", label: "最近紀錄", data: "a=recent" },
      },
    ],
  })

  if (!menu.richMenuId) {
    console.error("❌ 建立失敗：", menu)
    process.exit(1)
  }
  console.log(`✅ Rich Menu ID: ${menu.richMenuId}`)

  console.log("\n📸 上傳圖片...")
  const uploadRes = await lineAPI(
    "POST",
    `/v2/bot/richmenu/${menu.richMenuId}/content`,
    null,
    imgBuf,
  )
  console.log("上傳結果：", uploadRes || "OK")

  console.log("\n🌍 設為預設選單...")
  await lineAPI("POST", `/v2/bot/user/all/richmenu/${menu.richMenuId}`)

  console.log(`\n🎉 完成！Rich Menu ID: ${menu.richMenuId}`)
  console.log("兩欄版：📦 記帳（開表單）｜ 📋 最近紀錄")
}

main().catch(e => { console.error("❌", e.message); process.exit(1) })
