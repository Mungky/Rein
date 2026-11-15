// Tipe global SvelteKit.
declare global {
  namespace App {
    interface Error {
      message: string;
      code?: string;
    }
  }
}

export {};
