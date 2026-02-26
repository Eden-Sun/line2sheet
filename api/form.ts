import type { VercelRequest, VercelResponse } from "@vercel/node"

const LIFF_ID = process.env.LIFF_ID ?? ""

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader("Content-Type", "text/html; charset=utf-8")
  res.send(`<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
  <title>出貨記帳</title>
  <script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f0f0f0;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 24px 16px;
    }
    h1 {
      color: #06c755;
      font-size: 22px;
      font-weight: 700;
      margin-bottom: 20px;
      letter-spacing: 0.5px;
    }
    .card {
      background: white;
      border-radius: 16px;
      padding: 24px;
      width: 100%;
      max-width: 400px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.08);
    }
    .field { margin-bottom: 20px; }
    label {
      display: block;
      font-size: 13px;
      font-weight: 600;
      color: #555;
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    input {
      width: 100%;
      padding: 14px 16px;
      border: 2px solid #e8e8e8;
      border-radius: 10px;
      font-size: 17px;
      outline: none;
      transition: border-color 0.2s;
      color: #222;
    }
    input:focus { border-color: #06c755; }
    input::placeholder { color: #bbb; }
    #amount { font-size: 20px; font-weight: 600; }
    .prefix {
      position: relative;
    }
    .prefix span {
      position: absolute;
      left: 16px;
      top: 50%;
      transform: translateY(-50%);
      font-size: 20px;
      font-weight: 600;
      color: #999;
    }
    .prefix input { padding-left: 32px; }
    button {
      width: 100%;
      padding: 16px;
      background: #06c755;
      color: white;
      border: none;
      border-radius: 12px;
      font-size: 17px;
      font-weight: 700;
      cursor: pointer;
      transition: background 0.15s, transform 0.1s;
      margin-top: 4px;
    }
    button:active { background: #05a847; transform: scale(0.98); }
    button:disabled { background: #ccc; cursor: not-allowed; transform: none; }
    #status {
      margin-top: 14px;
      text-align: center;
      font-size: 14px;
      color: #888;
      min-height: 20px;
    }
    #status.error { color: #e53e3e; }
    #status.success { color: #06c755; font-weight: 600; }
  </style>
</head>
<body>
  <h1>📦 出貨記帳</h1>
  <div class="card">
    <div class="field">
      <label>客戶名稱</label>
      <input type="text" id="customer" placeholder="例：台北科技" autocomplete="off" />
    </div>
    <div class="field">
      <label>金額</label>
      <div class="prefix">
        <span>$</span>
        <input type="number" id="amount" placeholder="14600" inputmode="numeric" min="1" />
      </div>
    </div>
    <button id="btn" onclick="submitForm()">送出記帳</button>
    <div id="status"></div>
  </div>

  <script>
    const LIFF_ID = "${LIFF_ID}"

    liff.init({ liffId: LIFF_ID }).then(() => {
      if (!liff.isInClient()) {
        setStatus("請在 LINE app 中開啟此頁面", "error")
        document.getElementById("btn").disabled = true
      }
    }).catch(e => {
      setStatus("初始化失敗：" + e.message, "error")
    })

    function setStatus(msg, type = "") {
      const el = document.getElementById("status")
      el.textContent = msg
      el.className = type
    }

    async function submitForm() {
      const customer = document.getElementById("customer").value.trim()
      const amount = document.getElementById("amount").value.trim()

      if (!customer) { setStatus("請填寫客戶名稱", "error"); return }
      if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
        setStatus("請填寫正確金額", "error"); return
      }

      const btn = document.getElementById("btn")
      btn.disabled = true
      btn.textContent = "送出中..."
      setStatus("")

      try {
        await liff.sendMessages([{
          type: "text",
          text: customer + " " + amount
        }])
        setStatus("✅ 已記帳！", "success")
        setTimeout(() => liff.closeWindow(), 800)
      } catch (e) {
        setStatus("送出失敗：" + e.message, "error")
        btn.disabled = false
        btn.textContent = "送出記帳"
      }
    }

    // Enter key to submit
    document.addEventListener("keydown", e => {
      if (e.key === "Enter") submitForm()
    })

    // Auto-focus customer field
    window.addEventListener("load", () => {
      setTimeout(() => document.getElementById("customer").focus(), 300)
    })
  </script>
</body>
</html>`)
}
