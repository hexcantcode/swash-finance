<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    open: boolean;
    onclose: () => void;
    /** Accessible name for the dialog. */
    label: string;
    children: Snippet;
  }
  let { open, onclose, label, children }: Props = $props();

  let sheetEl = $state<HTMLElement | null>(null);

  // Move focus into the sheet when it opens so keyboard / screen-reader
  // context follows the modal.
  $effect(() => {
    if (open) sheetEl?.focus();
  });

  function onkeydown(e: KeyboardEvent) {
    if (open && e.key === 'Escape') onclose();
  }
</script>

<svelte:window {onkeydown} />

{#if open}
  <div class="m-sheet-layer">
    <button
      type="button"
      class="m-sheet-backdrop"
      aria-label="Close"
      onclick={onclose}
    ></button>
    <div
      bind:this={sheetEl}
      class="m-sheet"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      tabindex="-1"
    >
      <span class="m-sheet-grabber" aria-hidden="true"></span>
      {@render children()}
    </div>
  </div>
{/if}

<style>
  .m-sheet-layer {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
  }

  .m-sheet-backdrop {
    position: absolute;
    inset: 0;
    border: 0;
    padding: 0;
    background: rgba(0, 0, 0, 0.4);
    cursor: pointer;
    animation: m-sheet-fade var(--motion-base) var(--motion-ease);
  }

  .m-sheet {
    position: relative;
    background: var(--glass-bg);
    -webkit-backdrop-filter: var(--glass-blur);
    backdrop-filter: var(--glass-blur);
    border-radius: var(--radius-xl) var(--radius-xl) 0 0;
    box-shadow:
      var(--glass-highlight),
      0 -8px 32px rgba(0, 0, 0, 0.2);
    padding:
      var(--space-3)
      max(var(--safe-left), var(--space-5))
      calc(var(--safe-bottom) + var(--space-6))
      max(var(--safe-right), var(--space-5));
    outline: none;
    animation: m-sheet-rise var(--motion-emph) var(--motion-ease);
  }

  .m-sheet-grabber {
    display: block;
    width: 36px;
    height: 4px;
    margin: 0 auto var(--space-4);
    border-radius: var(--radius-full);
    background: var(--stripe-text-muted);
  }

  @keyframes m-sheet-fade {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes m-sheet-rise {
    from { transform: translateY(24px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }
</style>
