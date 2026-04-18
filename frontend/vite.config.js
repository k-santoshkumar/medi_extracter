import { defineConfig } from 'vite';

export default defineConfig({
  // Crucial for Capacitor mobile apps! Ensures all generated assets use relative paths.
  // Without this, Android WebView may face a blank white screen because it can't find /assets/
  base: './',
});
