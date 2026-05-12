export default {
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost/prestashop_edition_classic_version_8.2.6',
        changeOrigin: true,
        // Ajouter le header Authorization directement dans le proxy :
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            const key = 'UK5SK4KF2CK1JAZ3SSG8CJRXV81HE2Z1';
            proxyReq.setHeader('Authorization', 'Basic ' + Buffer.from(key + ':').toString('base64'));
          });
        }
      }
    }
  }
}