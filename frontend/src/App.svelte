<script>
  import { onMount } from 'svelte'
  import CustomerSelect from './components/CustomerSelect.svelte'
  import AmountInput from './components/AmountInput.svelte'
  import RecentList from './components/RecentList.svelte'

  const CONFIG = window.__FORM_CONFIG__ || {}
  const TOKEN = CONFIG.token || ''

  let sender = load('sender', '') || CONFIG.senderValue || ''
  let senderReadonly = Boolean(CONFIG.senderReadonly)
  let customer = load('last_customer', '')
  let amount = ''

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

    storedCustomers = [entry.customer, ...storedCustomers.filter((name) => name !== entry.customer)].slice(0, 50)
    save('customers', storedCustomers)
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

    loading = true
    try {
      const res = await fetch('/api/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: TOKEN, sender: senderName, customer: customerName, amount: price })
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
        amount: price
      }

      rememberAmount(customerName, price)
      addRecentRecord(entry)
      customer = ''
      amount = ''
      toast(`✅ ${customerName} $${price.toLocaleString()} 已記帳`) 
    } catch (e) {
      toast(`送出失敗：${e.message || '未知錯誤'}`, true)
    } finally {
      loading = false
    }
  }

  onMount(() => {
    records.forEach((r) => rememberAmount(r.customer, r.amount))
    fetchCustomers()
  })
</script>

<div class="page">
  <header>
    <h1>出貨記帳</h1>
  </header>

  <main>
    <form on:submit={submit}>
      <div class="card">
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

        <CustomerSelect
          bind:value={customer}
          customers={customers}
          on:change={handleCustomerChange}
          on:select={handleCustomerSelect}
        />

        <AmountInput bind:value={amount} {customer} recentAmounts={recentAmounts} />
      </div>

      <button type="submit" disabled={loading}>{loading ? '送出中…' : '送出記帳'}</button>
    </form>

    <RecentList records={records} />
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

  form {
    margin: 0;
  }

  .card {
    background: #fff;
    border-radius: 14px;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.07);
    padding: 14px;
    display: grid;
    gap: 14px;
  }

  label {
    display: block;
    font-size: 14px;
    font-weight: 600;
    color: #1c1c1e;
    margin-bottom: 8px;
  }

  #sender {
    width: 100%;
    border: 1px solid #e5e5ea;
    border-radius: 10px;
    padding: 12px;
    font-size: 16px;
    outline: none;
  }

  #sender:focus {
    border-color: #06c755;
  }

  #sender[readonly] {
    background: #f2f2f7;
    color: #8e8e93;
  }

  button[type='submit'] {
    margin-top: 12px;
    width: 100%;
    border: none;
    border-radius: 14px;
    padding: 14px;
    font-size: 17px;
    font-weight: 700;
    background: #06c755;
    color: #fff;
    cursor: pointer;
  }

  button[type='submit']:disabled {
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
    padding: 10px 14px;
    font-size: 14px;
    z-index: 40;
  }

  .toast.error {
    background: #c5332b;
  }
</style>
