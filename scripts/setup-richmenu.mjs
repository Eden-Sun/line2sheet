/**
 * LINE Rich Menu 設定腳本
 * Usage: CHANNEL_ACCESS_TOKEN=xxx node scripts/setup-richmenu.mjs
 *
 * 版面：三欄等寬
 *  [📦 記帳] [📋 最近紀錄] [🔍 搜尋客戶]
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
// LINE Rich Menu 標準尺寸 2500x843 (半螢幕)，三欄等寬

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

function iconSearch(c, cx, cy, r, color) {
  // 放大鏡（圓圈 + 把手）
  c.strokeStyle = color; c.lineWidth = r * 0.13; c.lineCap = "round"
  const cr = r * 0.58
  const lx = cx - r * 0.18, ly = cy - r * 0.18   // 圓心偏左上
  c.beginPath(); c.arc(lx, ly, cr, 0, Math.PI * 2); c.stroke()
  // 把手（從右下角往右下延伸）
  const angle = Math.PI / 4
  const hx1 = lx + cr * Math.cos(angle), hy1 = ly + cr * Math.sin(angle)
  const hx2 = lx + (cr + r * 0.55) * Math.cos(angle)
  const hy2 = ly + (cr + r * 0.55) * Math.sin(angle)
  c.beginPath(); c.moveTo(hx1, hy1); c.lineTo(hx2, hy2); c.stroke()
}

function drawImage() {
  const W = 2500, H = 843
  const COL = Math.round(W / 3)
  const canvas = createCanvas(W, H)
  const c = canvas.getContext("2d")

  const ICON_R = 110
  const PAD_X  = 28   // 欄間距（水平）
  const PAD_Y  = 28   // 上下邊距
  const RADIUS = 36   // 圓角
  const STEP   = 22   // 3D 底座厚度（模擬物理按鍵深度）

  // ── 深色底板 ──────────────────────────────────────────────────────────────
  c.fillStyle = "#081510"
  c.fillRect(0, 0, W, H)

  const cols = [
    { label: "記帳",    sub: "點選開始記帳", drawIcon: iconAdd,    accent: true  },
    { label: "最近紀錄", sub: "查看最近 5 筆", drawIcon: iconList,   accent: false },
    { label: "搜尋客戶", sub: "快速找客戶",   drawIcon: iconSearch, accent: false },
  ]

  const ICON_CY  = H * 0.36
  const LABEL_CY = ICON_CY + ICON_R + 90
  const SUB_CY   = LABEL_CY + 105

  cols.forEach(({ label, sub, drawIcon, accent }, i) => {
    const BX = i * COL + PAD_X
    const BY = PAD_Y
    const BW = COL - PAD_X * 2
    const BH = H - PAD_Y * 2 - STEP   // 主體高度（留出底座空間）
    const cx = i * COL + COL / 2

    // ── 1. 外部 drop shadow（整體浮起感）──────────────────────────────────
    c.fillStyle = "rgba(0,0,0,0.6)"
    c.beginPath()
    c.roundRect(BX + 8, BY + STEP + 14, BW, BH, RADIUS + 2)
    c.fill()

    // ── 2. 底座「ledge」（3D 厚度，按鍵的「底邊」）─────────────────────────
    // 顏色比主體深 2 階
    c.fillStyle = accent ? "#065a24" : "#054d1e"
    c.beginPath()
    c.roundRect(BX, BY + STEP, BW, BH, RADIUS)
    c.fill()

    // ── 3. 按鈕主體（蓋在 ledge 上方，比 ledge 高 STEP px）─────────────────
    const grad = c.createLinearGradient(BX, BY, BX, BY + BH)
    if (accent) {
      grad.addColorStop(0,   "#52ec8e")   // 最亮頂
      grad.addColorStop(0.3, "#22cc5e")   // 主色
      grad.addColorStop(0.7, "#17a84a")
      grad.addColorStop(1,   "#0d7a34")   // 底部稍暗
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

    // ── 4. 頂部光澤（上半段白色反光層）─────────────────────────────────────
    const sheen = c.createLinearGradient(BX, BY, BX, BY + BH * 0.42)
    sheen.addColorStop(0, "rgba(255,255,255,0.32)")
    sheen.addColorStop(0.5,"rgba(255,255,255,0.08)")
    sheen.addColorStop(1, "rgba(255,255,255,0.00)")
    c.fillStyle = sheen
    c.beginPath()
    c.roundRect(BX, BY, BW, BH, RADIUS)
    c.fill()

    // ── 5. 頂邊高光線（1px 白色描邊 → 最亮邊緣）───────────────────────────
    c.strokeStyle = "rgba(255,255,255,0.55)"
    c.lineWidth = 4
    c.beginPath()
    c.roundRect(BX + 3, BY + 3, BW - 6, BH - 6, RADIUS - 1)
    c.stroke()

    // ── 6. 底部暗化（按鈕底邊接近 ledge 的漸層，增加厚度感）────────────────
    const fade = c.createLinearGradient(BX, BY + BH * 0.65, BX, BY + BH)
    fade.addColorStop(0, "rgba(0,0,0,0.00)")
    fade.addColorStop(1, "rgba(0,0,0,0.30)")
    c.fillStyle = fade
    c.beginPath()
    c.roundRect(BX, BY, BW, BH, RADIUS)
    c.fill()

    // ── 7. ledge 與主體交接線（凹槽感）──────────────────────────────────────
    c.strokeStyle = "rgba(0,0,0,0.45)"
    c.lineWidth = 6
    c.beginPath()
    // 只畫底部水平那一條線
    c.moveTo(BX + RADIUS, BY + BH)
    c.lineTo(BX + BW - RADIUS, BY + BH)
    c.stroke()

    // ── Icon ──────────────────────────────────────────────────────────────
    drawIcon(c, cx, ICON_CY, ICON_R, "rgba(255,255,255,0.95)")

    // ── 主標籤 ────────────────────────────────────────────────────────────
    c.textAlign = "center"
    // 文字陰影（讓字在亮綠上更清晰）
    c.shadowColor = "rgba(0,0,0,0.4)"
    c.shadowBlur  = 12
    c.shadowOffsetY = 4
    c.fillStyle = "#ffffff"
    c.font = `bold ${accent ? 120 : 108}px NotoSansCJK`
    c.fillText(label, cx, LABEL_CY)

    // ── 副標籤 ────────────────────────────────────────────────────────────
    c.shadowBlur = 6; c.shadowOffsetY = 2
    c.fillStyle = "rgba(255,255,255,0.78)"
    c.font = "64px NotoSansCJK"
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
  console.log("🎨 生成 Rich Menu 圖片（三欄版）...")
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
  const COL = Math.round(W / 3)

  console.log("\n📤 建立 Rich Menu...")
  const menu = await lineAPI("POST", "/v2/bot/richmenu", {
    size: { width: W, height: H },
    selected: true,
    name: "記帳選單 v2",
    chatBarText: "📦 記帳 / 查詢",
    areas: [
      {
        bounds: { x: 0,       y: 0, width: COL,       height: H },
        action: { type: "postback", label: "記帳",    data: "a=start" },
      },
      {
        bounds: { x: COL,     y: 0, width: COL,       height: H },
        action: { type: "postback", label: "最近紀錄", data: "a=recent" },
      },
      {
        bounds: { x: COL * 2, y: 0, width: W - COL * 2, height: H },
        action: {
          type: "postback", label: "搜尋客戶", data: "a=search_prompt",
          inputOption: "openKeyboard", fillInText: "搜尋客戶：",
        },
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
  console.log("三欄版：📦 記帳 ｜ 📋 最近紀錄 ｜ 🔍 搜尋客戶")
}

main().catch(e => { console.error("❌", e.message); process.exit(1) })
