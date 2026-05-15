/**
 * columnMapping.js
 * ─────────────────────────────────────────────────────────────
 * Traduction des noms de colonnes CSV (malgaches/custom)
 * vers les noms attendus par les parsers d'import.
 *
 * Modifier ici si les colonnes CSV changent.
 * ─────────────────────────────────────────────────────────────
 */

// ─── CSV 1 : Produits ─────────────────────────────────────────
// date_availability_produit | nom | reference | prix_ttc | Taxe | categorie | prix_achat
export const PRODUCT_COLUMNS = {
  date_availability_produit: 'available_date',
  nom:                       'name',
  reference:                 'reference',
  prix_ttc:                  'price_ttc',
  Taxe:                      'tax_rate',      // ex: "11,65%" ou "5,60%"
  categorie:                 'category_name',
  prix_achat:                'wholesale_price',
};

// ─── CSV 2 : Combinaisons / Stock ─────────────────────────────
// reference | specificité | karazany | stock_initial | prix_vente_ttc
export const COMBINATION_COLUMNS = {
  reference:      'product_reference',
  "specificité":  'attribute_group',  // ex: "taille", "couleur"
  karazany:       'attribute_value',  // ex: "ngoza" (grande), "kely" (petite), "mainty" (noir), "fotsy" (blanc)
  stock_initial:  'quantity',
  prix_vente_ttc: 'price_ttc',
};

// Traduction des valeurs d'attributs malgaches → labels affichés
export const ATTRIBUTE_VALUE_LABELS = {
  // Tailles
  ngoza:  'Grande taille',
  kely:   'Petite taille',
  // Couleurs
  mainty: 'Noir',
  fotsy:  'Blanc',
};

// Noms des groupes d'attributs PrestaShop (créés si inexistants)
export const ATTRIBUTE_GROUP_LABELS = {
  taille:  'Taille',
  couleur: 'Couleur',
};

// ─── CSV 3 : Clients + Commandes ─────────────────────────────
// date | nom | email | pwd | adresse | achat | etat
export const CUSTOMER_COLUMNS = {
  date:    'date_add',
  nom:     'lastname',
  email:   'email',
  pwd:     'passwd',
  adresse: 'address1',
  achat:   'cart_items',   // format: [("ref";qty;"variant")]
  etat:    'order_state',  // "paiement accepté" | "" (vide = panier)
};

// Traduction des états de commande CSV → ID PrestaShop
// Normalisation : minuscules sans accents pour comparaison robuste
export const ORDER_STATE_MAP = {
  'paiement accepté':  2,   // Payment accepted
  'paiement accepte':  2,
  'en préparation':    3,   // Processing in progress
  'en preparation':    3,
  'expédié':           4,   // Shipped
  'expedie':           4,
  'livré':             5,   // Delivered
  'livre':             5,
  'annulé':            6,   // Canceled
  'annule':            6,
  '':                  null, // Vide = panier abandonné (pas de commande)
};

// ─── Taux de TVA CSV → ID Tax Rule PrestaShop ────────────────
//
// IMPORTANT : vérifier les IDs réels via GET /api/tax_rule_groups
// Les deux formes (virgule ET point) sont listées pour robustesse,
// car les CSV peuvent utiliser l'un ou l'autre selon l'export.
//
// Pour ajouter un taux : ajouter les deux variantes "X,XX%" et "X.XX%"
//
export const TAX_RATE_TO_RULE_ID = {
  // TVA ~11,65 % — groupe 1 (standard malgache)
  '11,65%': 1,
  '11.65%': 1,

  // TVA ~5,60 % — groupe 2 (réduite)
  '5,60%':  2,
  '5.60%':  2,

  // Exonéré
  '0%':     0,
  '0,00%':  0,
  '0.00%':  0,

  // Défaut si colonne Taxe vide
  '':       1,
};

// ─── Constantes PrestaShop ────────────────────────────────────
export const PRESTA_CONFIG = {
  ID_LANG:         1,
  ID_SHOP:         1,
  ID_SHOP_GROUP:   1,
  ID_CURRENCY:     1,
  ID_CARRIER:      2,
  ID_COUNTRY:      8,   // France
  DEFAULT_STATE:   2,   // Paiement accepté (cohérent avec ORDER_CONFIG dans orderService)
};