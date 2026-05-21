<script lang="ts">
  import { profileTagClass, profileTagLabel } from '$lib/utils/tags';

  interface Props {
    tag: string | null | undefined;
  }
  let { tag }: Props = $props();
</script>

<span class="tag-chip {profileTagClass(tag)}">{profileTagLabel(tag)}</span>
