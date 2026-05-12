import React, { useEffect, useState } from "react";
import { getProducts, searchProducts, getCategories } from "../services/productsService";
import { getProductImages } from "../services/productsService";
import { Link } from "react-router-dom";
import "./Products.css";

import ProductCard from "../components/ProductCard";
import TopBar from "../components/TopBar";

const Products = () => {
  const [products, setProducts] = useState([]);
  const [filteredProducts, setFilteredProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [categories, setCategories] = useState([]);

  // État des filtres de recherche
  const [filters, setFilters] = useState({
    searchTerm: '',
    categoryId: null,
    minPrice: '',
    maxPrice: '',
  });

  // Charger les produits et catégories au montage
  useEffect(() => {
    loadInitialData();
  }, []);

  // Appliquer les filtres quand ils changent
  useEffect(() => {
    applyFilters();
  }, [filters, products]);

  const loadInitialData = async () => {
    try {
      setLoading(true);
      const [productsData, categoriesData] = await Promise.all([
        getProducts(),
        getCategories(),
      ]);
      setProducts(productsData);
      setFilteredProducts(productsData);
      setCategories(categoriesData);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const applyFilters = () => {
    // Convertir minPrice et maxPrice en nombres
    const minPrice = filters.minPrice === '' ? 0 : parseFloat(filters.minPrice);
    const maxPrice = filters.maxPrice === '' ? Infinity : parseFloat(filters.maxPrice);

    const results = products.filter((p) => {
      // Filtre nom
      const matchName = filters.searchTerm === '' ||
        p.name.toLowerCase().includes(filters.searchTerm.toLowerCase());

      // Filtre catégorie
      const matchCategory = filters.categoryId === null ||
        p.id_category_default === Number(filters.categoryId);

      // Filtre prix
      const matchPrice = p.price >= minPrice && p.price <= maxPrice;

      return matchName && matchCategory && matchPrice;
    });

    setFilteredProducts(results);
  };

  const handleFilterChange = (e) => {
    const { name, value } = e.target;
    setFilters((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const resetFilters = () => {
    setFilters({
      searchTerm: '',
      categoryId: null,
      minPrice: '',
      maxPrice: '',
    });
  };

  if (loading) {
    return (
      <div className="center">
        <p>Chargement des produits...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="center error">
        <p>Erreur : {error}</p>
      </div>
    );
  }

  return (
    <div className="products-page">
      <TopBar />
      <h4>Nos produits</h4>

      {/* Formulaire de recherche multicritère */}
      <div className="search-filters">
        <div className="filter-group">
          <label htmlFor="search-term">Rechercher par nom</label>
          <input
            id="search-term"
            type="text"
            name="searchTerm"
            placeholder="Ex: Tshirt, Chaussures..."
            value={filters.searchTerm}
            onChange={handleFilterChange}
          />
        </div>

        <div className="filter-group">
          <label htmlFor="category">Catégorie</label>
          <select
            id="category"
            name="categoryId"
            value={filters.categoryId || ''}
            onChange={handleFilterChange}
          >
            <option value="">— Toutes les catégories —</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <label htmlFor="min-price">Prix minimum (€)</label>
          <input
            id="min-price"
            type="number"
            name="minPrice"
            placeholder="0"
            value={filters.minPrice}
            onChange={handleFilterChange}
            min="0"
            step="0.01"
          />
        </div>

        <div className="filter-group">
          <label htmlFor="max-price">Prix maximum (€)</label>
          <input
            id="max-price"
            type="number"
            name="maxPrice"
            placeholder="999"
            value={filters.maxPrice}
            onChange={handleFilterChange}
            min="0"
            step="0.01"
          />
        </div>

        <button className="btn-reset" onClick={resetFilters}>
          Réinitialiser
        </button>
      </div>

      {/* Résultats de la recherche */}
      <div className="search-results">
        <p className="results-count">
          {filteredProducts.length} produit(s) trouvé(s)
        </p>
      </div>

      <div className="products-grid">
        {filteredProducts.length > 0 ? (
          filteredProducts.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))
        ) : (
          <p className="no-results">Aucun produit ne correspond à votre recherche.</p>
        )}
      </div>
    </div>
  );
};

export default Products;