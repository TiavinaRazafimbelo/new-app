/**
 * importOrders.js
 * src/backoffice/import/importers/importOrders.js
 * ─────────────────────────────────────────────────────────────
 * Importe le CSV 3 dans PrestaShop 8.2.6.
 *
 * WORKFLOW PAR COMMANDE :
 *
 *   1. CLIENT
 *      a. Chercher si un customer existe déjà avec cet email
 *      b. Si non → créer le customer (prénom/nom déduit du champ "nom")
 *      c. Récupérer l'ID customer
 *
 *   2. ADRESSE
 *      a. Chercher si une adresse existe pour ce customer + alias
 *      b. Si non → créer l'adresse (alias "Mon adresse", pays France id=8)
 *      c. Récupérer l'ID adresse
 *
 *   3. RÉSOLUTION PRODUITS / DÉCLINAISONS
 *      Pour chaque article du panier :
 *      a. Chercher l'ID produit via sa référence
 *      b. Si variante non vide → chercher l'ID combinaison
 *         (via product_option_values + associations)
 *      c. Récupérer le prix HT unitaire (produit de base + supplément combo)
 *
 *   4. CART
 *      a. Créer un cart (POST /carts)
 *      b. Pour chaque article : ajouter au cart
 *         → Cette API n'est pas fiable dans PS, on stocke les lignes
 *           pour les intégrer directement dans order_detail.
 *
 *   5. ORDER
 *      a. Créer la commande (POST /orders) avec :
 *         - id_customer, id_address_delivery, id_address_invoice
 *         - id_cart (le cart créé)
 *         - current_state (etatPS)
 *         - les associations order_rows (articles)
 *      b. Récupérer l'ID commande
 *
 *   6. STOCK
 *      Décrémenter le stock de chaque article commandé
 *      (via PUT /stock_availables)
 *
 * NOTES IMPORTANTES :
 *   - PS 8 WebServices n'expose pas directement PUT /orders/:id/state
 *     On passe par POST /order_histories pour changer l'état
 *   - Les mots de passe CSV sont en clair → on les envoie via le champ
 *     "passwd" du customer (PS les hash côté serveur)
 *   - Le cart PS est créé mais l'API /carts ne permet pas d'ajouter
 *     des lignes facilement → on encode les order_rows directement
 *     dans le XML de la commande.
 * ─────────────────────────────────────────────────────────────
 */

import { prestaGet, prestaWrite, extraireVal } from '../config/prestaApi.js';

// ─── Configuration (cohérente avec ORDER_CONFIG de l'app) ─────

export const ORDER_CONFIG = {
  DEFAULT_ORDER_STATE:  2,    // Paiement accepté
  PAYMENT_MODULE:       'ps_cashondelivery',
  PAYMENT_LABEL:        'Cash On Delivery',
  SHIPPING_COST:        0,
  ID_COUNTRY:           8,    // France
  ID_CARRIER:           2,
  ID_LANG:              1,
  ID_CURRENCY:          1,
  ID_SHOP:              1,
  ID_SHOP_GROUP:        0,
  ID_ZONE:              1,    // Europe
  TAX_RATE_SHIPPING:    0,
};

// ─── Helpers XML ──────────────────────────────────────────────

/**
 * Extrait un ID depuis une réponse PS.
 * Gère les cas tableau (isArray) et objet direct.
 */
function extraireId(reponse, ressource) {
  const direct = reponse[ressource];
  if (Array.isArray(direct) && direct.length > 0)
    return Number(extraireVal(direct[0]?.id));
  if (direct && !Array.isArray(direct))
    return Number(extraireVal(direct?.id));
  const pluriel = reponse[ressource + 's']?.[ressource];
  if (Array.isArray(pluriel) && pluriel.length > 0)
    return Number(extraireVal(pluriel[0]?.id));
  if (pluriel && !Array.isArray(pluriel))
    return Number(extraireVal(pluriel?.id));
  return 0;
}

// ─── ÉTAPE 1 : Gestion du client ─────────────────────────────

/**
 * Cherche un customer PS par email.
 * Retourne { id, exists: true } ou { id: null, exists: false }.
 *
 * @param {string} email
 * @returns {Promise<{ id: number|null, exists: boolean }>}
 */
async function chercherCustomer(email) {
  try {
    const data  = await prestaGet(
      `/customers?filter[email]=${encodeURIComponent(email)}&display=full`
    );
    const bruts = data.customers?.customer || [];
    const liste = Array.isArray(bruts) ? bruts : [bruts];

    const trouve = liste.find(
      (c) => extraireVal(c.email).toLowerCase() === email.toLowerCase()
    );

    if (trouve) {
      return { id: Number(extraireVal(trouve.id)), exists: true };
    }
    return { id: null, exists: false };
  } catch {
    return { id: null, exists: false };
  }
}

/**
 * Crée un customer PS à partir du nom complet du CSV.
 *
 * Stratégie nom → prénom/nom :
 *   - Si un seul mot → prénom = mot, nom = "."
 *   - Sinon → prénom = premier mot, nom = reste
 *
 * @param {object} commande
 * @returns {Promise<number>} ID customer créé
 */
async function creerCustomer(commande) {
  const mots    = commande.nom.trim().split(/\s+/);
  const prenom  = mots[0] || 'Client';
  const nom     = mots.slice(1).join(' ') || '.';

  // PS exige un mot de passe haché ou en clair selon la version.
  // En PS 8, le champ "passwd" doit contenir le hash MD5 du mot de passe.
  // MAIS via WebServices, on peut envoyer le mot de passe en clair dans
  // un champ dédié si l'API l'accepte. Dans la pratique PS 8 WS accepte
  // le mot de passe en clair et le hash lui-même. On l'envoie tel quel.
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop xmlns:xlink="http://www.w3.org/1999/xlink">
  <customer>
    <firstname><![CDATA[${prenom}]]></firstname>
    <lastname><![CDATA[${nom}]]></lastname>
    <email><![CDATA[${commande.email}]]></email>
    <passwd><![CDATA[${commande.pwd}]]></passwd>
    <active><![CDATA[1]]></active>
    <deleted><![CDATA[0]]></deleted>
    <id_default_group><![CDATA[3]]></id_default_group>
    <id_lang><![CDATA[${ORDER_CONFIG.ID_LANG}]]></id_lang>
    <id_shop><![CDATA[${ORDER_CONFIG.ID_SHOP}]]></id_shop>
    <newsletter><![CDATA[0]]></newsletter>
    <optin><![CDATA[0]]></optin>
    <is_guest><![CDATA[0]]></is_guest>
  </customer>
</prestashop>`;

  const res = await prestaWrite('/customers', xml, 'POST');
  const id  = extraireId(res, 'customer');
  if (!id) throw new Error(
    `Customer non créé pour "${commande.email}" — réponse : ${JSON.stringify(res).slice(0, 200)}`
  );
  return id;
}

// ─── ÉTAPE 2 : Gestion de l'adresse ──────────────────────────

/**
 * Cherche une adresse PS pour un customer donné.
 * Retourne l'ID si trouvé, null sinon.
 *
 * @param {number} idCustomer
 * @returns {Promise<number|null>}
 */
async function chercherAdresse(idCustomer) {
  try {
    const data  = await prestaGet(
      `/addresses?filter[id_customer]=${idCustomer}&display=full`
    );
    const bruts = data.addresses?.address || [];
    const liste = Array.isArray(bruts) ? bruts : [bruts];

    // Prendre la première adresse active (deleted=0)
    const active = liste.find(
      (a) => String(extraireVal(a.deleted)) === '0'
    );
    return active ? Number(extraireVal(active.id)) : null;
  } catch {
    return null;
  }
}

/**
 * Crée une adresse PS pour un customer.
 *
 * L'adresse CSV est une ville/quartier malgache → on la met dans city.
 * PS exige a minima : id_customer, id_country, alias, lastname, firstname,
 * address1, city.
 *
 * @param {number} idCustomer
 * @param {object} commande
 * @returns {Promise<number>} ID adresse créée
 */
async function creerAdresse(idCustomer, commande) {
  const mots   = commande.nom.trim().split(/\s+/);
  const prenom = mots[0] || 'Client';
  const nom    = mots.slice(1).join(' ') || '.';

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop xmlns:xlink="http://www.w3.org/1999/xlink">
  <address>
    <id_customer><![CDATA[${idCustomer}]]></id_customer>
    <id_country><![CDATA[${ORDER_CONFIG.ID_COUNTRY}]]></id_country>
    <id_state><![CDATA[0]]></id_state>
    <alias><![CDATA[Mon adresse]]></alias>
    <company><![CDATA[]]></company>
    <lastname><![CDATA[${nom}]]></lastname>
    <firstname><![CDATA[${prenom}]]></firstname>
    <vat_number><![CDATA[]]></vat_number>
    <address1><![CDATA[${commande.adresse}]]></address1>
    <address2><![CDATA[]]></address2>
    <postcode><![CDATA[00000]]></postcode>
    <city><![CDATA[${commande.adresse}]]></city>
    <phone><![CDATA[]]></phone>
    <phone_mobile><![CDATA[]]></phone_mobile>
    <active><![CDATA[1]]></active>
    <deleted><![CDATA[0]]></deleted>
  </address>
</prestashop>`;

  const res = await prestaWrite('/addresses', xml, 'POST');
  const id  = extraireId(res, 'address');
  if (!id) throw new Error(
    `Adresse non créée pour customer ${idCustomer} — réponse : ${JSON.stringify(res).slice(0, 200)}`
  );
  return id;
}

// ─── ÉTAPE 3 : Résolution produits / déclinaisons ─────────────

/**
 * Charge tous les produits PS (référence → données).
 * Retourne une Map<reference, { id, priceHT, idTaxGroup }>.
 *
 * @returns {Promise<Map>}
 */
async function chargerProduits() {
  const data  = await prestaGet('/products?display=full');
  const bruts = data.products?.product || [];
  const liste = Array.isArray(bruts) ? bruts : [bruts];

  const map = new Map();
  for (const p of liste) {
    const ref = extraireVal(p.reference).trim();
    if (!ref) continue;
    map.set(ref, {
      id:           Number(extraireVal(p.id)),
      priceHT:      parseFloat(extraireVal(p.price) || '0'),
      idTaxGroup:   Number(extraireVal(p.id_tax_rules_group)),
      taxRate:      0, // sera rempli si nécessaire
    });
  }
  return map;
}

/**
 * Charge toutes les combinaisons PS pour un produit.
 * Retourne une Map<nomValeurLower, { idCombi, supplementHT }>.
 *
 * On indexe par le nom de la valeur d'attribut (ex: "ngoza", "kely").
 *
 * POURQUOI DEUX REQUÊTES SÉPARÉES :
 *   - GET /combinations?filter[id_product]=X&display=full  → donne les combis
 *     avec leurs associations product_option_values (liste d'IDs seulement).
 *   - GET /product_option_values?display=full              → donne les noms.
 *   On recoupe les deux pour obtenir Map<nomLower, idCombi>.
 *
 * PIÈGE fast-xml-parser :
 *   Dans les associations d'une combinaison, chaque <product_option_value>
 *   ne contient qu'un <id> — qui peut être parsé comme :
 *     { id: 5 }                    → parseAttributeValue=true
 *     { id: { __cdata: "5" } }     → si CDATA
 *     { id: { '#text': 5 } }       → selon la config
 *   On utilise extraireVal() qui gère tous ces cas.
 *
 * @param {number} idProduit
 * @param {Function} [log]   - callback optionnel pour debug
 * @returns {Promise<Map<string, { idCombi: number, supplementHT: number }>>}
 */
async function chargerCombinaisonsProduit(idProduit, log = null) {
  const map = new Map();

  // ── 1. Récupérer les combinaisons du produit ──────────────
  const dataCombis = await prestaGet(
    `/combinations?filter[id_product]=${idProduit}&display=full`
  );
  const brutsCombis = dataCombis.combinations?.combination || [];
  const listeCombis = Array.isArray(brutsCombis) ? brutsCombis : [brutsCombis];

  if (listeCombis.length === 0) {
    log?.('info', `Produit id=${idProduit} : aucune combinaison trouvée dans PS`);
    return map;
  }

  log?.('info', `Produit id=${idProduit} : ${listeCombis.length} combinaison(s) trouvée(s) dans PS`);

  // ── 2. Récupérer toutes les valeurs d'attributs ───────────
  // On charge TOUTES les valeurs (pas seulement celles du produit)
  // car l'endpoint ne permet pas de filtrer par produit directement.
  const dataVals  = await prestaGet('/product_option_values?display=full');
  const brutsVals = dataVals.product_option_values?.product_option_value || [];
  const listeVals = Array.isArray(brutsVals) ? brutsVals : [brutsVals];

  // Index : id (number) → Set<string> de TOUS les labels (toutes langues)
  //
  // POURQUOI TOUTES LES LANGUES :
  //   Le CSV 2 (importCombinations) stocke le label malgache (ex: "ngoza")
  //   dans la langue 2, et le label FR (ex: "petite taille") dans la langue 1.
  //   Le CSV 3 référence les variantes avec le label malgache du CSV 2.
  //   On doit donc indexer TOUS les labels de TOUTES les langues pour chaque
  //   valeur d'attribut, afin que "ngoza" ET "petite taille" pointent vers
  //   le même id_product_option_value.
  //
  // Structure PS après parsing fast-xml-parser :
  //   v.name = { language: [ { @_id: 1, __cdata: "petite taille" },
  //                           { @_id: 2, __cdata: "ngoza" } ] }
  //   ou pour une seule langue :
  //   v.name = { language: { @_id: 1, __cdata: "petite taille" } }

  // Map<idVal, Set<nomLower>> — un ID peut avoir plusieurs labels (une par langue)
  const nomsParId = new Map();

  for (const v of listeVals) {
    const id = Number(extraireVal(v.id));
    if (!id) continue;

    const labels = new Set();

    // Extraire tous les labels multilingues
    if (v.name?.language) {
      const langues = Array.isArray(v.name.language) ? v.name.language : [v.name.language];
      for (const l of langues) {
        // Chaque noeud langue peut avoir __cdata, #text, ou être une string
        const texte = (l.__cdata ?? l['#text'] ?? '').toString().toLowerCase().trim();
        if (texte) labels.add(texte);
      }
    } else {
      // Champ non multilingue ou déjà une string
      const texte = extraireVal(v.name).toLowerCase().trim();
      if (texte) labels.add(texte);
    }

    if (labels.size > 0) nomsParId.set(id, labels);
  }

  // Map inverse : nomLower → id  (tous labels de toutes langues)
  const nomParId = new Map();
  for (const [id, labels] of nomsParId) {
    for (const label of labels) {
      if (!nomParId.has(label)) nomParId.set(label, id);
    }
  }

  log?.('info', `${nomParId.size} label(s) d'attribut indexé(s) (toutes langues)`);

  // ── 3. Construire la map combi ────────────────────────────
  for (const combi of listeCombis) {
    const idCombi      = Number(extraireVal(combi.id));
    const supplementHT = parseFloat(extraireVal(combi.price) || '0');

    // Les associations peuvent avoir plusieurs formes selon le parser :
    //   { product_option_value: { id: 5 } }          → objet unique
    //   { product_option_value: [{ id: 5 }, ...] }   → tableau (isArray)
    //   undefined si la combi n'a pas d'option (ne devrait pas arriver)
    const optsRaw = combi.associations?.product_option_values?.product_option_value;

    if (!optsRaw) {
      log?.('warning', `Combinaison id=${idCombi} : associations manquantes`);
      continue;
    }

    const opts = Array.isArray(optsRaw) ? optsRaw : [optsRaw];

    for (const opt of opts) {
      // L'ID peut être : un nombre, une string, ou un objet { __cdata } / { #text }
      const idVal = Number(extraireVal(opt.id));

      if (!idVal) {
        log?.('warning', `Combinaison id=${idCombi} : id valeur d'attribut non extrait — opt.id=${JSON.stringify(opt.id)}`);
        continue;
      }

      // nomParId est maintenant Map<labelLower, idVal> — on cherche par idVal
      // On a besoin de l'inverse : idVal → label(s)
      // On parcourt pour trouver tous les labels associés à cet idVal
      const labelsDeceVal = [...nomParId.entries()]
        .filter(([, vid]) => vid === idVal)
        .map(([label]) => label);

      if (labelsDeceVal.length === 0) {
        log?.('warning', `Combinaison id=${idCombi} : valeur id=${idVal} introuvable dans l'index`);
        continue;
      }

      // Indexer TOUS les labels de cette valeur → même combi
      for (const label of labelsDeceVal) {
        map.set(label, { idCombi, supplementHT });
      }
      log?.('info', `  Combinaison id=${idCombi} → labels [${labelsDeceVal.join(' | ')}] (id=${idVal}), supplement=${supplementHT}`);
    }
  }

  return map;
}

// ─── ÉTAPE 4 : Création du cart ───────────────────────────────

/**
 * Crée un cart PS vide.
 * Retourne l'ID du cart créé.
 *
 * Note : PS 8 WS permet de créer un cart mais pas d'y ajouter
 * des lignes via l'API REST. Les lignes seront encodées directement
 * dans les order_rows de la commande.
 *
 * @param {number} idCustomer
 * @param {number} idAdresse
 * @returns {Promise<number>}
 */
async function creerCart(idCustomer, idAdresse) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop xmlns:xlink="http://www.w3.org/1999/xlink">
  <cart>
    <id_currency><![CDATA[${ORDER_CONFIG.ID_CURRENCY}]]></id_currency>
    <id_lang><![CDATA[${ORDER_CONFIG.ID_LANG}]]></id_lang>
    <id_shop><![CDATA[${ORDER_CONFIG.ID_SHOP}]]></id_shop>
    <id_shop_group><![CDATA[${ORDER_CONFIG.ID_SHOP_GROUP}]]></id_shop_group>
    <id_customer><![CDATA[${idCustomer}]]></id_customer>
    <id_address_delivery><![CDATA[${idAdresse}]]></id_address_delivery>
    <id_address_invoice><![CDATA[${idAdresse}]]></id_address_invoice>
    <id_carrier><![CDATA[${ORDER_CONFIG.ID_CARRIER}]]></id_carrier>
    <recyclable><![CDATA[0]]></recyclable>
    <gift><![CDATA[0]]></gift>
    <gift_message><![CDATA[]]></gift_message>
    <mobile_theme><![CDATA[0]]></mobile_theme>
    <delivery_option><![CDATA[]]></delivery_option>
    <secure_key><![CDATA[]]></secure_key>
    <allow_seperated_package><![CDATA[0]]></allow_seperated_package>
  </cart>
</prestashop>`;

  const res = await prestaWrite('/carts', xml, 'POST');
  const id  = extraireId(res, 'cart');
  if (!id) throw new Error(
    `Cart non créé — réponse : ${JSON.stringify(res).slice(0, 200)}`
  );
  return id;
}

// ─── ÉTAPE 5 : Création de la commande ───────────────────────

/**
 * Calcule le total TTC d'une commande à partir des articles.
 *
 * @param {Array} lignesResolues - articles avec prixHT et tauxTVA
 * @returns {{ totalHT: number, totalTTC: number, totalTVA: number }}
 */
function calculerTotaux(lignesResolues) {
  let totalHT  = 0;
  let totalTTC = 0;

  for (const ligne of lignesResolues) {
    const ht  = ligne.prixUnitaireHT * ligne.quantite;
    const ttc = ht * (1 + ligne.tauxTVA / 100);
    totalHT  += ht;
    totalTTC += ttc;
  }

  return {
    totalHT:  Math.round(totalHT  * 1000000) / 1000000,
    totalTTC: Math.round(totalTTC * 1000000) / 1000000,
    totalTVA: Math.round((totalTTC - totalHT) * 1000000) / 1000000,
  };
}

/**
 * Construit et envoie le XML d'une commande PS.
 *
 * Le XML order inclut les order_rows (lignes de commande) directement
 * car l'API PS ne propose pas d'endpoint séparé pour les ajouter après.
 *
 * @param {object} params
 * @returns {Promise<number>} ID commande créée
 */
async function creerCommande({
  idCustomer,
  idAdresse,
  idCart,
  dateCommande,
  etatPS,
  lignesResolues,
}) {
  const { totalHT, totalTTC, totalTVA } = calculerTotaux(lignesResolues);

  // Construire les order_rows XML
  const orderRowsXml = lignesResolues.map((ligne) => {
    const prixTotalHT  = (ligne.prixUnitaireHT * ligne.quantite).toFixed(6);
    const tauxDecimal  = (ligne.tauxTVA / 100).toFixed(6);
    const prixTaxeHT   = (ligne.prixUnitaireHT * (1 + ligne.tauxTVA / 100)).toFixed(6);

    return `<order_row>
      <product_id><![CDATA[${ligne.idProduit}]]></product_id>
      <product_attribute_id><![CDATA[${ligne.idCombi ?? 0}]]></product_attribute_id>
      <product_quantity><![CDATA[${ligne.quantite}]]></product_quantity>
      <product_name><![CDATA[${ligne.nomProduit}]]></product_name>
      <product_reference><![CDATA[${ligne.reference}]]></product_reference>
      <product_ean13><![CDATA[]]></product_ean13>
      <product_isbn><![CDATA[]]></product_isbn>
      <product_upc><![CDATA[]]></product_upc>
      <product_price><![CDATA[${ligne.prixUnitaireHT.toFixed(6)}]]></product_price>
      <reduction_percent><![CDATA[0]]></reduction_percent>
      <reduction_amount><![CDATA[0.000000]]></reduction_amount>
      <reduction_amount_tax_incl><![CDATA[0.000000]]></reduction_amount_tax_incl>
      <reduction_amount_tax_excl><![CDATA[0.000000]]></reduction_amount_tax_excl>
      <group_reduction><![CDATA[0.000000]]></group_reduction>
      <product_quantity_in_stock><![CDATA[${ligne.stockDispo}]]></product_quantity_in_stock>
      <product_price_reduct_excl><![CDATA[${ligne.prixUnitaireHT.toFixed(6)}]]></product_price_reduct_excl>
      <product_price_reduct_incl><![CDATA[${prixTaxeHT}]]></product_price_reduct_incl>
      <unit_price_tax_incl><![CDATA[${prixTaxeHT}]]></unit_price_tax_incl>
      <unit_price_tax_excl><![CDATA[${ligne.prixUnitaireHT.toFixed(6)}]]></unit_price_tax_excl>
      <total_price_tax_incl><![CDATA[${(parseFloat(prixTaxeHT) * ligne.quantite).toFixed(6)}]]></total_price_tax_incl>
      <total_price_tax_excl><![CDATA[${prixTotalHT}]]></total_price_tax_excl>
      <tax_computation_method><![CDATA[0]]></tax_computation_method>
      <tax_name><![CDATA[]]></tax_name>
      <tax_rate><![CDATA[${tauxDecimal}]]></tax_rate>
      <ecotax><![CDATA[0.000000]]></ecotax>
      <ecotax_tax_rate><![CDATA[0]]></ecotax_tax_rate>
      <discount_quantity_applied><![CDATA[0]]></discount_quantity_applied>
      <download_hash><![CDATA[]]></download_hash>
      <download_nb><![CDATA[0]]></download_nb>
      <download_deadline><![CDATA[0000-00-00 00:00:00]]></download_deadline>
      <id_order_invoice><![CDATA[0]]></id_order_invoice>
      <id_warehouse><![CDATA[0]]></id_warehouse>
      <id_shop><![CDATA[${ORDER_CONFIG.ID_SHOP}]]></id_shop>
      <id_customization><![CDATA[0]]></id_customization>
      <original_product_price><![CDATA[${ligne.prixUnitaireHT.toFixed(6)}]]></original_product_price>
      <original_wholesale_price><![CDATA[0.000000]]></original_wholesale_price>
    </order_row>`;
  }).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop xmlns:xlink="http://www.w3.org/1999/xlink">
  <order>
    <id_address_delivery><![CDATA[${idAdresse}]]></id_address_delivery>
    <id_address_invoice><![CDATA[${idAdresse}]]></id_address_invoice>
    <id_cart><![CDATA[${idCart}]]></id_cart>
    <id_currency><![CDATA[${ORDER_CONFIG.ID_CURRENCY}]]></id_currency>
    <id_lang><![CDATA[${ORDER_CONFIG.ID_LANG}]]></id_lang>
    <id_customer><![CDATA[${idCustomer}]]></id_customer>
    <id_carrier><![CDATA[${ORDER_CONFIG.ID_CARRIER}]]></id_carrier>
    <id_shop_group><![CDATA[${ORDER_CONFIG.ID_SHOP_GROUP}]]></id_shop_group>
    <id_shop><![CDATA[${ORDER_CONFIG.ID_SHOP}]]></id_shop>
    <current_state><![CDATA[${etatPS}]]></current_state>
    <module><![CDATA[${ORDER_CONFIG.PAYMENT_MODULE}]]></module>
    <invoice_number><![CDATA[0]]></invoice_number>
    <invoice_date><![CDATA[0000-00-00 00:00:00]]></invoice_date>
    <delivery_number><![CDATA[0]]></delivery_number>
    <delivery_date><![CDATA[0000-00-00 00:00:00]]></delivery_date>
    <valid><![CDATA[1]]></valid>
    <date_add><![CDATA[${dateCommande} 00:00:00]]></date_add>
    <date_upd><![CDATA[${dateCommande} 00:00:00]]></date_upd>
    <shipping_number><![CDATA[]]></shipping_number>
    <note><![CDATA[]]></note>
    <id_warehouse><![CDATA[0]]></id_warehouse>
    <recyclable><![CDATA[0]]></recyclable>
    <gift><![CDATA[0]]></gift>
    <gift_message><![CDATA[]]></gift_message>
    <mobile_theme><![CDATA[0]]></mobile_theme>
    <total_discounts><![CDATA[0.000000]]></total_discounts>
    <total_discounts_tax_incl><![CDATA[0.000000]]></total_discounts_tax_incl>
    <total_discounts_tax_excl><![CDATA[0.000000]]></total_discounts_tax_excl>
    <total_paid><![CDATA[${totalTTC.toFixed(6)}]]></total_paid>
    <total_paid_tax_incl><![CDATA[${totalTTC.toFixed(6)}]]></total_paid_tax_incl>
    <total_paid_tax_excl><![CDATA[${totalHT.toFixed(6)}]]></total_paid_tax_excl>
    <total_paid_real><![CDATA[${totalTTC.toFixed(6)}]]></total_paid_real>
    <total_products><![CDATA[${totalHT.toFixed(6)}]]></total_products>
    <total_products_wt><![CDATA[${totalTTC.toFixed(6)}]]></total_products_wt>
    <total_shipping><![CDATA[${ORDER_CONFIG.SHIPPING_COST.toFixed(6)}]]></total_shipping>
    <total_shipping_tax_incl><![CDATA[${ORDER_CONFIG.SHIPPING_COST.toFixed(6)}]]></total_shipping_tax_incl>
    <total_shipping_tax_excl><![CDATA[${ORDER_CONFIG.SHIPPING_COST.toFixed(6)}]]></total_shipping_tax_excl>
    <carrier_tax_rate><![CDATA[${ORDER_CONFIG.TAX_RATE_SHIPPING}]]></carrier_tax_rate>
    <total_wrapping><![CDATA[0.000000]]></total_wrapping>
    <total_wrapping_tax_incl><![CDATA[0.000000]]></total_wrapping_tax_incl>
    <total_wrapping_tax_excl><![CDATA[0.000000]]></total_wrapping_tax_excl>
    <round_mode><![CDATA[2]]></round_mode>
    <round_type><![CDATA[1]]></round_type>
    <conversion_rate><![CDATA[1.000000]]></conversion_rate>
    <payment><![CDATA[${ORDER_CONFIG.PAYMENT_LABEL}]]></payment>
    <secure_key><![CDATA[]]></secure_key>
    <associations>
      <order_rows>
        ${orderRowsXml}
      </order_rows>
    </associations>
  </order>
</prestashop>`;

  const res = await prestaWrite('/orders', xml, 'POST');
  const id  = extraireId(res, 'order');
  if (!id) throw new Error(
    `Commande non créée — réponse : ${JSON.stringify(res).slice(0, 200)}`
  );
  return id;
}

// ─── ÉTAPE 6 : Mise à jour de l'état de commande ─────────────

/**
 * Ajoute un historique d'état pour une commande PS.
 * C'est le mécanisme officiel pour changer l'état d'une commande en PS.
 *
 * @param {number} idOrder
 * @param {number} idOrderState
 * @returns {Promise<void>}
 */
async function ajouterEtatCommande(idOrder, idOrderState) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop xmlns:xlink="http://www.w3.org/1999/xlink">
  <order_history>
    <id_order><![CDATA[${idOrder}]]></id_order>
    <id_order_state><![CDATA[${idOrderState}]]></id_order_state>
    <id_employee><![CDATA[0]]></id_employee>
    <date_add><![CDATA[]]></date_add>
    <send_email><![CDATA[0]]></send_email>
    <message><![CDATA[]]></message>
  </order_history>
</prestashop>`;

  await prestaWrite('/order_histories', xml, 'POST');
}

// ─── ÉTAPE 7 : Décrémentation du stock ───────────────────────

/**
 * Trouve l'ID stock_available pour un produit + combinaison.
 *
 * @param {number} idProduit
 * @param {number} idCombi  - 0 pour produit simple
 * @returns {Promise<number|null>}
 */
async function trouverStockAvailableId(idProduit, idCombi = 0) {
  try {
    const data  = await prestaGet(
      `/stock_availables?filter[id_product]=${idProduit}&filter[id_product_attribute]=${idCombi}&display=full`
    );
    const bruts = data.stock_availables?.stock_available || [];
    const liste = Array.isArray(bruts) ? bruts : [bruts];

    // Priorité : id_shop=1 sur id_shop=0
    const sorted = [...liste].sort(
      (a, b) => Number(extraireVal(b.id_shop)) - Number(extraireVal(a.id_shop))
    );

    if (!sorted.length) return null;

    return {
      idStock:   Number(extraireVal(sorted[0].id)),
      quantite:  Number(extraireVal(sorted[0].quantity)),
    };
  } catch {
    return null;
  }
}

/**
 * Décrémente le stock d'un article.
 *
 * @param {number} idStock
 * @param {number} idProduit
 * @param {number} idCombi
 * @param {number} nouvelleQuantite
 * @returns {Promise<void>}
 */
async function decrementerStock(idStock, idProduit, idCombi, nouvelleQuantite) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop xmlns:xlink="http://www.w3.org/1999/xlink">
  <stock_available>
    <id>${idStock}</id>
    <id_product>${idProduit}</id_product>
    <id_product_attribute>${idCombi}</id_product_attribute>
    <id_shop>${ORDER_CONFIG.ID_SHOP}</id_shop>
    <id_shop_group>${ORDER_CONFIG.ID_SHOP_GROUP}</id_shop_group>
    <quantity>${Math.max(0, nouvelleQuantite)}</quantity>
    <depends_on_stock>0</depends_on_stock>
    <out_of_stock>2</out_of_stock>
  </stock_available>
</prestashop>`;

  await prestaWrite(`/stock_availables/${idStock}`, xml, 'PUT');
}

// ─── Import principal ─────────────────────────────────────────

/**
 * Importe toutes les commandes du CSV 3.
 *
 * @param {CommandeRow[]} commandes - sortie de parseCSVCommandes().commandes
 * @param {Function}      onLog     - callback({ type, message, ref })
 * @returns {Promise<Bilan>}
 */
export async function importerCommandes(commandes, onLog) {
  const log   = (type, message, ref = '') => onLog({ type, message, ref });
  const bilan = {
    crees:          0,
    clientsCrees:   0,
    clientsExistants: 0,
    skips:          0,
    erreurs:        0,
    details:        [],
  };

  // ── Pré-chargement des produits PS ────────────────────────
  log('info', 'Chargement des produits PrestaShop…');
  let produitsMap;
  try {
    produitsMap = await chargerProduits();
    log('info', `${produitsMap.size} produit(s) chargé(s)`);
  } catch (err) {
    log('erreur', `Impossible de charger les produits : ${err.message}`);
    throw err;
  }

  // ── Pré-chargement du mapping TVA ─────────────────────────
  // On charge les taxes pour connaître le taux de chaque groupe
  log('info', 'Chargement des taux de TVA…');
  let tauxParGroupe = new Map(); // Map<idTaxGroup, tauxTVA>
  try {
    const taxesData  = await prestaGet('/taxes?display=full');
    const taxesBruts = taxesData.taxes?.tax || [];
    const taxesListe = Array.isArray(taxesBruts) ? taxesBruts : [taxesBruts];
    const taxById    = new Map();
    for (const t of taxesListe) {
      taxById.set(Number(extraireVal(t.id)), parseFloat(extraireVal(t.rate) || '0'));
    }

    const rulesData  = await prestaGet('/tax_rules?display=full');
    const rulesBruts = rulesData.tax_rules?.tax_rule || [];
    const rulesListe = Array.isArray(rulesBruts) ? rulesBruts : [rulesBruts];
    for (const rule of rulesListe) {
      const groupId = Number(extraireVal(rule.id_tax_rules_group));
      const taxId   = Number(extraireVal(rule.id_tax));
      if (!tauxParGroupe.has(groupId) && taxById.has(taxId)) {
        tauxParGroupe.set(groupId, taxById.get(taxId));
      }
    }
    log('info', `${tauxParGroupe.size} taux TVA chargé(s)`);
  } catch (err) {
    log('erreur', `Impossible de charger les taxes : ${err.message}`);
    throw err;
  }

  // Enrichir la map produits avec le taux TVA
  for (const [ref, produit] of produitsMap) {
    produit.taxRate = tauxParGroupe.get(produit.idTaxGroup) ?? 0;
    produitsMap.set(ref, produit);
  }

  // Cache des combinaisons par idProduit
  // Map<idProduit, Map<nomVarianteLower, { idCombi, supplementHT }>>
  const combiCache = new Map();

  // ── Traitement commande par commande ──────────────────────
  log('info', `Début import — ${commandes.length} commande(s) à traiter`);

  for (const commande of commandes) {
    const ref = commande.email; // Référence humaine pour les logs

    log('info', `── Commande ligne ${commande.ligneCSV} : ${commande.email}`, ref);

    try {
      // ── Étape 1 : Client ───────────────────────────────────
      log('info', `Recherche client : ${commande.email}`, ref);
      const { id: idExistant, exists } = await chercherCustomer(commande.email);

      let idCustomer;
      if (exists) {
        idCustomer = idExistant;
        log('info', `Client existant : id=${idCustomer}`, ref);
        bilan.clientsExistants++;
      } else {
        log('info', `Client absent → création : "${commande.nom}" <${commande.email}>`, ref);
        idCustomer = await creerCustomer(commande);
        log('succes', `Client créé : id=${idCustomer}`, ref);
        bilan.clientsCrees++;
      }

      // ── Étape 2 : Adresse ──────────────────────────────────
      log('info', `Recherche adresse pour customer id=${idCustomer}`, ref);
      let idAdresse = await chercherAdresse(idCustomer);

      if (!idAdresse) {
        log('info', `Adresse absente → création : "${commande.adresse}"`, ref);
        idAdresse = await creerAdresse(idCustomer, commande);
        log('succes', `Adresse créée : id=${idAdresse}`, ref);
      } else {
        log('info', `Adresse existante : id=${idAdresse}`, ref);
      }

      // ── Étape 3 : Résolution articles ──────────────────────
      log('info', `Résolution de ${commande.articles.length} article(s)…`, ref);
      const lignesResolues = [];
      let erreurArticle    = false;

      for (const article of commande.articles) {
        const produit = produitsMap.get(article.reference);

        if (!produit) {
          log('erreur', `Produit "${article.reference}" introuvable dans PS`, ref);
          erreurArticle = true;
          break;
        }

        let idCombi     = 0;
        let supplementHT = 0;

        // Si la variante est non vide → chercher la combinaison
        if (article.variante) {
          // Charger les combis du produit si pas encore en cache
          if (!combiCache.has(produit.id)) {
            log('info', `Chargement combinaisons produit id=${produit.id}...`, ref);
            // On passe le log pour voir le detail du mapping en cas de probleme
            const combis = await chargerCombinaisonsProduit(
              produit.id,
              (type, msg) => log(type, msg, ref)
            );
            combiCache.set(produit.id, combis);
            // Afficher les cles de la map pour diagnostic
            const keysDebug = [...combis.keys()].join(', ') || 'VIDE';
            log('info', `Map variants "${article.reference}" : [${keysDebug}]`, ref);
          }

          const combisMap     = combiCache.get(produit.id);
          const varianteLower = article.variante.toLowerCase().trim();
          const combiData     = combisMap.get(varianteLower);

          if (!combiData) {
            log('erreur',
              `Variante "${article.variante}" introuvable pour "${article.reference}"`,
              ref
            );
            erreurArticle = true;
            break;
          }

          idCombi      = combiData.idCombi;
          supplementHT = combiData.supplementHT;
          log('info',
            `Variante "${article.variante}" → id_combi=${idCombi}, supplement=${supplementHT}`,
            ref
          );
        }

        // Récupérer le stock disponible
        const stockInfo = await trouverStockAvailableId(produit.id, idCombi);
        const stockDispo = stockInfo?.quantite ?? 0;

        lignesResolues.push({
          reference:      article.reference,
          idProduit:      produit.id,
          idCombi:        idCombi || null,
          nomProduit:     article.reference, // PS ne fournit pas le nom facilement ici
          quantite:       article.quantite,
          prixUnitaireHT: produit.priceHT + supplementHT,
          tauxTVA:        produit.taxRate,
          stockDispo,
          stockInfoId:    stockInfo?.idStock,
          stockInfoQte:   stockInfo?.quantite,
        });

        log('info',
          `"${article.reference}" ×${article.quantite} — HT=${produit.priceHT.toFixed(4)} + supp=${supplementHT.toFixed(4)} — TVA=${produit.taxRate}% — stock=${stockDispo}`,
          ref
        );
      }

      if (erreurArticle) {
        bilan.erreurs++;
        bilan.details.push({
          ref, statut: 'erreur', raison: 'Article non résolu', email: commande.email,
        });
        continue;
      }

      // ── Étape 4 : Cart ─────────────────────────────────────
      log('info', `Création du cart…`, ref);
      const idCart = await creerCart(idCustomer, idAdresse);
      log('succes', `Cart créé : id=${idCart}`, ref);

      // ── Étape 5 : Commande ─────────────────────────────────
      log('info', `Création de la commande (état=${commande.etatPS})…`, ref);
      const idOrder = await creerCommande({
        idCustomer,
        idAdresse,
        idCart,
        dateCommande: commande.date,
        etatPS:       commande.etatPS,
        lignesResolues,
      });
      log('succes', `Commande créée : id=${idOrder}`, ref);

      // ── Étape 6 : Historique d'état ────────────────────────
      // Même si l'état est déjà dans current_state, PS requiert
      // un order_history pour que le statut s'affiche correctement
      // dans le backoffice.
      try {
        await ajouterEtatCommande(idOrder, commande.etatPS);
        log('info', `Historique état id=${commande.etatPS} ajouté`, ref);
      } catch (err) {
        // Non bloquant
        log('warning', `Historique état non ajouté : ${err.message}`, ref);
      }

      // ── Étape 7 : Décrémentation du stock ──────────────────
      for (const ligne of lignesResolues) {
        if (ligne.stockInfoId != null) {
          const nouvelleQte = ligne.stockInfoQte - ligne.quantite;
          try {
            await decrementerStock(
              ligne.stockInfoId,
              ligne.idProduit,
              ligne.idCombi ?? 0,
              nouvelleQte
            );
            log('info',
              `Stock "${ligne.reference}" : ${ligne.stockInfoQte} → ${Math.max(0, nouvelleQte)}`,
              ref
            );
          } catch (err) {
            log('warning',
              `Décrémentation stock "${ligne.reference}" échouée : ${err.message}`,
              ref
            );
          }
        }
      }

      log('succes',
        `Commande ${commande.email} (${commande.date}) importée → id=${idOrder}`,
        ref
      );
      bilan.crees++;
      bilan.details.push({
        ref,
        statut:   'succes',
        idOrder,
        idCustomer,
        email:    commande.email,
        articles: commande.articles.length,
      });

    } catch (err) {
      log('erreur', `Commande "${ref}" : ${err.message}`, ref);
      bilan.erreurs++;
      bilan.details.push({
        ref,
        statut: 'erreur',
        raison: err.message,
        email:  commande.email,
      });
    }
  }

  log(
    'info',
    `Import terminé — ✓ ${bilan.crees} commande(s) · 👤 ${bilan.clientsCrees} client(s) créé(s) · ⚠ ${bilan.skips} ignoré(s) · ✗ ${bilan.erreurs} erreur(s)`
  );

  return bilan;
}