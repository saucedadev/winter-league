<script setup>
import { computed, nextTick, ref } from 'vue';
import { formatPhoneTyping, phoneDigits } from '../utils/phone';

// Phone field: v-model holds digits only ("3125550142"); the box shows
// "(312) 555-0142" as you type. Pasting any format works.
const props = defineProps({ modelValue: { type: String, default: '' }, id: String });
const emit = defineEmits(['update:modelValue']);
const el = ref(null);
const shown = computed(() => formatPhoneTyping(props.modelValue || ''));
const incomplete = computed(() => (props.modelValue || '').length > 0 && (props.modelValue || '').length < 10);

// Put the caret after the same number of digits it was after before reformatting.
function placeCaret(digitsBefore) {
  const text = el.value.value;
  let pos = 0;
  let seen = 0;
  while (pos < text.length && seen < digitsBefore) { if (/\d/.test(text[pos])) seen++; pos++; }
  el.value.setSelectionRange(pos, pos);
}

async function onInput(e) {
  const raw = e.target.value;
  const caret = e.target.selectionStart ?? raw.length;
  const digitsBefore = phoneDigits(raw.slice(0, caret)).length;
  const digits = phoneDigits(raw);
  emit('update:modelValue', digits);
  await nextTick();
  el.value.value = formatPhoneTyping(digits); // also undoes any non-digit typed
  placeCaret(Math.min(digitsBefore, digits.length));
}

// Backspace right after "(", ")", " " or "-" deletes the digit before it.
async function onKeydown(e) {
  if (e.key !== 'Backspace') return;
  const input = e.target;
  const { selectionStart: s, selectionEnd: end, value } = input;
  if (s !== end || s === 0 || /\d/.test(value[s - 1])) return;
  e.preventDefault();
  const digitsBefore = phoneDigits(value.slice(0, s)).length;
  if (!digitsBefore) return;
  const d = props.modelValue || '';
  const next = d.slice(0, digitsBefore - 1) + d.slice(digitsBefore);
  emit('update:modelValue', next);
  await nextTick();
  el.value.value = formatPhoneTyping(next);
  placeCaret(digitsBefore - 1);
}
</script>

<template>
  <input :id="id" ref="el" :value="shown" type="tel" inputmode="tel" autocomplete="tel" class="input"
    placeholder="(123) 456-7890" :aria-invalid="incomplete ? 'true' : undefined"
    @input="onInput" @keydown="onKeydown" />
  <p v-if="incomplete" class="text-xs text-text-muted mt-1">Enter all 10 digits.</p>
</template>
