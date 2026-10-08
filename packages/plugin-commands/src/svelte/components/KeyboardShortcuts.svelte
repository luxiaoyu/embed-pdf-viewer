<script lang="ts">
  import { onMount } from 'svelte';
  import { useCommandsCapability, useCommandsPlugin } from '../hooks';
  import { createKeyDownHandler } from '../../shared/utils';

  const commandsCapability = useCommandsCapability();
  const commandsPlugin = useCommandsPlugin();

  onMount(() => {
    if (!commandsCapability.provides) return;

    const handler = createKeyDownHandler(commandsCapability.provides);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (commandsPlugin.plugin?.shouldHandleShortcut(event)) handler(event);
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  });
</script>

<!-- This component is only used to set up keyboard shortcuts when the plugin is initialized. -->
