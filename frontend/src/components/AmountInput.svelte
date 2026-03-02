<script>
  export let value = ''
  export let customer = ''
  export let recentAmounts = {}

  $: key = String(customer || '').trim()
  $: options = Array.isArray(recentAmounts[key]) ? recentAmounts[key] : []

  function applyAmount(amount) {
    value = String(amount)
  }
</script>

<div class="field-wrap">
  <label for="amount">金額</label>
  <div class="row">
    <input
      id="amount"
      name="amount"
      type="number"
      min="1"
      inputmode="decimal"
      placeholder="0"
      bind:value
      required
    />
    <span>元</span>
  </div>

  {#if options.length}
    <div class="chips" aria-label="最近金額">
      {#each options as amount (amount)}
        <button type="button" on:click={() => applyAmount(amount)}>{amount.toLocaleString()}</button>
      {/each}
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

  .row {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
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

  span {
    color: #8e8e93;
    font-size: 14px;
    font-weight: 600;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .chips button {
    border: 1px solid #d5f0df;
    background: #f3fcf7;
    color: #05a847;
    border-radius: 999px;
    padding: 6px 10px;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
  }
</style>
