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

      // ── Mise à jour stock ─────────────────────────────────
      // POST /updatestock { id_product, id_product_attribute, delta }
      // ── Mise à jour stock + historique ────────────────────
      // POST /updatestock { id_product, id_product_attribute, delta }
      // GET  /updatestock?action=history&id_product=X&...
      // → updatestock.php à la racine de PrestaShop
      '/updatestock': {
        target: 'http://localhost/prestashop_edition_classic_version_8.2.6',
        changeOrigin: true,
        rewrite: (path) =>
          path.replace(/^\/updatestock/, '/updatestock.php'),
      },

      // ── Changement d'état commande (livrer / annuler) ─────
      // POST /shiporder { id_order, action }
      // GET  /shiporder?id_order=X
      // → modules/etatcommande/controllers/front/shiporder.php
      '/shiporder': {
        target: 'http://localhost/prestashop_edition_classic_version_8.2.6',
        changeOrigin: true,
        rewrite: (path) =>
          path.replace(
            /^\/shiporder/,
            '/modules/etatcommande/controllers/front/shiporder.php'
          ),
      },

      // ── Correction des dates après import ─────────────────
      // POST /fix-import-dates { corrections: [{idOrder, idCart, dateISO}] }
      // → fix-import-dates.php à la racine de PrestaShop
      '/fix-import-dates': {
        target: 'http://localhost/prestashop_edition_classic_version_8.2.6',
        changeOrigin: true,
        rewrite: (path) =>
          path.replace(/^\/fix-import-dates/, '/fix-import-dates.php'),
      },

    },
  },
  build: {
    minify: false,
  },
};