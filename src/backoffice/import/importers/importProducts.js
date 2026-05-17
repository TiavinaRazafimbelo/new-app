/**
 * importProducts.js — v4
 * src/backoffice/import/importers/importProducts.js
 *
 * FIX #1 — Catégorie rejetée "name est vide" :
 *   PS8 avec 2 langues installées exige TOUTES les langues dans les champs
 *   multilingues. On charge d'abord la liste des langues actives et on les
 *   inclut toutes dans chaque champ multilingue.
 *
 * FIX #2 — Extraction ID depuis réponse tableau :
 *   PS retourne parfois { category: [{id:...}] } (tableau via isArray)
 *   au lieu de { category: {id:...} }. On normalise les deux cas.
 */

import { prestaGet, prestaWrite, extraireVal } from '../config/prestaApi.js';
import { chargerTaxMapping, resoudreTaxGroup, ttcVersHT } from '../config/taxMapping.js';

const ID_CATEGORIE_PARENTE_DEFAUT = 2;
const ID_SHOP                    = 1;

// ─── Chargement des langues actives ──────────────────────────

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

function blocMultilingue(tagName, valeur, langIds) {
  const inner = langIds
    .map((id) => `<language id="${id}"><![CDATA[${valeur}]]></language>`)
    .join('');
  return `<${tagName}>${inner}</${tagName}>`;
}

// ─── XML catégorie ────────────────────────────────────────────

function buildCategorieXml(nomOriginal, langIds) {
  const slug = nomOriginal
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  return `<?xml version="1.0" encoding="UTF-8"?>
<prestashop xmlns:xlink="http://www.w3.org/1999/xlink">
  <category>
    <id_parent><![CDATA[${ID_CATEGORIE_PARENTE_DEFAUT}]]></id_parent>
    <active><![CDATA[1]]></active>
    <id_shop_default><![CDATA[${ID_SHOP}]]></id_shop_default>
    <is_root_category><![CDATA[0]]></is_root_category>
    ${blocMultilingue('name',             nomOriginal, langIds)}
    ${blocMultilingue('description',      '',          langIds)}
    ${blocMultilingue('meta_title',       nomOriginal, langIds)}
    ${blocMultilingue('meta_description', '',          langIds)}
    ${blocMultilingue('meta_keywords',    '',          langIds)}
    ${blocMultilingue('link_rewrite',     slug,        langIds)}
  </category>
</prestashop>`;
}

// ─── XML produit ──────────────────────────────────────────────

function buildProduitXml(produit, idCategorie, idTaxGroup, prixHT, langIds) {
  const slug = produit.nom
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  return `<?xml version="1.0" encoding="UTF-8"?>
<prestashop xmlns:xlink="http://www.w3.org/1999/xlink">
  <product>
    <id_manufacturer><![CDATA[0]]></id_manufacturer>
    <id_supplier><![CDATA[0]]></id_supplier>
    <id_category_default><![CDATA[${idCategorie}]]></id_category_default>
    <id_shop_default><![CDATA[${ID_SHOP}]]></id_shop_default>
    <id_tax_rules_group><![CDATA[${idTaxGroup}]]></id_tax_rules_group>
    <reference><![CDATA[${produit.reference}]]></reference>
    <supplier_reference><![CDATA[]]></supplier_reference>
    <ean13><![CDATA[]]></ean13>
    <upc><![CDATA[]]></upc>
    <price><![CDATA[${prixHT.toFixed(6)}]]></price>
    <wholesale_price><![CDATA[${produit.prixAchat.toFixed(6)}]]></wholesale_price>
    <unit_price><![CDATA[0.000000]]></unit_price>
    <unit_price_ratio><![CDATA[0.000000]]></unit_price_ratio>
    <active><![CDATA[1]]></active>
    <available_for_order><![CDATA[1]]></available_for_order>
    <show_price><![CDATA[1]]></show_price>
    <online_only><![CDATA[0]]></online_only>
    <visibility><![CDATA[both]]></visibility>
    <condition><![CDATA[new]]></condition>
    <state><![CDATA[1]]></state>
    <available_date><![CDATA[${produit.dateDisponible}]]></available_date>
    ${blocMultilingue('name',              produit.nom, langIds)}
    ${blocMultilingue('description',       '',          langIds)}
    ${blocMultilingue('description_short', '',          langIds)}
    ${blocMultilingue('meta_title',        produit.nom, langIds)}
    ${blocMultilingue('meta_description',  '',          langIds)}
    ${blocMultilingue('meta_keywords',     '',          langIds)}
    ${blocMultilingue('link_rewrite',      slug,        langIds)}
    <associations>
      <categories>
        <category><id><![CDATA[${idCategorie}]]></id></category>
      </categories>
    </associations>
  </product>
</prestashop>`;
}

// ─── Utilitaire : extraire ID depuis réponse PS ───────────────

function extraireIdReponse(reponse, nomRessource) {
  // Cas 1 : reponse[nomRessource] est un tableau (isArray=true dans le parser)
  const direct = reponse[nomRessource];
  if (Array.isArray(direct) && direct.length > 0) return Number(extraireVal(direct[0]?.id));
  if (direct && !Array.isArray(direct))            return Number(extraireVal(direct?.id));
  // Cas 2 : reponse[nomRessource + 's'][nomRessource]
  const pluriel = reponse[nomRessource + 's']?.[nomRessource];
  if (Array.isArray(pluriel) && pluriel.length > 0) return Number(extraireVal(pluriel[0]?.id));
  if (pluriel && !Array.isArray(pluriel))            return Number(extraireVal(pluriel?.id));
  return 0;
}

// ─── Chargement depuis PS ─────────────────────────────────────

async function chargerCategories() {
  const data  = await prestaGet('/categories?display=full');
  const bruts = data.categories?.category || [];
  const liste = Array.isArray(bruts) ? bruts : [bruts];

  const map = new Map();
  for (const c of liste) {
    const id          = Number(extraireVal(c.id));
    const nomOriginal = extraireVal(c.name).trim();
    const nomLower    = nomOriginal.toLowerCase();
    if (id && nomOriginal) map.set(nomLower, { id, nomOriginal });
  }
  return map;
}

async function chargerReferencesExistantes() {
  const data  = await prestaGet('/products?display=[id,reference]');
  const bruts = data.products?.product || [];
  const liste = Array.isArray(bruts) ? bruts : [bruts];
  const refs  = new Set();
  for (const p of liste) {
    const ref = extraireVal(p.reference).trim();
    if (ref) refs.add(ref);
  }
  return refs;
}

// ─── Import principal ─────────────────────────────────────────

export async function importerProduits(produits, onLog) {
  const log = (type, message, ref = '') => onLog({ type, message, ref });
  const bilan = { crees: 0, skips: 0, erreurs: 0, details: [] };

  // ── Étape 0 : Langues actives ─────────────────────────────
  log('info', 'Chargement des langues PrestaShop actives…');
  const langIds = await chargerLangues();
  log('info', `Langues actives : [${langIds.join(', ')}]`);

  // ── Étape 1 : Tax mapping ─────────────────────────────────
  log('info', 'Chargement des groupes de taxes PrestaShop…');
  let taxMapping;
  try {
    taxMapping = await chargerTaxMapping();
    log('info', `${taxMapping.size} groupe(s) de taxe chargé(s)`);
  } catch (err) {
    log('erreur', `Impossible de charger les taxes PS : ${err.message}`);
    throw err;
  }

  // ── Étape 2 : Catégories existantes ──────────────────────
  log('info', 'Chargement des catégories PrestaShop existantes…');
  let categoriesMap;
  try {
    categoriesMap = await chargerCategories();
    log('info', `${categoriesMap.size} catégorie(s) existante(s)`);
  } catch (err) {
    log('erreur', `Impossible de charger les catégories PS : ${err.message}`);
    throw err;
  }

  // ── Étape 3 : Créer les catégories manquantes ─────────────
  const catsCSV = new Map();
  for (const p of produits) {
    const key = p.categorie.toLowerCase().trim();
    if (!catsCSV.has(key)) catsCSV.set(key, p.categorie.trim());
  }

  for (const [nomLower, nomOriginal] of catsCSV) {
    if (categoriesMap.has(nomLower)) {
      log('info', `Catégorie existante : "${nomOriginal}" (id=${categoriesMap.get(nomLower).id})`);
      continue;
    }

    try {
      const xml    = buildCategorieXml(nomOriginal, langIds);
      const reponse = await prestaWrite('/categories', xml, 'POST');
      const idNouv  = extraireIdReponse(reponse, 'category');

      if (!idNouv) {
        throw new Error(`ID catégorie non retourné — réponse : ${JSON.stringify(reponse).slice(0, 200)}`);
      }

      categoriesMap.set(nomLower, { id: idNouv, nomOriginal });
      log('succes', `Catégorie créée : "${nomOriginal}" → id=${idNouv}`);
    } catch (err) {
      log('erreur', `Impossible de créer la catégorie "${nomOriginal}" : ${err.message}`);
    }
  }

  // ── Étape 4 : Références existantes ──────────────────────
  log('info', 'Vérification des références produits existantes…');
  let referencesExistantes;
  try {
    referencesExistantes = await chargerReferencesExistantes();
    log('info', `${referencesExistantes.size} référence(s) existante(s) dans PS`);
  } catch (err) {
    log('erreur', `Impossible de charger les références : ${err.message}`);
    throw err;
  }

  // ── Étape 5 : Insérer chaque produit ─────────────────────
  log('info', `Début de l'import — ${produits.length} produit(s) à traiter`);

  for (const produit of produits) {
    const ref = produit.reference;

    if (referencesExistantes.has(ref)) {
      log('warning', `Référence déjà existante, ignorée : "${ref}"`, ref);
      bilan.skips++;
      bilan.details.push({ ref, statut: 'skip', raison: 'Référence déjà existante' });
      continue;
    }

    // Tax group
    let taxResult;
    try {
      taxResult = await resoudreTaxGroup(
        `${produit.tauxTVA}%`,
        taxMapping,
        (type, msg) => log(type, msg, ref)
      );
    } catch (err) {
      log('erreur', `Tax group : ${err.message}`, ref);
      bilan.erreurs++;
      bilan.details.push({ ref, statut: 'erreur', raison: err.message });
      continue;
    }

    const { idTaxGroup, tauxNum } = taxResult;
    const prixHT = ttcVersHT(produit.prixTTC, tauxNum);
    log('info', `"${ref}" : ${produit.prixTTC} TTC → ${prixHT.toFixed(4)} HT (TVA ${tauxNum}%)`, ref);

    // Catégorie
    const nomCatLower = produit.categorie.toLowerCase().trim();
    const catEntry    = categoriesMap.get(nomCatLower);

    if (!catEntry) {
      const msg = `Catégorie "${produit.categorie}" introuvable`;
      log('erreur', msg, ref);
      bilan.erreurs++;
      bilan.details.push({ ref, statut: 'erreur', raison: msg });
      continue;
    }

    // POST /products
    try {
      const xml    = buildProduitXml(produit, catEntry.id, idTaxGroup, prixHT, langIds);
      const reponse = await prestaWrite('/products', xml, 'POST');
      const idProd  = extraireIdReponse(reponse, 'product');

      if (!idProd) {
        throw new Error(`PS a répondu sans ID produit — réponse : ${JSON.stringify(reponse).slice(0, 200)}`);
      }

      referencesExistantes.add(ref);
      log('succes', `Produit créé : "${produit.nom}" (ref=${ref}, id=${idProd})`, ref);
      bilan.crees++;
      bilan.details.push({ ref, statut: 'succes', idProduit: idProd });

    } catch (err) {
      log('erreur', `Échec création produit "${ref}" : ${err.message}`, ref);
      bilan.erreurs++;
      bilan.details.push({ ref, statut: 'erreur', raison: err.message });
    }
  }

  log('info', `Import terminé — ✓ ${bilan.crees} créé(s) · ⚠ ${bilan.skips} ignoré(s) · ✗ ${bilan.erreurs} erreur(s)`);
  return bilan;
}