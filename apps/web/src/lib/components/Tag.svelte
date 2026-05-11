<script lang="ts">
  import { mainTagClass, mainTagLabel } from '$lib/utils/tags';

  interface Props {
    tag: string | null | undefined;
  }
  let { tag }: Props = $props();
</script>

<span class="tag-chip {mainTagClass(tag)}">{mainTagLabel(tag)}</span>
