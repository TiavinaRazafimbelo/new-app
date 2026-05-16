export default {
  server: {
    proxy: {

      // ── API REST PrestaShop ───────────────────────────────
      // Utilisé par prestaFetch / prestaWrite pour toutes les
      // ressources API (/products, /orders, /stock_availables...)
      '/api': {
        target: 'http://localhost/prestashop_edition_classic_version_8.2.6',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            const key = 'UK5SK4KF2CK1JAZ3SSG8CJRXV81HE2Z1';
            proxyReq.setHeader(
              'Authorization',
              'Basic ' + Buffer.from(key + ':').toString('base64')
            );
          });
        },
      },

      // ── Endpoint custom module stockajax ──────────────────
      // Utilisé par callCustomStockEndpoint dans stockService.js
      // URL cote JS : /presta/index.php?fc=module&module=stockajax&controller=update
      // Proxy reecrit vers : /index.php?fc=module&...
      '/presta': {
        target: 'http://localhost/prestashop_edition_classic_version_8.2.6',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/presta/, ''),
      },

    },
  },
};