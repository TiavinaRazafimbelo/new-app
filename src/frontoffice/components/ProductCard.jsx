import React, { useState, useEffect } from "react";
import { getProductImages } from "../services/productsService";
import { Link } from "react-router-dom";

export const ProductCard = ({ product }) => {
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getProductImages(product.id)
        .then((imgs) => {
          console.log("Images produit", product.id, ":", imgs);
          if (imgs[0]) {
            console.log("Structure image[0]:", imgs[0]); // Pour voir ce qu'il y a dedans
          }
          setImages(imgs);
        })
      .catch((err) => console.error("Erreur images:", err))
      .finally(() => setLoading(false));
  }, [product.id]);

    // Prendre la première image (ou placeholder)
    const firstImage = images[0];

    const imageUrl = firstImage?.id
      ? `/api/images/products/${product.id}/${firstImage.id}`
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
          {loading ? (
            <p>Chargement image...</p>
          ) : (
            <img src={imageUrl} alt={product.name} />
          )}
        </div>
        <h3>{product.name}</h3>
        <p className="price">{product.price} €</p>
        <Link to={`/product/${product.id}`} className="btn">
          Voir détails
        </Link>
      </div>
    );
};

export default ProductCard;