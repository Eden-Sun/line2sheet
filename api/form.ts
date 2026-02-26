import type { VercelRequest, VercelResponse } from "@vercel/node"

const FORM_TOKEN = process.env.FORM_TOKEN ?? ""

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader("Content-Type", "text/html; charset=utf-8")
  res.send(`<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="記帳">
<meta name="theme-color" content="#06c755">
<title>出貨記帳</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  :root{--green:#06c755;--green-dark:#05a847;--bg:#f2f2f7;--card:#fff;--text:#1c1c1e;--sub:#8e8e93;--border:#e5e5ea}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:var(--bg);min-height:100dvh;padding-bottom:env(safe-area-inset-bottom)}
  .header{background:var(--green);color:#fff;padding:16px 20px 14px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:10}
  .header h1{font-size:18px;font-weight:700;letter-spacing:.3px}
  .header .icon{font-size:22px}
  main{padding:16px}
  .card{background:var(--card);border-radius:14px;overflow:hidden;margin-bottom:16px;box-shadow:0 1px 4px rgba(0,0,0,.07)}
  .field{padding:12px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px}
  .field:last-child{border-bottom:none}
  .field label{font-size:15px;color:var(--text);min-width:72px;font-weight:500}
  .field input,.field select{flex:1;border:none;outline:none;font-size:16px;color:var(--text);background:transparent;text-align:right;min-width:0}
  .field input::placeholder{color:var(--sub)}
  .field .prefix{color:var(--sub);font-size:16px;margin-left:4px}
  datalist option{font-size:15px}
  .btn{display:block;width:100%;padding:15px;border:none;border-radius:14px;background:var(--green);color:#fff;font-size:17px;font-weight:700;cursor:pointer;transition:background .15s,transform .1s}
  .btn:active{background:var(--green-dark);transform:scale(.98)}
  .btn:disabled{background:#ccc;cursor:not-allowed;transform:none}
  /* toast */
  .toast{position:fixed;bottom:calc(24px + env(safe-area-inset-bottom));left:50%;transform:translateX(-50%) translateY(20px);background:#1c1c1e;color:#fff;padding:12px 20px;border-radius:12px;font-size:15px;font-weight:500;opacity:0;transition:opacity .25s,transform .25s;pointer-events:none;white-space:nowrap;z-index:100}
  .toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
  .toast.error{background:#ff3b30}
  /* recent */
  .section-title{font-size:13px;font-weight:600;color:var(--sub);padding:0 4px 8px;letter-spacing:.5px;text-transform:uppercase}
  .recent-list{background:var(--card);border-radius:14px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.07)}
  .recent-item{display:flex;align-items:center;padding:12px 16px;border-bottom:1px solid var(--border);gap:12px}
  .recent-item:last-child{border-bottom:none}
  .recent-meta{flex:1;min-width:0}
  .recent-customer{font-size:15px;font-weight:600;color:var(--text)}
  .recent-info{font-size:12px;color:var(--sub);margin-top:2px}
  .recent-amount{font-size:17px;font-weight:700;color:var(--green)}
  .empty{text-align:center;color:var(--sub);font-size:14px;padding:24px}
  .loading-bar{height:2px;background:linear-gradient(90deg,var(--green) 0%,transparent 100%);background-size:200%;animation:slide 1s linear infinite}
  @keyframes slide{0%{background-position:100%}100%{background-position:-100%}}
</style>
</head>
<body>

<div class="header">
  <span class="icon">📦</span>
  <h1>出貨記帳</h1>
</div>

<main>
  <div class="card">
    <div class="field">
      <label>姓名</label>
      <input id="sender" type="text" placeholder="你的名字" autocomplete="off" />
    </div>
    <div class="field">
      <label>客戶</label>
      <input id="customer" type="text" placeholder="客戶名稱" autocomplete="off" list="customer-list" />
      <datalist id="customer-list"></datalist>
    </div>
    <div class="field">
      <label>金額</label>
      <input id="amount" type="number" placeholder="0" inputmode="decimal" min="1" />
      <span class="prefix">元</span>
    </div>
  </div>

  <button class="btn" id="btn" onclick="submit()">送出記帳</button>

  <div style="height:24px"></div>
  <div class="section-title">最近紀錄</div>
  <div id="recent-wrap">
    <div class="recent-list"><div class="empty">載入中…</div></div>
  </div>
</main>

<div class="toast" id="toast"></div>

<script>
const TOKEN = "${FORM_TOKEN}"
const API   = "/api/record"

// ── localStorage helpers ─────────────────────────────────────
function save(k,v){ try{localStorage.setItem(k,JSON.stringify(v))}catch(_){} }
function load(k,d){ try{return JSON.parse(localStorage.getItem(k)??'null')??d}catch(_){return d} }

// ── Init ─────────────────────────────────────────────────────
const $sender   = document.getElementById('sender')
const $customer = document.getElementById('customer')
const $amount   = document.getElementById('amount')
const $btn      = document.getElementById('btn')

$sender.value = load('sender','')
$customer.value = load('last_customer','')

// Populate customer datalist from recents
function refreshDatalist(){
  const recents = load('customers',[])
  const dl = document.getElementById('customer-list')
  dl.innerHTML = recents.map(c=>\`<option value="\${c}">\`).join('')
}
refreshDatalist()

// ── Toast ────────────────────────────────────────────────────
function toast(msg, isError=false){
  const el = document.getElementById('toast')
  el.textContent = msg
  el.className = 'toast show' + (isError?' error':'')
  clearTimeout(toast._t)
  toast._t = setTimeout(()=>el.classList.remove('show'), 2400)
}

// ── Submit ───────────────────────────────────────────────────
async function submit(){
  const sender   = $sender.value.trim()
  const customer = $customer.value.trim()
  const amount   = $amount.value.trim()

  if(!sender)   { toast('請填寫姓名', true); $sender.focus(); return }
  if(!customer) { toast('請填寫客戶名稱', true); $customer.focus(); return }
  if(!amount || isNaN(+amount) || +amount <= 0)
                { toast('請填寫正確金額', true); $amount.focus(); return }

  $btn.disabled = true
  $btn.textContent = '送出中…'

  try {
    const r = await fetch(API, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ token:TOKEN, sender, customer, amount:+amount })
    })
    const data = await r.json()
    if(!data.ok) throw new Error(data.error ?? '未知錯誤')

    toast(\`✅ \${customer} \${\${(+amount).toLocaleString()}} 已記帳！\`)
    save('sender', sender)
    save('last_customer','')

    // 儲存到 recent customers
    let prev = load('customers',[])
    prev = [customer, ...prev.filter(c=>c!==customer)].slice(0,10)
    save('customers', prev)
    refreshDatalist()

    // 加到 local recent list
    addLocalRecent({ date:data.date, time:data.time, customer, name:sender, amount:+amount })

    $customer.value = ''
    $amount.value = ''
    $customer.focus()

  } catch(e){
    toast('送出失敗：' + e.message, true)
  } finally {
    $btn.disabled = false
    $btn.textContent = '送出記帳'
  }
}

// ── Recent records (local session cache) ─────────────────────
let localRecords = load('session_records', [])

function addLocalRecent(r){
  localRecords = [r, ...localRecords].slice(0,20)
  save('session_records', localRecords)
  renderRecent()
}

function renderRecent(){
  const wrap = document.getElementById('recent-wrap')
  if(!localRecords.length){
    wrap.innerHTML = '<div class="recent-list"><div class="empty">今日尚無紀錄</div></div>'
    return
  }
  wrap.innerHTML = '<div class="recent-list">' +
    localRecords.map(r=>\`
    <div class="recent-item">
      <div class="recent-meta">
        <div class="recent-customer">\${esc(r.customer)}</div>
        <div class="recent-info">\${esc(r.name)} · \${r.date} \${r.time}</div>
      </div>
      <div class="recent-amount">$\${(+r.amount).toLocaleString()}</div>
    </div>\`).join('') +
  '</div>'
}

function esc(s){ return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])) }

renderRecent()

// ── Keyboard ─────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if(e.key === 'Enter' && !e.shiftKey) submit()
})
</script>
</body>
</html>`)
}
