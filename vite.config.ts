import { PluginOption } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import {
  INDEXABLE_STATIC_ROUTES,
  SITE_DESCRIPTION,
  SITE_FALLBACK_URL,
  SITE_NAME,
  SITE_SHORT_NAME
} from './src/lib/siteMeta';

function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

function parseCsvEnv(value?: string): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function resolveSiteUrl(siteUrl?: string): string {
  const trimmed = siteUrl?.trim();
  if (!trimmed) {
    return SITE_FALLBACK_URL;
  }

  try {
    return normalizeUrl(new URL(trimmed).toString());
  } catch {
    try {
      return normalizeUrl(new URL(`https://${trimmed}`).toString());
    } catch {
      return SITE_FALLBACK_URL;
    }
  }
}

function toAbsoluteUrl(pathname: string, siteUrl: string): string {
  return new URL(pathname, `${resolveSiteUrl(siteUrl)}/`).toString();
}

function createSeoAssetsPlugin(siteUrl: string): PluginOption {
  const normalizedSiteUrl = resolveSiteUrl(siteUrl);
  const buildDate = new Date().toISOString().slice(0, 10);
  const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${INDEXABLE_STATIC_ROUTES.map((route) => `  <url>
    <loc>${toAbsoluteUrl(route, normalizedSiteUrl)}</loc>
    <lastmod>${buildDate}</lastmod>
    <changefreq>${route === '/' ? 'weekly' : 'monthly'}</changefreq>
    <priority>${route === '/' ? '1.0' : '0.8'}</priority>
  </url>`).join('\n')}
</urlset>
`;
  const robotsTxt = `User-agent: *
Allow: /
Disallow: /admin
Disallow: /booking/
Disallow: /confirmation
Disallow: /orders/lookup
Disallow: /tickets/
Disallow: /teacher-tickets
Disallow: /staff-tickets
Sitemap: ${toAbsoluteUrl('/sitemap.xml', normalizedSiteUrl)}
`;
  const manifestJson = JSON.stringify(
    {
      name: SITE_NAME,
      short_name: SITE_SHORT_NAME,
      description: SITE_DESCRIPTION,
      start_url: '/',
      display: 'standalone',
      background_color: '#ffffff',
      theme_color: '#b91c1c',
      icons: [
        {
          src: '/favicon.svg',
          sizes: 'any',
          type: 'image/svg+xml',
          purpose: 'any'
        }
      ]
    },
    null,
    2
  );

  return {
    name: 'seo-assets',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robotsTxt });
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemapXml });
      this.emitFile({ type: 'asset', fileName: 'site.webmanifest', source: manifestJson });
    }
  };
}

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  const allowedHosts = parseCsvEnv(env.VITE_ALLOWED_HOSTS);

  return {
    plugins: [react(), tailwindcss(), createSeoAssetsPlugin(env.VITE_SITE_URL)],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify; file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      allowedHosts: allowedHosts.length > 0 ? allowedHosts : ['.trycloudflare.com'],
      proxy: {
        '/api': {
          target: env.VITE_API_PROXY_TARGET || 'http://localhost:4000',
          changeOrigin: true,
        },
        '/auth': {
          target: env.VITE_API_PROXY_TARGET || 'http://localhost:4000',
          changeOrigin: true,
        },
        '/staff': {
          target: env.VITE_API_PROXY_TARGET || 'http://localhost:4000',
          changeOrigin: true,
        },
        '/tickets/staff-comp': {
          target: env.VITE_API_PROXY_TARGET || 'http://localhost:4000',
          changeOrigin: true,
        },
      },
    },
  };
});
