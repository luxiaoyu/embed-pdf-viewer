<template>
  <!-- This component is only used to set up keyboard shortcuts when the plugin is initialized -->
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import { useCommandsCapability, useCommandsPlugin } from '../hooks';
import { createKeyDownHandler } from '../../shared/utils';

const { provides: commands } = useCommandsCapability();
const { plugin } = useCommandsPlugin();

let cleanup: (() => void) | null = null;

onMounted(() => {
  if (!commands.value) return;

  const handler = createKeyDownHandler(commands.value);
  const handleKeyDown = (event: KeyboardEvent) => {
    if (plugin.value?.shouldHandleShortcut(event)) handler(event);
  };

  document.addEventListener('keydown', handleKeyDown);
  cleanup = () => document.removeEventListener('keydown', handleKeyDown);
});

onUnmounted(() => {
  cleanup?.();
});
</script>
