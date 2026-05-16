/**
 * ProductCard.jsx
 * ─────────────────────────────────────────────────────────────
 * MODIFICATIONS v2 :
 *   - Affiche le prix TTC (product.price, déjà calculé par productsService)
 *   - Si product.aPromo = true → affiche le prix original barré
 *     ET le prix réduit en rouge
 *   - Badge "PROMO" ajouté en plus de HOT/NEW
 * ─────────────────────────────────────────────────────────────
 */

import React from 'react';
import { Link } from 'react-router-dom';

export const ProductCard = ({ product }) => {
  const imageUrl = product.imageId
    ? `/api/images/products/${product.id}/${product.imageId}`
    : '/placeholder.png';

  return (
    <div className="product-card">

      {/* Badge HOT / NEW / PROMO */}
      {product.badge ? (
        <span className={`product-badge product-badge--${product.badge.toLowerCase()}`}>
          {product.badge}
        </span>
      ) : product.aPromo ? (
        <span className="product-badge product-badge--promo">PROMO</span>
      ) : null}

      <div className="product-image">
        <img
          src={imageUrl}
          alt={product.name}
          loading="lazy"
          onError={(e) => { e.target.style.opacity = '0.3'; }}
        />
      </div>

      <h3>{product.name}</h3>

      {/* Prix : barré si promo */}
      <p className="price">
        {product.aPromo && product.prixOriginalTTC ? (
          <>
            <span className="price-original">{product.prixOriginalTTC.toFixed(2)} €</span>
            {' '}
            <span className="price-promo">{product.price.toFixed(2)} €</span>
          </>
        ) : (
          <span>{product.price.toFixed(2)} €</span>
        )}
        {' '}
        <span className="price-mention">TTC</span>
      </p>

      <Link to={`/product/${product.id}`} className="btn">
        Voir détails
      </Link>
    </div>
  );
};

export default ProductCard;