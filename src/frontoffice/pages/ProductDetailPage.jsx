/**
 * ProductDetailPage.jsx
 * ─────────────────────────────────────────────────────────────
 * CORRECTION :
 *   - Prix affiché en TTC (productsService retourne déjà le TTC)
 *   - Mention "TTC" à la place de "HT — TVA non incluse"
 *   - Le prix additionnel des combinaisons est aussi en TTC
 * ─────────────────────────────────────────────────────────────
 */

import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { getProductById } from '../services/productsService';
import { useCart } from '../contexts/CartContext';
import { useFrontofficeClient } from '../contexts/FrontofficeClientContext';
import TopBar from '../components/TopBar';
import './ProductDetailPage.css';

// ─── Sous-composants ──────────────────────────────────────────

function GalerieImages({ images, nomProduit }) {
  const [indexActif, setIndexActif] = useState(0);

  if (!images || images.length === 0) {
    return (
      <div className="galerie">
        <div className="galerie__principale galerie__principale--vide">
          <span>Aucune image</span>
        </div>
      </div>
    );
  }

  const imageActive = images[indexActif];

  return (
    <div className="galerie">
      <div className="galerie__principale">
        <img
          src={imageActive.url}
          alt={`${nomProduit} — vue ${indexActif + 1}`}
          className="galerie__img-principale"
          onError={(e) => { e.target.style.opacity = '0.2'; }}
        />
        {images.length > 1 && (
          <span className="galerie__compteur">{indexActif + 1} / {images.length}</span>
        )}
      </div>

      {images.length > 1 && (
        <div className="galerie__miniatures">
          {images.map((img, i) => (
            <button
              key={img.id}
              className={`galerie__miniature ${i === indexActif ? 'galerie__miniature--active' : ''}`}
              onClick={() => setIndexActif(i)}
              aria-label={`Vue ${i + 1}`}
            >
              <img src={img.url} alt={`Miniature ${i + 1}`} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function BadgeStock({ quantity }) {
  const enStock = quantity > 0;
  return (
    <span className={`badge-stock ${enStock ? 'badge-stock--dispo' : 'badge-stock--rupture'}`}>
      {enStock ? `En stock (${quantity})` : 'Rupture de stock'}
    </span>
  );
}

function BadgeCondition({ condition }) {
  const labels = { new: 'Neuf', used: 'Occasion', refurbished: 'Reconditionné' };
  return (
    <span className={`badge-condition badge-condition--${condition || 'new'}`}>
      {labels[condition] || condition}
    </span>
  );
}

function Accordeon({ titre, children }) {
  const [ouvert, setOuvert] = useState(false);
  return (
    <div className="accordeon">
      <button
        className={`accordeon__btn ${ouvert ? 'accordeon__btn--ouvert' : ''}`}
        onClick={() => setOuvert((v) => !v)}
      >
        {titre}
        <span className="accordeon__chevron">{ouvert ? '▲' : '▼'}</span>
      </button>
      {ouvert && <div className="accordeon__contenu">{children}</div>}
    </div>
  );
}

function SelecteurCombinaison({ combinations, prixBaseTTC, onSelect }) {
  const [selectionne, setSelectionne] = useState(null);

  if (!combinations || combinations.length === 0) return null;

  const handleChange = (e) => {
    const id    = Number(e.target.value);
    const combi = id ? combinations.find((c) => c.id === id) : null;
    setSelectionne(combi);
    onSelect(combi);
  };

  return (
    <div className="selecteur-combi">
      <label className="selecteur-combi__label" htmlFor="combi-select">
        Déclinaison
      </label>
      <select id="combi-select" className="selecteur-combi__select" onChange={handleChange} defaultValue="">
        <option value="">— Produit de base —</option>
        {combinations.map((c) => {
          // c.price = impact TTC de la combinaison
          const prixAddiTTC  = c.price || 0;
          const suffixPrix   = prixAddiTTC !== 0
            ? ` (${prixAddiTTC > 0 ? '+' : ''}${prixAddiTTC.toFixed(2)} €)`
            : '';

          const labelFromAttributes = c.attributes
            ? Object.values(c.attributes).join(' / ')
            : null;
          const displayLabel = labelFromAttributes || c.label || `Déclinaison #${c.id}`;

          return (
            <option key={c.id} value={c.id} disabled={c.quantity === 0}>
              {displayLabel}{suffixPrix}{c.quantity === 0 ? ' — Rupture' : ''}
            </option>
          );
        })}
      </select>

      {selectionne && (
        <div className="combi-details">
          <span>Réf. : <strong>{selectionne.reference || `#${selectionne.id}`}</strong></span>
          <span>Stock : <strong>{selectionne.quantity}</strong></span>
          {selectionne.ean13 && <span>EAN : <strong>{selectionne.ean13}</strong></span>}
          {selectionne.attributes && Object.keys(selectionne.attributes).length > 0 && (
            <div className="combi-attributs">
              {Object.entries(selectionne.attributes).map(([groupe, valeur]) => (
                <span key={groupe}>{groupe} : <strong>{valeur}</strong></span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Composant principal ──────────────────────────────────────

const ProductDetailPage = () => {
  const { id }      = useParams();
  const navigate    = useNavigate();
  const { addToCart } = useCart();

  const [produit,       setProduit]       = useState(null);
  const [chargement,    setChargement]    = useState(true);
  const [erreur,        setErreur]        = useState(null);
  const [combiSelectee, setCombiSelectee] = useState(null);
  const [quantite,      setQuantite]      = useState(1);
  const [messageAjout,  setMessageAjout]  = useState(null);

  useEffect(() => {
    let annule = false;
    setChargement(true);
    setErreur(null);

    getProductById(id)
      .then((data) => { if (!annule) setProduit(data); })
      .catch((err) => { if (!annule) setErreur(err.message); })
      .finally(() => { if (!annule) setChargement(false); });

    return () => { annule = true; };
  }, [id]);

  // Prix TTC affiché = prix TTC produit + impact TTC de la combinaison
  // produit.price et combiSelectee.price sont DÉJÀ en TTC grâce au service corrigé
  const prixTTC = produit
    ? (produit.price + (combiSelectee?.price || 0))
    : 0;

  const handleAddToCart = () => {
    const stockDispo = combiSelectee ? combiSelectee.quantity : produit.quantity;

    if (quantite <= 0 || quantite > stockDispo) {
      setMessageAjout({ type: 'error', text: `Quantité invalide. Stock disponible : ${stockDispo}` });
      setTimeout(() => setMessageAjout(null), 3000);
      return;
    }

    addToCart({
      productId:     produit.id,
      combinationId: combiSelectee?.id || 0,
      quantity:      quantite,
      name:          produit.name,
      image:         produit.images?.[0]?.url || null,
      price:         parseFloat(prixTTC.toFixed(2)),   // ← TTC stocké dans le panier
      stock:         stockDispo,
    });

    setMessageAjout({ type: 'success', text: `✓ ${produit.name} ajouté au panier (qty: ${quantite})` });
    setQuantite(1);
    setTimeout(() => setMessageAjout(null), 3000);
  };

  // ── États ──────────────────────────────────────────────────
  if (chargement) {
    return (
      <div className="detail-page detail-page--chargement">
        <div className="spinner" />
        <p>Chargement du produit…</p>
      </div>
    );
  }

  if (erreur) {
    return (
      <div className="detail-page detail-page--erreur">
        <span className="erreur-icone">⚠</span>
        <h2>Produit introuvable</h2>
        <p>{erreur}</p>
        <Link to="/products" className="btn-retour">← Retour aux produits</Link>
      </div>
    );
  }

  if (!produit) return null;

  const aDesDimensions =
    produit.weight > 0 || produit.width > 0 || produit.height > 0 || produit.depth > 0;

  const stockAffiche = combiSelectee ? combiSelectee.quantity : produit.quantity;

  return (
    <>
      <TopBar />
      <div className="detail-page">

        <nav className="breadcrumb">
          <Link to="/products" className="breadcrumb__lien">Produits</Link>
          <span className="breadcrumb__sep">›</span>
          <span className="breadcrumb__actuel">{produit.name}</span>
        </nav>

        <div className="detail-contenu">
          <div className="detail-gauche">
            <GalerieImages images={produit.images} nomProduit={produit.name} />
          </div>

          <div className="detail-droite">
            <div className="detail-badges">
              <BadgeCondition condition={produit.condition} />
            </div>

            <h1 className="detail-nom">{produit.name}</h1>
            <p className="detail-ref">Réf. <span>{produit.reference || '—'}</span></p>

            {/* Prix TTC */}
            <div className="detail-prix">
              <span className="prix-principal">{prixTTC.toFixed(2)} €</span>
              {/* ← CORRECTION : TTC affiché */}
              <span className="prix-mention">
                TTC
                {produit.taxRate > 0 && ` (TVA ${produit.taxRate}%)`}
              </span>
            </div>

            <BadgeStock quantity={stockAffiche} />

            {produit.description_short && (
              <div
                className="detail-description-courte"
                dangerouslySetInnerHTML={{ __html: produit.description_short }}
              />
            )}

            <hr className="detail-separateur" />

            <SelecteurCombinaison
              combinations={produit.combinations}
              prixBaseTTC={produit.price}
              onSelect={setCombiSelectee}
            />

            <div className="detail-ajouter-panier">
              <div className="quantite-group">
                <label htmlFor="quantite-input">Quantité :</label>
                <input
                  id="quantite-input"
                  type="number"
                  min="1"
                  max={stockAffiche}
                  value={quantite}
                  onChange={(e) => setQuantite(Math.max(1, parseInt(e.target.value) || 1))}
                  className="quantite-input"
                />
              </div>

              <button
                className="btn-panier"
                onClick={handleAddToCart}
                disabled={stockAffiche === 0}
              >
                <span className="btn-panier__icone">🛒</span>
                Ajouter au panier
              </button>

              {messageAjout && (
                <div className={`message-ajout message-ajout--${messageAjout.type}`}>
                  {messageAjout.text}
                  {messageAjout.type === 'success' && (
                    <button className="btn-aller-panier" onClick={() => navigate('/cart')}>
                      → Voir mon panier
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="detail-meta">
              {produit.ean13 && produit.ean13 !== '0' && (
                <div className="meta-ligne">
                  <span className="meta-label">EAN-13</span>
                  <span className="meta-valeur">{produit.ean13}</span>
                </div>
              )}
              {produit.minimal_quantity > 1 && (
                <div className="meta-ligne">
                  <span className="meta-label">Qté minimale</span>
                  <span className="meta-valeur">{produit.minimal_quantity}</span>
                </div>
              )}
              {aDesDimensions && (
                <div className="meta-ligne">
                  <span className="meta-label">Dimensions</span>
                  <span className="meta-valeur">
                    {[
                      produit.width  > 0 && `L ${produit.width} cm`,
                      produit.height > 0 && `H ${produit.height} cm`,
                      produit.depth  > 0 && `P ${produit.depth} cm`,
                      produit.weight > 0 && `${produit.weight} kg`,
                    ].filter(Boolean).join(' · ')}
                  </span>
                </div>
              )}
              <div className="meta-ligne">
                <span className="meta-label">Ajouté le</span>
                <span className="meta-valeur">
                  {produit.date_add
                    ? new Date(produit.date_add).toLocaleDateString('fr-FR')
                    : '—'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {produit.description && (
          <div className="detail-section">
            <Accordeon titre="Description complète">
              <div
                className="description-longue"
                dangerouslySetInnerHTML={{ __html: produit.description }}
              />
            </Accordeon>
          </div>
        )}

        <div className="detail-retour">
          <Link to="/products" className="btn-retour">← Retour aux produits</Link>
        </div>

      </div>
    </>
  );
};

export default ProductDetailPage;