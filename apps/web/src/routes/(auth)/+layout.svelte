<script lang="ts">
  import { asset } from '$app/paths';

  /** Layout halaman auth (Figma D/01a–b, M/01a–b): kartu di tengah, logo di atas. */
  let { children } = $props();
</script>

<main class="auth">
  <div class="brand">
    <img class="logo" src={asset('/rein-icon-192.png')} alt="" width="28" height="28" />
    <b>REIN</b><span class="faint">Remula</span>
  </div>
  <div class="card">{@render children()}</div>
  <p class="foot faint">PT Remula Inti Rekayasa · akses hanya dari jaringan kantor atau VPN</p>
</main>

<style>
  .auth {
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 20px;
    padding: 32px 16px calc(24px + env(safe-area-inset-bottom, 0px));
    background: var(--color-bg-app);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 15px;
  }
  .logo {
    display: block;
    border-radius: 7px;
  }
  .card {
    width: min(400px, 100%);
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 28px;
    background: var(--color-bg-surface);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-xl);
    box-shadow: var(--shadow-1);
    animation: fade 0.25s var(--ease);
  }
  .foot {
    font-size: 12px;
    text-align: center;
  }
  @media (max-width: 767px) {
    .auth {
      justify-content: flex-start;
      padding-top: 48px;
    }
    .card {
      padding: 20px;
      border: 0;
      box-shadow: none;
      background: transparent;
    }
  }
</style>
