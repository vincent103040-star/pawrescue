import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, normalizePath} from 'vite';

/**
 * Makes a literal filesystem path safe to use as a deny pattern.
 *
 * server.fs.deny entries are picomatch patterns, and picomatch reads
 * ( ) [ ] { } ! ? * + @ | as syntax. This path is not a pattern anybody wrote --
 * it is whatever the project directory happens to be called on this machine.
 * Here it is "remix-(修版)-浪浪家園...", and those parentheses were parsed as a
 * glob group, so the pattern matched nothing whatsoever: the rule sat in this
 * file looking correct while the database was still served over HTTP.
 *
 * The reason it went unnoticed is that it works on any path without these
 * characters, which is every machine this was tested on.
 */
const escapeGlob = (p: string) => p.replace(/[()[\]{}!?*+@|]/g, '\\$&');

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
        //
        // Vite's own defaults are repeated here on purpose. server.fs.deny
        // replaces the default list rather than extending it -- mergeWithDefaults
        // recurses into plain objects and assigns arrays straight over the top --
        // so the first version of this line, which named only data/, silently
        // switched off Vite's protection of .env, .env.*, certificates and .git.
        //
        // Nothing looked wrong, because the entry that had just been added did
        // work: data/ was refused, which is what was being tested. The reading
        // that would have caught it is not "is my new rule working" but "is the
        // old rule still working", and security-smoke.ts now asks that.
        deny: [
          '.env',
          '.env.*',
          '*.{crt,pem}',
          '**/.git/**',
          escapeGlob(normalizePath(path.resolve(__dirname, 'data'))) + '/**',
        ],
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
