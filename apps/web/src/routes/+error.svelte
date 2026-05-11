<script lang="ts">
  import { page } from '$app/stores';
</script>

<main id="main-content" class="stripe-content">
  <div style="display: grid; place-items: center; min-height: 60vh; text-align: center;">
    <div>
      <p class="stripe-text-muted stripe-body-sm">{$page.status}</p>
      <h1 class="stripe-heading-xl" style="margin-top: 12px;">
        {$page.error?.message ?? 'something broke.'}
      </h1>
      <a href="/" class="btn-poly btn-cream" style="margin-top: 24px;">Back to leaderboard</a>
    </div>
  </div>
</main>
