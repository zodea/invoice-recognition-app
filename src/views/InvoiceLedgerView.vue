<script setup>
import InvoiceLedgerPanel from "../components/InvoiceLedgerPanel.vue";
import InvoiceLedgerViewer from "../components/InvoiceLedgerViewer.vue";
</script>

<template>
  <div class="ledger-page">
    <InvoiceLedgerPanel ledger-page />
    <InvoiceLedgerViewer />
  </div>
</template>

<style scoped>
.ledger-page { display: flex; flex-direction: column; gap: 12px; min-width: 0; min-height: 0; height: 100%; }
.ledger-page > :first-child { flex: none; }
</style>
