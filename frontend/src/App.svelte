<script>
  import { onMount } from 'svelte'
  import CustomerSelect from './components/CustomerSelect.svelte'
  import AmountInput from './components/AmountInput.svelte'
  import RecentList from './components/RecentList.svelte'

  const CONFIG = window.__FORM_CONFIG__ || {}
  const TOKEN = CONFIG.token || ''
  const USER_ID = CONFIG.userId || ''

  // 姓名相關狀態
  let sender = ''
  let senderReadonly = false
  let isNameSetup = false
  let newName = ''
  let checkingName = true

  let customer = load('last_customer', '')
  let amount = ''
  let paymentStatus = ''
  let showValidation = false

  let remoteCustomers = []
  let storedCustomers = load('customers', [])
  let records = load('session_records', [])
  let recentAmounts = load('customer_recent_amounts', {})

  let customers = []
  let loading = false
  let notice = ''
  let error = false

  $: customers = dedupe([...storedCustomers, ...records.map((r) => r.customer), ...remoteCustomers])

  function dedupe(items) {
    const seen = new Set()
    const out = []
    for (const item of items) {
      const name = String(item || '').trim()
      if (!name || seen.has(name)) continue
      seen.add(name)
      out.push(name)
    }
    return out
  }

  function load(key, fallback) {
    try {
      const raw = localStorage.getItem(key)
      if (!raw) return fallback
      const parsed = JSON.parse(raw)
      return parsed ?? fallback
    } catch {
      return fallback
    }
  }

  function save(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // no-op
    }
  }

  // 檢查 UID 是否有對應名稱
  async function checkNameMapping() {
    if (!USER_ID) {
      // 沒有 UID，使用 localStorage 或手動輸入
      sender = load('sender', '') || CONFIG.senderValue || ''
      senderReadonly = Boolean(CONFIG.senderReadonly)
      isNameSetup = true
      checkingName = false
      return
    }

    try {
      const res = await fetch(`/api/roster?userId=${encodeURIComponent(USER_ID)}`)
      const data = await res.json()
      
      if (data.exists && data.name) {
        // 已有對應名稱
        sender = data.name
        senderReadonly = true
        isNameSetup = true
        save('sender', sender)
      } else {
        // 沒有對應，需要建立
        sender = ''
        senderReadonly = false
        isNameSetup = false
      }
    } catch (e) {
      console.error('檢查名稱失敗:', e)
      // 失敗時允許手動輸入
      sender = load('sender', '') || ''
      senderReadonly = false
      isNameSetup = true
    }
    checkingName = false
  }

  // 建立 UID-名稱對應
  async function setupName() {
    const name = newName.trim()
    if (!name) {
      toast('請輸入姓名', true)
      return
    }

    loading = true
    try {
      const res = await fetch(`/api/roster?userId=${encodeURIComponent(USER_ID)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      })
      
      const data = await res.json()
      
      if (res.ok || res.status === 409) {
        // 成功建立或已存在
        sender = data.name || name
        senderReadonly = true
        isNameSetup = true
        save('sender', sender)
        toast('✅ 姓名設定完成')
      } else {
        throw new Error(data.error || '設定失敗')
      }
    } catch (e) {
      console.error('設定名稱失敗:', e)
      // 失敗時仍允許繼續使用（只存 localStorage）
      sender = name
      senderReadonly = false
      isNameSetup = true
      save('sender', sender)
      toast('⚠️ 無法儲存到雲端，但可繼續使用', true)
    } finally {
      loading = false
    }
  }

  function rememberAmount(name, value) {
    const customerName = String(name || '').trim()
    const num = Number(value)
    if (!customerName || !Number.isFinite(num) || num <= 0) return

    const prev = Array.isArray(recentAmounts[customerName]) ? recentAmounts[customerName] : []
    recentAmounts = {
      ...recentAmounts,
      [customerName]: [num, ...prev.filter((n) => n !== num)].slice(0, 3)
    }
    save('customer_recent_amounts', recentAmounts)
  }

  function handleCustomerChange(event) {
    customer = typeof event.detail === 'string' ? event.detail : customer
    save('last_customer', customer.trim())
  }

  function handleCustomerSelect(event) {
    const name = String(event.detail || '').trim()
    if (!name) return

    customer = name
    save('last_customer', name)
    const options = Array.isArray(recentAmounts[name]) ? recentAmounts[name] : []
    if (options.length && !String(amount || '').trim()) amount = String(options[0])
  }

  function addRecentRecord(entry) {
    records = [entry, ...records].slice(0, 20)
    save('session_records', records)
    rememberAmount(entry.customer, entry.amount)
  }

  function toast(text, isError = false) {
    notice = text
    error = isError
    window.clearTimeout(toast.timer)
    toast.timer = window.setTimeout(() => {
      notice = ''
    }, 2600)
  }
  toast.timer = 0

  async function fetchCustomers() {
    loading = true
    try {
      const res = await fetch('/api/customers')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      remoteCustomers = Array.isArray(data) ? data : []
    } catch (e) {
      console.error('load customers failed', e)
      toast('客戶名單載入失敗', true)
      remoteCustomers = []
    } finally {
      loading = false
    }
  }

  async function submit(event) {
    event.preventDefault()

    const senderName = String(sender || '').trim()
    const customerName = String(customer || '').trim()
    const price = Number(amount)

    if (!senderName) {
      toast('請填寫姓名', true)
      return
    }
    if (!customerName) {
      toast('請填寫客戶名稱', true)
      return
    }
    if (!Number.isFinite(price) || price <= 0) {
      toast('請填寫正確金額', true)
      return
    }
    if (!paymentStatus) {
      showValidation = true
      toast('請選擇收款狀態', true)
      return
    }

    loading = true
    try {
      const res = await fetch('/api/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: TOKEN, sender: senderName, customer: customerName, amount: price, paymentStatus })
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error || '提交失敗')

      if (!senderReadonly) save('sender', senderName)
      save('last_customer', '')

      const entry = {
        date: data.date,
        time: data.time,
        name: senderName,
        customer: customerName,
        amount: price,
        paymentStatus
      }

      rememberAmount(customerName, price)
      addRecentRecord(entry)
      customer = ''
      amount = ''
      paymentStatus = ''
      showValidation = false
      toast(`✅ ${customerName} $${price.toLocaleString()} 已記帳`)
    } catch (e) {
      toast(`送出失敗：${e.message || '未知錯誤'}`, true)
    } finally {
      loading = false
    }
  }

  onMount(() => {
    records.forEach((r) => rememberAmount(r.customer, r.amount))
    checkNameMapping()
    fetchCustomers()
  })
</script>

<div class="page">
  <header>
    <h1>出貨記帳</h1>
  </header>

  <main>
    {#if checkingName}
      <div class="loading">載入中…</div>
    {:else if !isNameSetup}
      <!-- 首次設定姓名 -->
      <div class="setup-card">
        <h2>👋 歡迎使用</h2>
        <p class="setup-desc">請輸入您的姓名，之後會自動帶入</p>
        <div class="setup-form">
          <input
            type="text"
            bind:value={newName}
            placeholder="您的姓名"
            maxlength="20"
            on:keydown={(e) => e.key === 'Enter' && setupName()}
          />
          <button on:click={setupName} disabled={loading}>
            {loading ? '儲存中…' : '確認'}
          </button>
        </div>
        <p class="setup-hint">設定後可隨時記帳，無需重複輸入</p>
      </div>
    {:else}
      <!-- 主表單 -->
      <form on:submit={submit}>
        <div class="card">
          <div class="field-row">
            <label for="sender">姓名</label>
            <input
              id="sender"
              name="sender"
              type="text"
              bind:value={sender}
              placeholder="你的名字"
              readonly={senderReadonly}
              required
            />
            {#if senderReadonly}
              <span class="badge">已設定</span>
            {/if}
          </div>

          <CustomerSelect
            bind:value={customer}
            customers={customers}
            on:change={handleCustomerChange}
            on:select={handleCustomerSelect}
          />

          <AmountInput bind:value={amount} {customer} recentAmounts={recentAmounts} />

          <div class="payment-status">
            <label>收款狀態 <span class="required">*</span></label>
            <div class="radio-group">
              <label class="radio-option" class:selected={paymentStatus === '已收'}>
                <input type="radio" name="paymentStatus" value="已收" bind:group={paymentStatus} required />
                <span class="radio-label">已收</span>
              </label>
              <label class="radio-option" class:selected={paymentStatus === '未收'}>
                <input type="radio" name="paymentStatus" value="未收" bind:group={paymentStatus} required />
                <span class="radio-label">未收</span>
              </label>
            </div>
            {#if !paymentStatus && showValidation}
              <p class="validation-error">請選擇收款狀態</p>
            {/if}
          </div>
        </div>

        <button type="submit" class="submit-btn" disabled={loading}>
          {loading ? '送出中…' : '送出記帳'}
        </button>
      </form>

      <RecentList records={records} />
    {/if}
  </main>

  {#if notice}
    <div class={`toast ${error ? 'error' : ''}`}>{notice}</div>
  {/if}
</div>

<style>
  :global(*) {
    box-sizing: border-box;
  }

  :global(body) {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: #f2f2f7;
    color: #1c1c1e;
    min-height: 100dvh;
    padding-bottom: env(safe-area-inset-bottom);
  }

  .page {
    min-height: 100dvh;
  }

  header {
    background: #06c755;
    color: #fff;
    padding: 16px 20px;
    position: sticky;
    top: 0;
    z-index: 10;
  }

  h1 {
    margin: 0;
    font-size: 18px;
  }

  main {
    max-width: 720px;
    margin: 0 auto;
    padding: 16px;
  }

  .loading {
    text-align: center;
    padding: 60px 20px;
    color: #8e8e93;
  }

  /* 首次設定姓名 */
  .setup-card {
    background: #fff;
    border-radius: 16px;
    padding: 28px 24px;
    text-align: center;
    box-shadow: 0 2px 8px rgba(0,0,0,0.08);
  }

  .setup-card h2 {
    margin: 0 0 8px;
    font-size: 22px;
  }

  .setup-desc {
    margin: 0 0 20px;
    color: #8e8e93;
    font-size: 15px;
  }

  .setup-form {
    display: flex;
    gap: 10px;
    margin-bottom: 12px;
  }

  .setup-form input {
    flex: 1;
    border: 2px solid #e5e5ea;
    border-radius: 12px;
    padding: 14px 16px;
    font-size: 17px;
    outline: none;
  }

  .setup-form input:focus {
    border-color: #06c755;
  }

  .setup-form button {
    border: none;
    border-radius: 12px;
    padding: 0 24px;
    font-size: 16px;
    font-weight: 700;
    background: #06c755;
    color: #fff;
    cursor: pointer;
  }

  .setup-form button:disabled {
    background: #b9bcc4;
  }

  .setup-hint {
    margin: 0;
    color: #8e8e93;
    font-size: 13px;
  }

  /* 主表單 */
  form {
    margin: 0;
  }

  .card {
    background: #fff;
    border-radius: 14px;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.07);
    padding: 16px;
    display: grid;
    gap: 16px;
  }

  .field-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .field-row label {
    font-size: 14px;
    font-weight: 600;
    color: #1c1c1e;
    min-width: 40px;
  }

  .field-row input {
    flex: 1;
    border: 1px solid #e5e5ea;
    border-radius: 10px;
    padding: 12px;
    font-size: 16px;
    outline: none;
    min-width: 0;
  }

  .field-row input:focus {
    border-color: #06c755;
  }

  .field-row input[readonly] {
    background: #f2f2f7;
    color: #8e8e93;
  }

  .badge {
    font-size: 12px;
    font-weight: 600;
    color: #06c755;
    background: #eaf9ef;
    padding: 4px 10px;
    border-radius: 20px;
  }

  /* 收款狀態 */
  .payment-status {
    margin-top: 4px;
  }

  .payment-status > label {
    display: block;
    font-size: 14px;
    font-weight: 600;
    color: #1c1c1e;
    margin-bottom: 10px;
  }

  .required {
    color: #ff3b30;
    margin-left: 4px;
  }

  .radio-group {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }

  .radio-option {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 14px;
    border: 2px solid #e5e5ea;
    border-radius: 12px;
    cursor: pointer;
    transition: all 0.15s;
    background: #fff;
  }

  .radio-option:hover {
    border-color: #06c755;
  }

  .radio-option.selected {
    border-color: #06c755;
    background: #eaf9ef;
  }

  .radio-option input {
    width: 20px;
    height: 20px;
    accent-color: #06c755;
    cursor: pointer;
  }

  .radio-label {
    font-size: 16px;
    font-weight: 600;
    color: #1c1c1e;
    flex: 1;
  }

  .validation-error {
    color: #ff3b30;
    font-size: 13px;
    margin: 8px 0 0;
  }

  .submit-btn {
    margin-top: 12px;
    width: 100%;
    border: none;
    border-radius: 14px;
    padding: 16px;
    font-size: 17px;
    font-weight: 700;
    background: #06c755;
    color: #fff;
    cursor: pointer;
  }

  .submit-btn:disabled {
    background: #b9bcc4;
    cursor: not-allowed;
  }

  .toast {
    position: fixed;
    left: 50%;
    transform: translateX(-50%);
    bottom: calc(24px + env(safe-area-inset-bottom));
    background: #111;
    color: #fff;
    border-radius: 10px;
    padding: 12px 20px;
    font-size: 15px;
    z-index: 100;
    white-space: nowrap;
  }

  .toast.error {
    background: #c5332b;
  }
</style>