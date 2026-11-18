<script lang="ts">
  import ActivityList from '$lib/components/ActivityList.svelte';
</script>

<svelte:head><title>Aktivitas · REIN</title></svelte:head>
<div class="content">
  <h1>Aktivitas</h1>
  <ActivityList />
</div>

<style>
  .content {
    max-width: 1056px;
    padding: 20px 24px;
  }
  h1 {
    margin: 0 0 16px;
  }
  @media (max-width: 767px) {
    .content {
      padding: 16px;
    }
  }
</style>
