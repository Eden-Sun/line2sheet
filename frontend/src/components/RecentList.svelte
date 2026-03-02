<script>
  export let records = []

  function formatAmount(n) {
    const v = Number(n)
    return Number.isFinite(v) ? v.toLocaleString() : '0'
  }
</script>

<div class="wrap">
  <h2>最近紀錄</h2>

  {#if !records.length}
    <div class="empty">今日尚無紀錄</div>
  {:else}
    <ul>
      {#each records as r, idx (`${r.date}-${r.time}-${r.customer}-${idx}`)}
        <li>
          <div>
            <p class="customer">{r.customer}</p>
            <p class="meta">{r.name} · {r.date} {r.time}</p>
          </div>
          <strong>${formatAmount(r.amount)}</strong>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .wrap {
    margin-top: 20px;
  }

  h2 {
    margin: 0 0 8px;
    color: #8e8e93;
    font-size: 13px;
    letter-spacing: 0.4px;
    text-transform: uppercase;
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
    border-radius: 12px;
    overflow: hidden;
    background: #fff;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
  }

  li {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 14px;
    border-bottom: 1px solid #f0f0f4;
  }

  li:last-child {
    border-bottom: none;
  }

  .customer {
    margin: 0;
    color: #1c1c1e;
    font-size: 15px;
    font-weight: 700;
  }

  .meta {
    margin: 2px 0 0;
    color: #8e8e93;
    font-size: 12px;
  }

  strong {
    color: #06c755;
    font-size: 17px;
    white-space: nowrap;
  }

  .empty {
    border-radius: 12px;
    background: #fff;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
    text-align: center;
    color: #8e8e93;
    font-size: 14px;
    padding: 24px;
  }
</style>
