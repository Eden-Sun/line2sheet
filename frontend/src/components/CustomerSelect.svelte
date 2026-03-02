<script>
  import { createEventDispatcher } from 'svelte'

  const ROW_HEIGHT = 42
  const LIST_HEIGHT = 252
  const SEARCH_DEBOUNCE_MS = 180

  export let customers = []
  export let value = ''

  const dispatch = createEventDispatcher()

  let search = value
  let debouncedSearch = value
  let debounceTimer = null
  let open = false
  let highlight = 0
  let scrollTop = 0
  let listEl

  $: if (search !== value) search = value

  $: {
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debouncedSearch = search
    }, SEARCH_DEBOUNCE_MS)
  }

  $: filtered = filterCustomers(customers, debouncedSearch)
  $: totalHeight = filtered.length * ROW_HEIGHT
  $: maxStart = Math.max(0, filtered.length - visibleCount)
  $: start = Math.min(maxStart, Math.floor(scrollTop / ROW_HEIGHT))
  $: visibleCount = Math.ceil(LIST_HEIGHT / ROW_HEIGHT) + 4
  $: end = Math.min(filtered.length, start + visibleCount)
  $: visible = filtered.slice(start, end)

  $: if (highlight >= filtered.length) highlight = Math.max(filtered.length - 1, 0)

  function filterCustomers(items, query) {
    const q = String(query || '').trim().toLowerCase()
    if (!q) return items
    return items.filter((name) => name.toLowerCase().includes(q))
  }

  function selectCustomer(name) {
    value = name
    search = name
    open = false
    dispatch('select', name)
    dispatch('change', name)
  }

  function handleInput(event) {
    value = event.currentTarget.value
    search = value
    open = true
    highlight = 0
    dispatch('change', value)
  }

  function move(delta) {
    if (!filtered.length) return
    const next = Math.max(0, Math.min(filtered.length - 1, highlight + delta))
    highlight = next
    scrollToHighlight()
  }

  function scrollToHighlight() {
    if (!listEl) return
    const top = highlight * ROW_HEIGHT
    const bottom = top + ROW_HEIGHT
    if (top < listEl.scrollTop) listEl.scrollTop = top
    if (bottom > listEl.scrollTop + LIST_HEIGHT) listEl.scrollTop = bottom - LIST_HEIGHT
  }

  function onKeydown(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      open = true
      move(1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      open = true
      move(-1)
    } else if (event.key === 'Enter' && open && filtered.length) {
      event.preventDefault()
      selectCustomer(filtered[highlight])
    } else if (event.key === 'Escape') {
      open = false
    }
  }

  function onScroll(event) {
    scrollTop = event.currentTarget.scrollTop
  }
</script>

<div class="field-wrap">
  <label for="customer">客戶</label>
  <div class="control">
    <input
      id="customer"
      name="customer"
      type="text"
      bind:value
      placeholder="客戶名稱"
      autocomplete="off"
      on:focus={() => (open = true)}
      on:input={handleInput}
      on:keydown={onKeydown}
      required
    />
    <button type="button" class="pick-btn" on:click={() => (open = !open)} aria-label="切換客戶清單">選擇</button>
  </div>

  {#if open}
    <div class="list" bind:this={listEl} on:scroll={onScroll} style={`height:${LIST_HEIGHT}px`} role="listbox">
      {#if !filtered.length}
        <div class="empty">找不到客戶</div>
      {:else}
        <div style={`height:${totalHeight}px; position:relative;`}>
          {#each visible as name, i (name)}
            <button
              class={`row ${start + i === highlight ? 'active' : ''}`}
              type="button"
              style={`top:${(start + i) * ROW_HEIGHT}px;height:${ROW_HEIGHT}px`}
              on:click={() => selectCustomer(name)}
            >
              {name}
            </button>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .field-wrap {
    display: grid;
    gap: 8px;
  }

  label {
    font-size: 14px;
    font-weight: 600;
    color: #1c1c1e;
  }

  .control {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 8px;
  }

  input {
    width: 100%;
    border: 1px solid #e5e5ea;
    border-radius: 10px;
    padding: 12px;
    font-size: 16px;
    outline: none;
  }

  input:focus {
    border-color: #06c755;
  }

  .pick-btn {
    border: none;
    border-radius: 10px;
    padding: 0 14px;
    font-weight: 700;
    background: #eaf9ef;
    color: #05a847;
    cursor: pointer;
  }

  .list {
    overflow: auto;
    border: 1px solid #e5e5ea;
    border-radius: 10px;
    background: #fff;
  }

  .row {
    position: absolute;
    left: 0;
    right: 0;
    border: none;
    border-bottom: 1px solid #f0f0f4;
    background: #fff;
    text-align: left;
    padding: 0 12px;
    font-size: 15px;
    cursor: pointer;
  }

  .row.active {
    background: #eaf9ef;
  }

  .empty {
    padding: 16px;
    text-align: center;
    color: #8e8e93;
    font-size: 14px;
  }
</style>
