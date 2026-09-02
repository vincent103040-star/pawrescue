import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, normalizePath} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      fs: {
        // data/ holds the volunteer database, its backups, uploaded avatars and
        // check-out photographs. Vite's dev server serves the project directory,
        // so without this every one of those is a plain GET away -- .gitignore
        // keeps them out of git and does nothing at all about HTTP.
        //
        // Anchored to this directory rather than written as a glob. '**/data/**'
        // would also match src/data/, where mockData and zones live and which the
        // app imports on every page -- that breaks the entire front end, and it
        // presents as a build error rather than as this line.
        //
        // normalizePath, not path.resolve on its own: Vite matches against a
        // forward-slash path, and on Windows resolve() returns backslashes. The
        // pattern then never matches anything and the deny list reads as
        // configured while doing nothing -- which is how this was first written.
        deny: [normalizePath(path.resolve(__dirname, 'data')) + '/**'],
      },
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      // Vite blocks requests whose Host header isn't localhost by default (DNS
      // rebinding protection). The app is reverse-proxied from a public domain,
      // so that domain must be explicitly trusted here.
      allowedHosts: ['35-192-205-12.sslip.io'],
    },
  };
});
