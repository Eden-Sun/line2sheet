import type { VercelRequest, VercelResponse } from "@vercel/node"
import { google } from "googleapis"

const FORM_TOKEN = process.env.FORM_TOKEN ?? ""
const SPREADSHEET_ID = process.env.SPREADSHEET_ID
const SHEET_ROSTER = process.env.SHEET_ROSTER?.trim() || "名單"
const SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON

async function getNickname(userId: string): Promise<string | null> {
  if (!SERVICE_ACCOUNT_JSON || !SPREADSHEET_ID) return null
  try {
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(SERVICE_ACCOUNT_JSON),
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    })
    const sheets = google.sheets({ version: "v4", auth })
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_ROSTER}!A:B`,
    })
    const row = (res.data.values ?? []).find(r => r[0]?.trim() === userId)
    return row?.[1]?.trim() || null
  } catch {
    return null
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const userId = (req.query.userId as string) || ""
  const nickname = userId ? await getNickname(userId) : null
  const senderValue = nickname || ""
  const senderReadonly = nickname ? "readonly" : ""
  const senderStyle = nickname ? "style=\"background:#f2f2f7;color:#8e8e93;\"" : ""
  
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
  .customer-field{position:relative}
  .customer-control{flex:1;display:flex;align-items:center;gap:8px;min-width:0}
  .customer-control input{text-align:left}
  .pick-btn{border:none;background:#eaf9ef;color:var(--green-dark);font-size:14px;font-weight:700;padding:10px 12px;border-radius:10px;cursor:pointer;flex:0 0 auto;display:none}
  .pick-btn:active{transform:scale(.98)}
  .js .pick-btn{display:block}
  .js #customer{cursor:pointer}
  .customer-picker{position:fixed;inset:0;z-index:120;display:none}
  .customer-picker.open{display:block}
  .customer-picker-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.24);opacity:0;transition:opacity .22s}
  .customer-picker-panel{position:absolute;left:0;right:0;bottom:0;max-height:min(76dvh,640px);background:#fff;border-radius:20px 20px 0 0;padding:14px 14px calc(20px + env(safe-area-inset-bottom));transform:translateY(20px);opacity:0;transition:transform .24s ease,opacity .24s ease;display:flex;flex-direction:column;gap:10px}
  .customer-picker.open .customer-picker-backdrop{opacity:1}
  .customer-picker.open .customer-picker-panel{transform:translateY(0);opacity:1}
  .picker-head{display:flex;align-items:center;justify-content:space-between;padding:2px 4px}
  .picker-title{font-size:16px;font-weight:700;color:var(--text)}
  .picker-close{border:none;background:#f2f2f7;color:var(--text);font-size:14px;font-weight:600;padding:8px 12px;border-radius:10px;cursor:pointer}
  .picker-search{border:1px solid var(--border);border-radius:12px;padding:12px 14px;font-size:16px;outline:none}
  .picker-search:focus{border-color:var(--green);box-shadow:0 0 0 3px rgba(6,199,85,.12)}
  .picker-list{overflow:auto;padding:2px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
  .picker-card{border:1px solid var(--border);background:#fff;border-radius:12px;min-height:52px;padding:10px 8px;font-size:14px;font-weight:600;color:var(--text);text-align:center;cursor:pointer;transition:all .15s;word-break:break-word}
  .picker-card:active{transform:scale(.97)}
  .picker-card.selected{background:#eaf9ef;border-color:var(--green);color:var(--green-dark)}
  .picker-empty{grid-column:1 / -1;padding:16px 8px;text-align:center;color:var(--sub);font-size:14px}
  @media (min-width:640px){
    .picker-list{grid-template-columns:repeat(4,minmax(0,1fr))}
  }
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
  <form id="record-form" method="POST" action="/api/record">
    <input type="hidden" name="token" value="${FORM_TOKEN}" />
    <div class="card">
      <div class="field">
        <label>姓名</label>
        <input id="sender" name="sender" type="text" placeholder="你的名字" autocomplete="off" value="${senderValue}" ${senderReadonly} ${senderStyle} />
      </div>
      <div class="field">
        <label>客戶</label>
        <div class="customer-control">
          <input id="customer" name="customer" type="text" placeholder="客戶名稱" autocomplete="off" list="customer-list" />
          <button class="pick-btn" id="pick-open" type="button" aria-label="開啟客戶選單">選擇</button>
        </div>
        <datalist id="customer-list"></datalist>
      </div>
      <div class="field">
        <label>金額</label>
        <input id="amount" name="amount" type="number" placeholder="0" inputmode="decimal" min="1" />
        <span class="prefix">元</span>
      </div>
    </div>
    <button class="btn" id="btn" type="submit">送出記帳</button>
  </form>

  <div style="height:24px"></div>
  <div class="section-title">最近紀錄</div>
  <div id="recent-wrap">
    <div class="recent-list"><div class="empty">載入中…</div></div>
  </div>
</main>

<div class="customer-picker" id="customer-picker" aria-hidden="true">
  <div class="customer-picker-backdrop" id="picker-backdrop"></div>
  <div class="customer-picker-panel" role="dialog" aria-modal="true" aria-label="客戶選單">
    <div class="picker-head">
      <div class="picker-title">選擇客戶</div>
      <button type="button" class="picker-close" id="picker-close">關閉</button>
    </div>
    <input id="picker-search" class="picker-search" type="text" placeholder="搜尋客戶名稱" autocomplete="off" />
    <div class="picker-list" id="picker-list"></div>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
document.documentElement.classList.add('js')
const TOKEN = "${FORM_TOKEN}"
const API   = "/api/record"
const CUSTOMER_API = "/api/customers"

// ── localStorage helpers ─────────────────────────────────────
function save(k,v){ try{localStorage.setItem(k,JSON.stringify(v))}catch(_){} }
function load(k,d){ try{return JSON.parse(localStorage.getItem(k)??'null')??d}catch(_){return d} }
function esc(s){ return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])) }

// ── Init ─────────────────────────────────────────────────────
const $form     = document.getElementById('record-form')
const $sender   = document.getElementById('sender')
const $customer = document.getElementById('customer')
const $amount   = document.getElementById('amount')
const $btn      = document.getElementById('btn')
const $pickOpen = document.getElementById('pick-open')
const $picker = document.getElementById('customer-picker')
const $pickerBackdrop = document.getElementById('picker-backdrop')
const $pickerClose = document.getElementById('picker-close')
const $pickerSearch = document.getElementById('picker-search')
const $pickerList = document.getElementById('picker-list')
const $datalist = document.getElementById('customer-list')

let localRecords = load('session_records', [])
let customerRecentAmounts = load('customer_recent_amounts', {})

$sender.value = load('sender','') || "${senderValue}"
if ("${senderValue}") $sender.setAttribute('readonly', true)
$customer.value = load('last_customer','')
$customer.setAttribute('readonly', 'readonly')
let remoteCustomers = []
let allCustomers = []
let pickerOpen = false

function uniqueCustomers(items){
  const seen = new Set()
  const out = []
  for(const item of items){
    const name = String(item ?? '').trim()
    if(!name || seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out
}

function rememberAmount(customer, amount){
  const name = String(customer ?? '').trim()
  const num = Number(amount)
  if(!name || !Number.isFinite(num) || num <= 0) return
  const prev = Array.isArray(customerRecentAmounts[name]) ? customerRecentAmounts[name] : []
  customerRecentAmounts[name] = [num, ...prev.filter(v => v !== num)].slice(0, 3)
  save('customer_recent_amounts', customerRecentAmounts)
}

function seedRecentAmounts(){
  for(const r of localRecords){
    rememberAmount(r.customer, r.amount)
  }
}
seedRecentAmounts()

function prefillAmount(customer){
  const amounts = customerRecentAmounts[String(customer ?? '').trim()] ?? []
  if(amounts.length){
    $amount.value = String(amounts[0])
  }
}

function getAllCustomers(){
  const recents = load('customers',[])
  return uniqueCustomers([...recents, ...remoteCustomers])
}

function refreshDatalist(){
  allCustomers = getAllCustomers()
  $datalist.innerHTML = allCustomers.map(c=>\`<option value="\${esc(c)}">\`).join('')
}

function selectCustomer(name){
  const customer = String(name ?? '').trim()
  if(!customer) return
  $customer.value = customer
  save('last_customer', customer)
  prefillAmount(customer)
  closePicker()
  $amount.focus()
}

function renderPickerList(){
  const query = $pickerSearch.value.trim()
  const q = query.toLowerCase()
  const list = !q ? allCustomers : allCustomers.filter(name => name.toLowerCase().includes(q))

  $pickerList.innerHTML = ''

  if(query && !allCustomers.includes(query)){
    const custom = document.createElement('button')
    custom.type = 'button'
    custom.className = 'picker-card'
    custom.textContent = '使用「' + query + '」'
    custom.addEventListener('click', () => selectCustomer(query))
    $pickerList.appendChild(custom)
  }

  if(!list.length && !query){
    const empty = document.createElement('div')
    empty.className = 'picker-empty'
    empty.textContent = '尚無客戶資料'
    $pickerList.appendChild(empty)
    return
  }

  if(!list.length && query){
    const empty = document.createElement('div')
    empty.className = 'picker-empty'
    empty.textContent = '找不到符合的客戶'
    $pickerList.appendChild(empty)
    return
  }

  const selected = $customer.value.trim()
  for(const name of list){
    const card = document.createElement('button')
    card.type = 'button'
    card.className = 'picker-card' + (name === selected ? ' selected' : '')
    card.textContent = name
    card.addEventListener('click', () => selectCustomer(name))
    $pickerList.appendChild(card)
  }
}

function openPicker(){
  if(pickerOpen) return
  pickerOpen = true
  $picker.classList.add('open')
  $picker.setAttribute('aria-hidden', 'false')
  $pickerSearch.value = ''
  renderPickerList()
  document.body.style.overflow = 'hidden'
  setTimeout(() => $pickerSearch.focus(), 10)
}

function closePicker(){
  if(!pickerOpen) return
  pickerOpen = false
  $picker.classList.remove('open')
  $picker.setAttribute('aria-hidden', 'true')
  document.body.style.overflow = ''
}
refreshDatalist()

async function fetchCustomers(){
  try{
    const r = await fetch(CUSTOMER_API)
    if(!r.ok) throw new Error('HTTP ' + r.status)
    const data = await r.json()
    remoteCustomers = Array.isArray(data) ? data : []
  }catch(e){
    console.error('load customers failed', e)
    remoteCustomers = []
  }finally{
    refreshDatalist()
    renderPickerList()
  }
}
fetchCustomers()

$pickOpen.addEventListener('click', openPicker)
$customer.addEventListener('click', openPicker)
$pickerClose.addEventListener('click', closePicker)
$pickerBackdrop.addEventListener('click', closePicker)
$pickerSearch.addEventListener('input', renderPickerList)

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

    toast(\`✅ \${customer} $\${(+amount).toLocaleString()} 已記帳！\`)
    save('sender', sender)
    save('last_customer','')
    rememberAmount(customer, +amount)

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
function addLocalRecent(r){
  localRecords = [r, ...localRecords].slice(0,20)
  save('session_records', localRecords)
  rememberAmount(r.customer, r.amount)
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

renderRecent()

// ── Keyboard ─────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if(e.key === 'Escape' && pickerOpen){
    closePicker()
    $customer.focus()
  }
})

$form.addEventListener('submit', async (e) => {
  e.preventDefault()
  await submit()
})
</script>
</body>
</html>`)
}
