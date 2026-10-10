<script lang="ts">
  import { onMount } from 'svelte';
  import { health, settings } from '$lib/stores';
  import { backendHas, contractRefused } from '$lib/stores/health';
  import { loadSignatures } from '$lib/stores/signatures';
  import { installPaletteStyles } from '$lib/utils/groupStyle';
  import { readViewState } from '$lib/utils/urlState';
  import { loadView, startViewSync } from '$lib/viewState';
  import Header from './components/layout/Header.svelte';
  import ActivityBar from './components/layout/ActivityBar.svelte';
  import Sidebar from './components/layout/Sidebar.svelte';
  import MainContent from './components/layout/MainContent.svelte';
  import StatusBar from './components/layout/StatusBar.svelte';
  import KeyboardShortcuts from './components/common/KeyboardShortcuts.svelte';
  import RecentTabsSwitcher from './components/layout/RecentTabsSwitcher.svelte';
  import Notifications from './components/common/Notifications.svelte';
  import TokenPrompt from './components/common/TokenPrompt.svelte';
  import ContractRefused from './components/common/ContractRefused.svelte';

  onMount(() => {
    health.startPolling();
    // The group colours, for the findings wherever they are drawn.
    installPaletteStyles();

    // The link rebuilds the view; chain mode is on only when it says
    // `chains=1`. The URL follows the view only once that is done, so a
    // half-restored view never overwrites the link.
    let stopViewSync: (() => void) | null = null;
    let isDestroyed = false;
    loadView(readViewState())
      .catch((e) => console.error('Failed to restore the view from the URL:', e))
      .finally(() => {
        if (!isDestroyed) stopViewSync = startViewSync();
      });

    return () => {
      isDestroyed = true;
      health.stopPolling();
      stopViewSync?.();
    };
  });

  // The signature catalogue is asked once the backend's /health lists
  // signatures; it has not answered yet when the app mounts.
  $: if (backendHas('signatures', $health)) void loadSignatures();
</script>

<!-- While the contract is refused the app behind the cover takes no
     focus and no input: the cover is the only thing to act on. -->
<div class="h-screen flex flex-col" inert={$contractRefused}>
  <Header />

  <div class="flex-1 flex min-h-0">
    <ActivityBar />
    <Sidebar width={$settings.sidebarWidth} />
    <MainContent />
  </div>

  <StatusBar />
  <KeyboardShortcuts />
  <RecentTabsSwitcher />
  <Notifications />
  <TokenPrompt />
</div>
<ContractRefused />
