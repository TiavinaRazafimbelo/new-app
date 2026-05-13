/**
 * ProductDetailPage.jsx
 * ─────────────────────────────────────────────────────────────
 * Fiche produit complète du frontoffice PrestaShop.
 *
 * AFFICHE :
 *   - Galerie d'images avec miniatures cliquables
 *   - Nom, référence, catégorie, condition
 *   - Prix HT affiché proprement
 *   - Badge stock (En stock / Rupture)
 *   - Description courte + longue (accordéon)
 *   - Sélecteur de combinaison (déclinaisons : taille, couleur…)
 *   - Dimensions / poids si renseignés
 *   - Bouton "Ajouter au panier" (non fonctionnel, UI only)
 *   - Bouton retour vers la liste
 *
 * ROUTE :
 *   <Route path="/product/:id" element={<ProductDetailPage />} />
 *
 * DÉPENDANCES :
 *   productsService.js (getProductById)
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

/**
 * Galerie d'images avec miniatures.
 * Clic sur une miniature → agrandit l'image principale.
 */
function GalerieImages({ images, nomProduit }) {
  const [indexActif, setIndexActif] = useState(0);

  // Si pas d'image : placeholder
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
      {/* Image principale */}
      <div className="galerie__principale">
        <img
          src={imageActive.url}
          alt={`${nomProduit} — vue ${indexActif + 1}`}
          className="galerie__img-principale"
          // Pas de onError qui reboucle, juste on cache si erreur
          onError={(e) => {
            e.target.style.opacity = '0.2';
          }}
        />
        {images.length > 1 && (
          <span className="galerie__compteur">
            {indexActif + 1} / {images.length}
          </span>
        )}
      </div>

      {/* Miniatures */}
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

/**
 * Badge de disponibilité du stock.
 */
function BadgeStock({ quantity }) {
  const enStock = quantity > 0;
  return (
    <span className={`badge-stock ${enStock ? 'badge-stock--dispo' : 'badge-stock--rupture'}`}>
      {enStock ? `En stock (${quantity})` : 'Rupture de stock'}
    </span>
  );
}

/**
 * Badge de condition du produit.
 * PrestaShop : 'new', 'used', 'refurbished'
 */
function BadgeCondition({ condition }) {
  const labels = {
    new:         'Neuf',
    used:        'Occasion',
    refurbished: 'Reconditionné',
  };
  const label = labels[condition] || condition;
  return (
    <span className={`badge-condition badge-condition--${condition || 'new'}`}>
      {label}
    </span>
  );
}

/**
 * Accordéon simple pour la description longue.
 */
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

/**
 * Sélecteur de combinaison (déclinaison produit).
 * Affiche chaque combinaison avec sa référence, son prix additionnel
 * et son stock.
 */
function SelecteurCombinaison({ combinations, prixBase, onSelect }) {
  const [selectionne, setSelectionne] = useState(null);

  if (!combinations || combinations.length === 0) return null;

  const handleChange = (e) => {
    const id = Number(e.target.value);
    const combi = id ? combinations.find((c) => c.id === id) : null;
    setSelectionne(combi);
    onSelect(combi);
  };

  return (
    <div className="selecteur-combi">
      <label className="selecteur-combi__label" htmlFor="combi-select">
        Déclinaison
      </label>
      <select
        id="combi-select"
        className="selecteur-combi__select"
        onChange={handleChange}
        defaultValue=""
      >
        <option value="">— Produit de base —</option>
        {combinations.map((c) => {
          const prixAddi = c.price || 0;
          const prixFinal = prixBase + prixAddi;
          const suffixPrix = prixAddi !== 0
            ? ` (${prixAddi > 0 ? '+' : ''}${prixAddi.toFixed(2)} €)`
            : '';
          
          // Construire le label depuis les attributs
          const labelFromAttributes = c.attributes 
            ? Object.values(c.attributes).join(' / ')
            : null;

          const displayLabel = labelFromAttributes 
            || c.label 
            || `Déclinaison #${c.id}`;

          return (
            <option key={c.id} value={c.id} disabled={c.quantity === 0}>
              {displayLabel}
              {suffixPrix}
              {c.quantity === 0 ? ' — Rupture' : ''}
            </option>
          );
        })}
      </select>

      {/* Infos de la combinaison sélectionnée */}
      {selectionne && (
        <div className="combi-details">
          <span>Réf. : <strong>{selectionne.reference || `#${selectionne.id}`}</strong></span>
          <span>Stock : <strong>{selectionne.quantity}</strong></span>
          {selectionne.ean13 && (
            <span>EAN : <strong>{selectionne.ean13}</strong></span>
          )}
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

/**
 * ProductDetailPage
 * Fiche produit complète, route : /product/:id
 */
const ProductDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { addToCart } = useCart();
  const { client } = useFrontofficeClient();

  const [produit,        setProduit]        = useState(null);
  const [chargement,     setChargement]     = useState(true);
  const [erreur,         setErreur]         = useState(null);
  const [combiSelectee,  setCombiSelectee]  = useState(null);
  const [descLongue,     setDescLongue]     = useState(false);
  const [quantite,       setQuantite]       = useState(1); // ← Quantité à ajouter
  const [messageAjout,   setMessageAjout]   = useState(null); // ← Message de confirmation

  useEffect(() => {
    let annule = false;
    setChargement(true);
    setErreur(null);

    getProductById(id)
      .then((data) => {
        if (!annule) setProduit(data);
      })
      .catch((err) => {
        if (!annule) setErreur(err.message);
      })
      .finally(() => {
        if (!annule) setChargement(false);
      });

    return () => { annule = true; };
  }, [id]);


  // Prix affiché : prix de base + prix additionnel de la combinaison
  const prixAffiche = produit
    ? (produit.price + (combiSelectee?.price || 0)).toFixed(2)
    : '—';

  /**
   * Ajoute le produit au panier
   * Vérifie : quantité > 0, stock suffisant
   * Permet aussi les clients anonymes
   */
  const handleAddToCart = () => {
    // Stock disponible
    const stockDispo = combiSelectee ? combiSelectee.quantity : produit.quantity;

    if (quantite <= 0 || quantite > stockDispo) {
      setMessageAjout({
        type: 'error',
        text: `Quantité invalide. Stock disponible : ${stockDispo}`,
      });
      setTimeout(() => setMessageAjout(null), 3000);
      return;
    }

    // Construire l'article
    const article = {
      productId: produit.id,
      combinationId: combiSelectee?.id || 0,
      quantity: quantite,
      name: produit.name,
      image: produit.images?.[0]?.url || null,
      price: parseFloat(prixAffiche),
      stock: stockDispo,
    };

    // Ajouter au panier
    addToCart(article);

    // Afficher confirmation
    setMessageAjout({
      type: 'success',
      text: `✓ ${produit.name} ajouté au panier (qty: ${quantite})`,
    });

    // Réinitialiser quantité
    setQuantite(1);

    // Masquer le message après 3 secondes
    setTimeout(() => setMessageAjout(null), 3000);
  };

  // ── États de chargement ─────────────────────────────────────
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
    produit.weight > 0 || produit.width > 0 ||
    produit.height > 0 || produit.depth > 0;

  // ── Rendu principal ─────────────────────────────────────────
  return (
    <>
      <TopBar />
      <div className="detail-page">

      {/* ─── Fil d'Ariane ──────────────────────────────────── */}
      <nav className="breadcrumb">
        <Link to="/products" className="breadcrumb__lien">Produits</Link>
        <span className="breadcrumb__sep">›</span>
        {produit.categorie && (
          <>
            <span className="breadcrumb__lien">{produit.categorie.name}</span>
            <span className="breadcrumb__sep">›</span>
          </>
        )}
        <span className="breadcrumb__actuel">{produit.name}</span>
      </nav>

      {/* ─── Contenu principal : galerie + infos ───────────── */}
      <div className="detail-contenu">

        {/* Galerie */}
        <div className="detail-gauche">
          <GalerieImages
            images={produit.images}
            nomProduit={produit.name}
          />
        </div>

        {/* Informations produit */}
        <div className="detail-droite">

          {/* Badges */}
          <div className="detail-badges">
            <BadgeCondition condition={produit.condition} />
            {produit.categorie && (
              <span className="badge-categorie">{produit.categorie.name}</span>
            )}
          </div>

          {/* Nom */}
          <h1 className="detail-nom">{produit.name}</h1>

          {/* Référence */}
          <p className="detail-ref">Réf. <span>{produit.reference || '—'}</span></p>

          {/* Prix */}
          <div className="detail-prix">
            <span className="prix-principal">{prixAffiche} €</span>
            <span className="prix-mention">HT — TVA non incluse</span>
          </div>

          {/* Stock */}
          <BadgeStock quantity={
            combiSelectee ? combiSelectee.quantity : produit.quantity
          } />

          {/* Description courte */}
          {produit.description_short && (
            <div
              className="detail-description-courte"
              dangerouslySetInnerHTML={{ __html: produit.description_short }}
            />
          )}

          {/* Séparateur */}
          <hr className="detail-separateur" />

          {/* Sélecteur de combinaison */}
          <SelecteurCombinaison
            combinations={produit.combinations}
            prixBase={produit.price}
            onSelect={setCombiSelectee}
          />

          {/* Section Quantité + Bouton Ajouter */}
          <div className="detail-ajouter-panier">
            <div className="quantite-group">
              <label htmlFor="quantite-input">Quantité :</label>
              <input
                id="quantite-input"
                type="number"
                min="1"
                max={combiSelectee ? combiSelectee.quantity : produit.quantity}
                value={quantite}
                onChange={(e) => setQuantite(Math.max(1, parseInt(e.target.value) || 1))}
                className="quantite-input"
              />
            </div>

            {/* Bouton Ajouter au panier */}
            <button
              className="btn-panier"
              onClick={handleAddToCart}
              disabled={
                (combiSelectee
                  ? combiSelectee.quantity
                  : produit.quantity) === 0
              }
            >
              <span className="btn-panier__icone">🛒</span>
              Ajouter au panier
            </button>

            {/* Message de confirmation / erreur */}
            {messageAjout && (
              <div className={`message-ajout message-ajout--${messageAjout.type}`}>
                {messageAjout.text}
                {messageAjout.type === 'success' && (
                  <button
                    className="btn-aller-panier"
                    onClick={() => navigate('/cart')}
                  >
                    → Voir mon panier
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Informations complémentaires */}
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

      {/* ─── Description longue ────────────────────────────── */}
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

      {/* ─── Retour ────────────────────────────────────────── */}
      <div className="detail-retour">
        <Link to="/products" className="btn-retour">
          ← Retour aux produits
        </Link>
      </div>

    </div>
    </>
  );
};

export default ProductDetailPage;
