/**
 * importCombinations.js
 * src/backoffice/import/importers/importCombinations.js
 * ─────────────────────────────────────────────────────────────
 * CORRECTIFS :
 *
 *   1. GROUPE D'ATTRIBUTS — double indexation de la Map :
 *      On indexe désormais par DEUX clés :
 *        - extraireVal(g.name).toLowerCase()   → nom stocké dans PS (label FR)
 *        - extraireVal(g.public_name).toLowerCase() → nom public (idem en général)
 *      Et le lookup utilise specificitePS.trim().toLowerCase() ce qui correspond
 *      exactement à la clé stockée. Plus de faux-négatif = plus de doublons créés.
 *
 *   2. STOCK PRODUIT DE BASE — après tous les combos d'un produit :
 *      La ligne stock_available avec id_product_attribute=0 est mise à jour
 *      avec la SOMME des stock_initial de toutes les combinaisons du produit.
 *      PS attend cette valeur agrégée pour afficher "X en stock" sur la fiche.
 *
 * ─────────────────────────────────────────────────────────────
 */

import { prestaGet, prestaWrite, extraireVal } from '../config/prestaApi.js';
import { chargerTaxMapping, resoudreTaxGroup, ttcVersHT } from '../config/taxMapping.js';

const ID_SHOP       = 1;
const ID_SHOP_GROUP = 0;
const ID_LANG       = 1;

// ─── Langues actives ──────────────────────────────────────────

async function chargerLangues() {
  try {
    const data  = await prestaGet('/languages?display=full&filter[active]=1');
    const bruts = data.languages?.language || [];
    const liste = Array.isArray(bruts) ? bruts : [bruts];
    const ids   = liste.map((l) => Number(extraireVal(l.id))).filter(Boolean);
    return ids.length ? ids : [1];
  } catch {
    return [1];
  }
}

// ─── Bloc XML multilingue ─────────────────────────────────────

function blocML(tag, valeur, langIds) {
  const inner = langIds
    .map((id) => `<language id="${id}"><![CDATA[${valeur}]]></language>`)
    .join('');
  return `<${tag}>${inner}</${tag}>`;
}

// ─── Extraction ID depuis réponse PS ─────────────────────────

function extraireId(reponse, ressource) {
  const direct = reponse[ressource];
  if (Array.isArray(direct) && direct.length > 0) return Number(extraireVal(direct[0]?.id));
  if (direct && !Array.isArray(direct))            return Number(extraireVal(direct?.id));
  const pluriel = reponse[ressource + 's']?.[ressource];
  if (Array.isArray(pluriel) && pluriel.length > 0) return Number(extraireVal(pluriel[0]?.id));
  if (pluriel && !Array.isArray(pluriel))            return Number(extraireVal(pluriel?.id));
  return 0;
}

// ─── Chargement produits ──────────────────────────────────────

async function chargerProduits() {
  const data  = await prestaGet('/products?display=full');
  const bruts = data.products?.product || [];
  const liste = Array.isArray(bruts) ? bruts : [bruts];

  const map = new Map();
  for (const p of liste) {
    const ref = extraireVal(p.reference).trim();
    if (!ref) continue;
    map.set(ref, {
      id:              Number(extraireVal(p.id)),
      priceHT:         parseFloat(extraireVal(p.price) || '0'),
      idTaxRulesGroup: Number(extraireVal(p.id_tax_rules_group)),
    });
  }
  return map;
}

// ─── Chargement groupes d'attributs ──────────────────────────

/**
 * Charge tous les groupes d'attributs existants dans PS.
 *
 * CORRECTIF : on indexe par DEUX variantes de nom pour couvrir
 * les cas où PS stocke le nom dans `name` ou `public_name` :
 *   - clé primaire  : extraireVal(g.name).toLowerCase()
 *   - clé secondaire: extraireVal(g.public_name).toLowerCase()
 *
 * Le lookup dans importerCombinations utilise specificitePS.toLowerCase()
 * qui correspond au label FR ("Taille", "Couleur") — cohérent avec les
 * deux clés si PS stocke bien ce label dans name/public_name.
 *
 * @returns {Promise<Map<string, number>>} Map<nomLower, idGroupe>
 */
async function chargerGroupesAttributs() {
  const data  = await prestaGet('/product_options?display=full');
  const bruts = data.product_options?.product_option || [];
  const liste = Array.isArray(bruts) ? bruts : [bruts];

  const map = new Map();

  for (const g of liste) {
    const id = Number(extraireVal(g.id));
    if (!id) continue;

    // Extraire toutes les variantes de nom disponibles
    const nomName   = extraireVal(g.name).trim().toLowerCase();
    const nomPublic = extraireVal(g.public_name).trim().toLowerCase();

    // Indexer chaque variante non-vide (premier trouvé gagne)
    if (nomName   && !map.has(nomName))   map.set(nomName,   id);
    if (nomPublic && !map.has(nomPublic)) map.set(nomPublic, id);
  }

  return map;
}

// ─── Chargement valeurs d'attributs ──────────────────────────

async function chargerValeursAttributs() {
  const data  = await prestaGet('/product_option_values?display=full');
  const bruts = data.product_option_values?.product_option_value || [];
  const liste = Array.isArray(bruts) ? bruts : [bruts];

  const map = new Map();
  for (const v of liste) {
    const idGroupe = Number(extraireVal(v.id_attribute_group));
    const nom      = extraireVal(v.name).toLowerCase().trim();
    const id       = Number(extraireVal(v.id));
    if (idGroupe && nom && id) map.set(`${idGroupe}:${nom}`, id);
  }
  return map;
}

// ─── Combinaisons existantes d'un produit ────────────────────

async function chargerCombinaisonsExistantes(idProduit) {
  try {
    const data  = await prestaGet(`/combinations?filter[id_product]=${idProduit}&display=full`);
    const bruts = data.combinations?.combination || [];
    const liste = Array.isArray(bruts) ? bruts : [bruts];

    const set = new Set();
    for (const c of liste) {
      const opts = c.associations?.product_option_values?.product_option_value || [];
      const arr  = Array.isArray(opts) ? opts : [opts];
      const key  = arr
        .map((o) => Number(extraireVal(o.id)))
        .filter(Boolean)
        .sort((a, b) => a - b)
        .join(',');
      if (key) set.add(key);
    }
    return set;
  } catch {
    return new Set();
  }
}

// ─── stock_available : trouver l'ID d'une ligne ───────────────

async function trouverStockAvailableId(idProduit, idCombi = 0) {
  try {
    const data  = await prestaGet(
      `/stock_availables?filter[id_product]=${idProduit}&filter[id_product_attribute]=${idCombi}&display=full`
    );
    const bruts = data.stock_availables?.stock_available || [];
    const liste = Array.isArray(bruts) ? bruts : [bruts];

    // Priorité : ligne id_shop=1 sur id_shop=0
    const sorted = [...liste].sort((a, b) =>
      Number(extraireVal(b.id_shop)) - Number(extraireVal(a.id_shop))
    );
    return sorted.length ? Number(extraireVal(sorted[0].id)) : null;
  } catch {
    return null;
  }
}

// ─── Mise à jour stock_available ─────────────────────────────

async function mettreAJourStock(idStock, idProduit, idCombi, quantite) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop xmlns:xlink="http://www.w3.org/1999/xlink">
  <stock_available>
    <id>${idStock}</id>
    <id_product>${idProduit}</id_product>
    <id_product_attribute>${idCombi}</id_product_attribute>
    <id_shop>${ID_SHOP}</id_shop>
    <id_shop_group>${ID_SHOP_GROUP}</id_shop_group>
    <quantity>${quantite}</quantity>
    <depends_on_stock>0</depends_on_stock>
    <out_of_stock>2</out_of_stock>
  </stock_available>
</prestashop>`;

  await prestaWrite(`/stock_availables/${idStock}`, xml, 'PUT');
}

// ─── Création groupe d'attributs ──────────────────────────────

async function creerGroupeAttribut(nomPS, langIds) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop xmlns:xlink="http://www.w3.org/1999/xlink">
  <product_option>
    <group_type><![CDATA[select]]></group_type>
    <is_color_group><![CDATA[0]]></is_color_group>
    <position><![CDATA[0]]></position>
    ${blocML('name',        nomPS, langIds)}
    ${blocML('public_name', nomPS, langIds)}
  </product_option>
</prestashop>`;

  const res = await prestaWrite('/product_options', xml, 'POST');
  const id  = extraireId(res, 'product_option');
  if (!id) throw new Error(`Groupe attribut "${nomPS}" non créé — réponse : ${JSON.stringify(res).slice(0, 200)}`);
  return id;
}

// ─── Création valeur d'attribut ───────────────────────────────

async function creerValeurAttribut(nomPS, idGroupe, langIds) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop xmlns:xlink="http://www.w3.org/1999/xlink">
  <product_option_value>
    <id_attribute_group><![CDATA[${idGroupe}]]></id_attribute_group>
    <color><![CDATA[]]></color>
    <position><![CDATA[0]]></position>
    ${blocML('name', nomPS, langIds)}
  </product_option_value>
</prestashop>`;

  const res = await prestaWrite('/product_option_values', xml, 'POST');
  const id  = extraireId(res, 'product_option_value');
  if (!id) throw new Error(`Valeur attribut "${nomPS}" non créée — réponse : ${JSON.stringify(res).slice(0, 200)}`);
  return id;
}

// ─── Création combinaison ─────────────────────────────────────

async function creerCombinaison(idProduit, idOptionValue, supplementHT = 0) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop xmlns:xlink="http://www.w3.org/1999/xlink">
  <combination>
    <id_product><![CDATA[${idProduit}]]></id_product>
    <reference><![CDATA[]]></reference>
    <ean13><![CDATA[]]></ean13>
    <isbn><![CDATA[]]></isbn>
    <upc><![CDATA[]]></upc>
    <mpn><![CDATA[]]></mpn>
    <wholesale_price><![CDATA[0]]></wholesale_price>
    <price><![CDATA[${supplementHT.toFixed(6)}]]></price>
    <weight><![CDATA[0]]></weight>
    <unit_price_impact><![CDATA[0]]></unit_price_impact>
    <minimal_quantity><![CDATA[1]]></minimal_quantity>
    <low_stock_threshold><![CDATA[0]]></low_stock_threshold>
    <low_stock_alert><![CDATA[0]]></low_stock_alert>
    <default_on><![CDATA[0]]></default_on>
    <available_date><![CDATA[0000-00-00]]></available_date>
    <associations>
      <product_option_values>
        <product_option_value>
          <id><![CDATA[${idOptionValue}]]></id>
        </product_option_value>
      </product_option_values>
    </associations>
  </combination>
</prestashop>`;

  const res = await prestaWrite('/combinations', xml, 'POST');
  const id  = extraireId(res, 'combination');
  if (!id) throw new Error(`Combinaison non créée — réponse : ${JSON.stringify(res).slice(0, 200)}`);
  return id;
}

// ─── Import principal ─────────────────────────────────────────

/**
 * Importe toutes les lignes du CSV 2 dans PrestaShop.
 *
 * @param {Array}    lignes  - sortie de parseCSVCombinations().lignes
 * @param {Function} onLog   - callback({ type, message, ref })
 * @returns {Promise<Object>} bilan
 */
export async function importerCombinations(lignes, onLog) {
  const log   = (type, message, ref = '') => onLog({ type, message, ref });
  const bilan = { crees: 0, simples: 0, skips: 0, erreurs: 0, details: [] };

  // ── Étape 0 : Langues actives ──────────────────────────────
  log('info', 'Chargement des langues PrestaShop actives…');
  const langIds = await chargerLangues();
  log('info', `Langues actives : [${langIds.join(', ')}]`);

  // ── Étape 1 : Tax mapping ──────────────────────────────────
  log('info', 'Chargement du mapping TVA…');
  let taxMapping;
  try {
    taxMapping = await chargerTaxMapping();
    log('info', `${taxMapping.size} groupe(s) de taxe chargé(s)`);
  } catch (err) {
    log('erreur', `Impossible de charger les taxes : ${err.message}`);
    throw err;
  }

  // ── Étape 2 : Produits PS ──────────────────────────────────
  log('info', 'Chargement des produits PrestaShop…');
  let produits;
  try {
    produits = await chargerProduits();
    log('info', `${produits.size} produit(s) chargé(s)`);
  } catch (err) {
    log('erreur', `Impossible de charger les produits : ${err.message}`);
    throw err;
  }

  // ── Étape 3 : Groupes d'attributs existants ────────────────
  log('info', "Chargement des groupes d'attributs…");
  let groupesMap;
  try {
    groupesMap = await chargerGroupesAttributs();
    log('info', `${groupesMap.size} entrée(s) dans la map groupes d'attributs`);
  } catch (err) {
    log('erreur', `Impossible de charger les groupes d'attributs : ${err.message}`);
    throw err;
  }

  // ── Étape 4 : Valeurs d'attributs existantes ───────────────
  log('info', "Chargement des valeurs d'attributs…");
  let valeursMap;
  try {
    valeursMap = await chargerValeursAttributs();
    log('info', `${valeursMap.size} valeur(s) d'attributs chargée(s)`);
  } catch (err) {
    log('erreur', `Impossible de charger les valeurs d'attributs : ${err.message}`);
    throw err;
  }

  // ── Étape 5 : Traitement ligne par ligne ───────────────────
  log('info', `Début de l'import — ${lignes.length} ligne(s) à traiter`);

  /**
   * Accumulateur de stocks par produit pour le recalcul final de la
   * ligne "produit de base" (id_product_attribute = 0).
   * Map<idProduit, number>  ← somme des stockInitial des combos créées
   */
  const stockSommeParProduit = new Map();

  for (const ligne of lignes) {
    const { reference, mode } = ligne;

    // Vérifier que le produit existe en PS
    if (!produits.has(reference)) {
      log('erreur', `Produit "${reference}" introuvable dans PS — ignoré`, reference);
      bilan.erreurs++;
      bilan.details.push({ ref: reference, statut: 'erreur', raison: 'Produit non trouvé dans PS' });
      continue;
    }

    const produit = produits.get(reference);

    // ══════════════════════════════════════════════════════════
    // CAS 1 : PRODUIT SIMPLE — initialisation du stock de base
    // ══════════════════════════════════════════════════════════
    if (mode === 'simple') {
      try {
        log('info', `"${reference}" : produit simple — stock → ${ligne.stockInitial}`, reference);
        const idStock = await trouverStockAvailableId(produit.id, 0);
        if (!idStock) throw new Error(`stock_available introuvable pour produit ${produit.id}`);
        await mettreAJourStock(idStock, produit.id, 0, ligne.stockInitial);
        log('succes', `"${reference}" : stock initialisé → ${ligne.stockInitial} unités`, reference);
        bilan.simples++;
        bilan.details.push({ ref: reference, statut: 'simple', stock: ligne.stockInitial });
      } catch (err) {
        log('erreur', `"${reference}" stock simple : ${err.message}`, reference);
        bilan.erreurs++;
        bilan.details.push({ ref: reference, statut: 'erreur', raison: err.message });
      }
      continue;
    }

    // ══════════════════════════════════════════════════════════
    // CAS 2 : COMBINAISON
    // ══════════════════════════════════════════════════════════
    const { specificitePS, karazanyPS } = ligne;

    try {
      // ── 2a. Groupe d'attributs ─────────────────────────────
      //
      // CORRECTIF : on cherche dans groupesMap avec specificitePS.toLowerCase()
      // qui correspond exactement aux clés insérées par chargerGroupesAttributs()
      // (indexation par name.toLowerCase() ET public_name.toLowerCase()).
      // Si non trouvé → on crée, puis on indexe les DEUX variantes pour
      // que les lignes suivantes avec le même groupe le retrouvent.
      //
      const keyGroupe = specificitePS.trim().toLowerCase();
      let   idGroupe  = groupesMap.get(keyGroupe);

      if (!idGroupe) {
        log('info', `Groupe attribut "${specificitePS}" absent dans PS → création`, reference);
        idGroupe = await creerGroupeAttribut(specificitePS, langIds);

        // Indexer les deux variantes pour éviter toute création en double
        // si une ligne ultérieure cherche par un nom légèrement différent
        groupesMap.set(keyGroupe,                             idGroupe);
        groupesMap.set(specificitePS.trim().toLowerCase(),    idGroupe); // redondant mais explicite
        log('succes', `Groupe attribut "${specificitePS}" créé → id=${idGroupe}`, reference);
      } else {
        log('info', `Groupe attribut "${specificitePS}" déjà présent dans PS (id=${idGroupe})`, reference);
      }

      // ── 2b. Valeur d'attribut ──────────────────────────────
      const cleValeur = `${idGroupe}:${karazanyPS.trim().toLowerCase()}`;
      let   idValeur  = valeursMap.get(cleValeur);

      if (!idValeur) {
        log('info', `Valeur attribut "${karazanyPS}" absente → création`, reference);
        idValeur = await creerValeurAttribut(karazanyPS, idGroupe, langIds);
        valeursMap.set(cleValeur, idValeur);
        log('succes', `Valeur attribut "${karazanyPS}" créée → id=${idValeur}`, reference);
      } else {
        log('info', `Valeur attribut "${karazanyPS}" déjà présente (id=${idValeur})`, reference);
      }

      // ── 2c. Vérifier si la combinaison existe déjà ─────────
      const combosExistantes = await chargerCombinaisonsExistantes(produit.id);
      const cleComboDedupliq = String(idValeur);

      if (combosExistantes.has(cleComboDedupliq)) {
        log('warning',
          `Combinaison "${specificitePS}:${karazanyPS}" déjà existante pour "${reference}" — ignorée`,
          reference
        );
        bilan.skips++;
        bilan.details.push({ ref: reference, statut: 'skip', raison: 'Combinaison déjà existante' });
        // On comptabilise quand même le stock pour le recalcul du produit de base
        stockSommeParProduit.set(
          produit.id,
          (stockSommeParProduit.get(produit.id) ?? 0) + ligne.stockInitial
        );
        continue;
      }

      // ── 2d. Supplément de prix HT ──────────────────────────
      let supplementHT = 0;

      if (ligne.prixTTC !== null) {
        let tauxTVA = 0;
        for (const [key, id] of taxMapping) {
          if (id === produit.idTaxRulesGroup) {
            tauxTVA = parseFloat(key);
            break;
          }
        }
        const prixComboHT = ttcVersHT(ligne.prixTTC, tauxTVA);
        supplementHT      = Math.round((prixComboHT - produit.priceHT) * 1000000) / 1000000;

        log('info',
          `"${reference}" × "${karazanyPS}" : ${ligne.prixTTC} TTC → HT ${prixComboHT.toFixed(4)} → supplément ${supplementHT.toFixed(4)} HT`,
          reference
        );
      }

      // ── 2e. Créer la combinaison ───────────────────────────
      const idCombi = await creerCombinaison(produit.id, idValeur, supplementHT);
      log('succes', `Combinaison créée : "${reference}" × "${karazanyPS}" → id=${idCombi}`, reference);

      // ── 2f. Initialiser le stock de la combinaison ─────────
      await new Promise((r) => setTimeout(r, 200));

      const idStockCombi = await trouverStockAvailableId(produit.id, idCombi);
      if (idStockCombi) {
        await mettreAJourStock(idStockCombi, produit.id, idCombi, ligne.stockInitial);
        log('succes', `Stock combinaison id=${idCombi} → ${ligne.stockInitial} unités`, reference);
      } else {
        log('warning',
          `Ligne stock_available non trouvée pour la combinaison ${idCombi} (stock non initialisé)`,
          reference
        );
      }

      // ── Accumuler le stock pour le recalcul du produit de base ─
      stockSommeParProduit.set(
        produit.id,
        (stockSommeParProduit.get(produit.id) ?? 0) + ligne.stockInitial
      );

      bilan.crees++;
      bilan.details.push({
        ref:      reference,
        statut:   'succes',
        idCombi,
        attribut: `${specificitePS}: ${karazanyPS}`,
        stock:    ligne.stockInitial,
      });

    } catch (err) {
      log('erreur', `"${reference}" combo "${ligne.karazanyPS}" : ${err.message}`, reference);
      bilan.erreurs++;
      bilan.details.push({ ref: reference, statut: 'erreur', raison: err.message });
    }
  }

  // ── Étape 6 : Recalcul du stock de base (attr=0) ───────────
  //
  // CORRECTIF : Pour chaque produit qui a eu des combinaisons importées,
  // on met à jour la ligne stock_available id_product_attribute=0
  // avec la SOMME des stocks des combinaisons.
  // PS l'affiche comme stock global du produit dans le backoffice.
  //
  if (stockSommeParProduit.size > 0) {
    log('info', `Recalcul du stock de base pour ${stockSommeParProduit.size} produit(s)…`);

    for (const [idProduit, somme] of stockSommeParProduit) {
      try {
        const idStockBase = await trouverStockAvailableId(idProduit, 0);
        if (!idStockBase) {
          log('warning',
            `stock_available de base introuvable pour produit id=${idProduit} — recalcul ignoré`
          );
          continue;
        }
        await mettreAJourStock(idStockBase, idProduit, 0, somme);
        log('succes',
          `Produit id=${idProduit} : stock de base mis à jour → ${somme} (somme des combinaisons)`
        );
      } catch (err) {
        log('warning',
          `Produit id=${idProduit} : impossible de mettre à jour le stock de base — ${err.message}`
        );
      }
    }
  }

  log('info',
    `Import terminé — ✓ ${bilan.crees} combo(s) · ✓ ${bilan.simples} stock(s) simple(s) · ⚠ ${bilan.skips} ignoré(s) · ✗ ${bilan.erreurs} erreur(s)`
  );
  return bilan;
}