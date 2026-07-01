<script lang="ts">
  // Traders has been retired as a destination — `/` now redirects to Markets,
  // the new home. Kept as a thin redirect so the root path (brand logo, old
  // links, app launch) always lands somewhere valid.
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';

  onMount(() => {
    void goto('/assets', { replaceState: true });
  });
</script>

<div class="m-redirect" aria-hidden="true"></div>

<style>
  /* Reserve the viewport while the client-side redirect to /assets runs, so the
     root path doesn't flash an empty document. */
  .m-redirect {
    min-height: 100vh;
  }
</style>
