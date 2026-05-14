/**
 * ProductCard.jsx
 * ─────────────────────────────────────────────────────────────
 * MODIFICATIONS :
 *   - Prix affiché TTC (via product.price déjà calculé TTC dans productsService)
 *   - Suppression de l'appel getProductImages() dans le useEffect :
 *     l'imageId est déjà dans product.imageId (fourni par getProducts())
 *     → plus de requête API supplémentaire par carte
 * ─────────────────────────────────────────────────────────────
 */

import React from 'react';
import { Link } from 'react-router-dom';

export const ProductCard = ({ product }) => {
  // L'imageId est déjà disponible dans product (fourni par getProducts())
  // Pas besoin d'un useEffect + requête API supplémentaire
  const imageUrl = product.imageId
    ? `/api/images/products/${product.id}/${product.imageId}`
    : '/placeholder.png';

  return (
    <div className="product-card">
      {/* Badge HOT/NEW */}
      {product.badge && (
        <span className={`product-badge product-badge--${product.badge.toLowerCase()}`}>
          {product.badge}
        </span>
      )}

      <div className="product-image">
        <img
          src={imageUrl}
          alt={product.name}
          loading="lazy"
          onError={(e) => {
            // Si l'image échoue → placeholder silencieux
            e.target.style.opacity = '0.3';
            // e.target.src = '/placeholder.png';
          }}
        />
      </div>

      <h3>{product.name}</h3>

      {/* Prix TTC — product.price est déjà en TTC (calculé dans productsService) */}
      <p className="price">
        {product.price.toFixed(2)} € <span className="price-mention">TTC</span>
      </p>

      <Link to={`/product/${product.id}`} className="btn">
        Voir détails
      </Link>
    </div>
  );
};

export default ProductCard;