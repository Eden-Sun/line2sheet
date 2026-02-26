/**
 * LINE Rich Menu 設定腳本
 * Usage: CHANNEL_ACCESS_TOKEN=xxx node scripts/setup-richmenu.mjs
 */

import { createCanvas, GlobalFonts } from "@napi-rs/canvas"
import { writeFileSync, existsSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const __dir   = dirname(fileURLToPath(import.meta.url))
const TOKEN   = process.env.LINE_CHANNEL_ACCESS_TOKEN
const IMG_OUT = join(__dir, "richmenu.png")

if (!TOKEN) {
  console.error("❌ 請設定 LINE_CHANNEL_ACCESS_TOKEN 環境變數")
  process.exit(1)
}

// ── 1. 生成圖片 ─────────────────────────────────────────────────────────────
// LINE Rich Menu 標準尺寸 2500x843 (半螢幕)
// 版面：左 2/3 = 記帳，右 1/3 = 查最近

function drawImage() {
  const W = 2500, H = 843
  const canvas = createCanvas(W, H)
  const c = canvas.getContext("2d")

  // 背景
  c.fillStyle = "#06c755"
  c.fillRect(0, 0, W, H)

  // 分隔線
  const divX = Math.round(W * 0.70)
  c.strokeStyle = "rgba(255,255,255,0.3)"
  c.lineWidth = 4
  c.beginPath(); c.moveTo(divX, 60); c.lineTo(divX, H - 60); c.stroke()

  // 左區塊（記帳）
  c.fillStyle = "rgba(255,255,255,0.12)"
  c.beginPath()
  c.roundRect(30, 30, divX - 60, H - 60, 28)
  c.fill()

  // 右區塊（最近紀錄）
  c.fillStyle = "rgba(255,255,255,0.08)"
  c.beginPath()
  c.roundRect(divX + 30, 30, W - divX - 60, H - 60, 28)
  c.fill()

  // 左：大圖示 + 文字
  c.textAlign = "center"
  c.fillStyle = "#ffffff"
  c.font = "bold 280px sans-serif"
  c.fillText("＋", divX / 2, 440)

  c.font = "bold 120px sans-serif"
  c.fillText("記帳", divX / 2, 640)

  // 右：圖示 + 文字
  const rx = divX + (W - divX) / 2
  c.font = "bold 200px sans-serif"
  c.fillText("☰", rx, 430)

  c.font = "bold 100px sans-serif"
  c.fillText("最近紀錄", rx, 640)

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
  const res = await fetch(`https://api.line.me${path}`, {
    method,
    headers,
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  })
  const text = await res.text()
  try { return JSON.parse(text) } catch { return text }
}

// ── 3. 主流程 ────────────────────────────────────────────────────────────────

async function main() {
  console.log("🎨 生成 Rich Menu 圖片...")
  const imgBuf = drawImage()
  writeFileSync(IMG_OUT, imgBuf)
  console.log(`✅ 圖片儲存：${IMG_OUT}`)

  console.log("\n📤 建立 Rich Menu...")
  const W = 2500, H = 843
  const divX = Math.round(W * 0.70)

  const menu = await lineAPI("POST", "/v2/bot/richmenu", {
    size: { width: W, height: H },
    selected: true,
    name: "記帳選單",
    chatBarText: "📦 記帳",
    areas: [
      {
        bounds: { x: 0, y: 0, width: divX, height: H },
        action: { type: "postback", label: "記帳", data: "a=start" },
      },
      {
        bounds: { x: divX, y: 0, width: W - divX, height: H },
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
  const defaultRes = await lineAPI(
    "POST",
    `/v2/bot/user/all/richmenu/${menu.richMenuId}`,
  )
  console.log("設定結果：", defaultRes || "OK")

  console.log(`\n🎉 完成！Rich Menu ID: ${menu.richMenuId}`)
  console.log("打開 LINE 對話就能看到底部的記帳選單了。")
}

main().catch(e => { console.error("❌", e.message); process.exit(1) })
