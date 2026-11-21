<script setup>
defineProps({ initialBuyerCheck: { type: String, default: 'all' } });
</script>

<template>
  <div class="ledger-page">
    <InvoiceLedgerPanel />
    <InvoiceLedgerViewer :initial-buyer-check="initialBuyerCheck" />
  </div>
</template>

<style scoped>
.ledger-page { display: flex; flex-direction: column; gap: 8px; min-width: 0; min-height: 0; flex: 1; }
.ledger-page > .ui-toolbar { flex: none; }
</style>
