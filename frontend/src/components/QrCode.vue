<script setup>
import { ref, watchEffect } from 'vue';
import QRCode from 'qrcode';

// A QR code for `value` (a web address), drawn as SVG in black on white so
// phone cameras read it in any theme.
const props = defineProps({ value: { type: String, required: true }, size: { type: Number, default: 200 }, label: { type: String, default: 'QR code' }, level: { type: String, default: 'M' } });
const svg = ref('');
watchEffect(async () => {
  try { svg.value = await QRCode.toString(props.value, { type: 'svg', margin: 2, errorCorrectionLevel: props.level, color: { dark: '#000000', light: '#ffffff' } }); }
  catch { svg.value = ''; }
});
</script>

<template>
  <div class="qr-code bg-white rounded-lg p-1 inline-block" :style="{ width: `${size}px`, height: `${size}px` }" role="img" :aria-label="label" v-html="svg" />
</template>

<style scoped>
.qr-code :deep(svg) { width: 100%; height: 100%; display: block; }
</style>
