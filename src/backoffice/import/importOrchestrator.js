/**
 * importOrchestrator.js
 * Coordonne l'import complet dans le bon ordre.
 *
 * ORDRE :
 *   1. Parse CSV1 → produits
 *   2. Parse CSV2 → combinaisons
 *   3. Parse CSV3 → clients/commandes
 *   4. Extraire les images du ZIP
 *   5. Importer produits + images
 *   6. Importer combinaisons + stocks
 *   7. Construire la map variant→comboId pour les commandes
 *   8. Importer clients + commandes + paniers
 *
 * FIX : utilise files.csv1Text / csv2Text / csv3Text (pré-décodés par ImportPage
 *       avec TextDecoder robuste) au lieu de file.text() qui peut mal décoder
 *       les CSV encodés en windows-1252 / Latin-1.
 */

import { parseProductsCsv }                             from './parsers/parseProducts.js';
import { parseCombinationsCsv, groupByProduct }          from './parsers/parseCombinations.js';
import { parseCustomersOrdersCsv, groupCustomerOrders }  from './parsers/parseCustomersOrders.js';
import { importProducts, getExistingProductsByRef }      from './importers/importProducts.js';
import { importCombinations }                            from './importers/importCombinations.js';
import { importCustomers }                               from './importers/importCustomers.js';
import { prestaGet, extraireValeur }                     from './config/prestaApi.js';

// ─── Lecture fichier ──────────────────────────────────────────

/**
 * Lit le texte d'un fichier CSV.
 * Priorité : texte pré-décodé (passé par ImportPage) > file.text() en fallback.
 * Le texte pré-décodé garantit un décodage UTF-8/windows-1252 correct.
 *
 * @param {File}        file
 * @param {string|null} preDecoded - texte déjà décodé par ImportPage (optionnel)
 * @returns {Promise<string>}
 */
async function readCsvText(file, preDecoded) {
  if (preDecoded) return preDecoded;
  // Fallback : lecture directe (peut mal décoder le Latin-1)
  return file.text();
}

// ─── Extraction ZIP ───────────────────────────────────────────

/**
 * Extrait les fichiers d'un ZIP et construit Map<reference, File>.
 * Les fichiers doivent être nommés REF.jpg / REF.png / REF.webp
 *
 * @param {File} zipFile
 * @returns {Promise<Object>} { reference: File }
 */
async function extractImagesFromZip(zipFile) {
  let JSZip;
  try {
    JSZip = (await import('jszip')).default;
  } catch {
    console.warn('[orchestrator] jszip non disponible — images ignorées');
    return {};
  }

  const zip      = await JSZip.loadAsync(zipFile);
  const imageMap = {};
  const exts     = ['jpg', 'jpeg', 'png', 'webp', 'gif'];

  for (const [filename, zipEntry] of Object.entries(zip.files)) {
    if (zipEntry.dir) continue;

    const base = filename.split('/').pop(); // ignorer sous-dossiers
    const dot  = base.lastIndexOf('.');
    if (dot === -1) continue;

    const ext = base.slice(dot + 1).toLowerCase();
    if (!exts.includes(ext)) continue;

    const ref     = base.slice(0, dot); // T_01 depuis T_01.jpg
    const blob    = await zipEntry.async('blob');
    imageMap[ref] = new File([blob], base, { type: `image/${ext === 'jpg' ? 'jpeg' : ext}` });
  }

  return imageMap;
}

// ─── Résolution variantes ─────────────────────────────────────

/**
 * Reconstruit la map variant→comboId depuis les combinaisons créées.
 * Nécessaire pour résoudre les références dans les commandes du CSV3.
 *
 * @param {Map<string, Array>} combosByRef       - référence → combinaisons parsées
 * @param {Map<string, number>} refToProductId
 * @returns {Promise<Map<string, Map<string, number>>>} ref → Map<variantKey, comboId>
 */
async function buildRefToComboMap(combosByRef, refToProductId) {
  const refToComboMap = new Map();

  for (const [ref, combos] of combosByRef.entries()) {
    const productId = refToProductId.get(ref);
    if (!productId) continue;

    const data  = await prestaGet(`/combinations?filter[id_product]=${productId}&display=full`);
    const items = data.combinations?.combination || [];
    const liste = Array.isArray(items) ? items : [items];

    if (!liste.length) continue;

    const variantMap = new Map();

    for (const combo of liste) {
      const comboId  = Number(extraireValeur(combo.id));
      const optVals  = combo.associations?.product_option_values?.product_option_value || [];
      const valListe = Array.isArray(optVals) ? optVals : [optVals];

      for (const val of valListe) {
        const valId = Number(extraireValeur(val.id || val));
        if (!valId) continue;

        try {
          const vData = await prestaGet(`/product_option_values/${valId}`);
          const vObj  = vData.product_option_value?.[0] || vData.product_option_value;
          const vName = extraireValeur(vObj?.name, 1).toLowerCase().trim();

          variantMap.set(vName, comboId);

          const csvCombo = combos.find(
            (c) => c.attribute_value_label?.toLowerCase() === vName
          );
          if (csvCombo?.attribute_value) {
            variantMap.set(csvCombo.attribute_value.toLowerCase(), comboId);
          }
        } catch (_) {}
      }
    }

    if (variantMap.size) refToComboMap.set(ref, variantMap);
  }

  return refToComboMap;
}

// ─── Point d'entrée principal ─────────────────────────────────

/**
 * Lance l'import complet.
 *
 * @param {Object} files
 *   {
 *     csv1: File, csv2: File, csv3: File, zip: File|null,
 *     csv1Text?: string,  ← textes pré-décodés par ImportPage (optionnels)
 *     csv2Text?: string,
 *     csv3Text?: string,
 *   }
 * @param {Function} onProgress
 *   callback(message: string, type: 'info'|'success'|'warning'|'error'|'skip'|'phase'|'separator')
 */
export async function runImport(files, onProgress = () => {}) {

  // ── Phase 1 : Parsing ─────────────────────────────────────
  onProgress('📂 Lecture des fichiers CSV...', 'info');

  let products, combinations, customersOrders;

  try {
    const csv1Text = await readCsvText(files.csv1, files.csv1Text);
    products = parseProductsCsv(csv1Text);
    onProgress(`📋 CSV1 : ${products.length} produit(s) détecté(s)`, 'info');
  } catch (err) {
    onProgress(`❌ Erreur CSV1 : ${err.message}`, 'error');
    return;
  }

  try {
    const csv2Text = await readCsvText(files.csv2, files.csv2Text);
    combinations = parseCombinationsCsv(csv2Text);
    onProgress(`📋 CSV2 : ${combinations.length} ligne(s) combinaisons détectée(s)`, 'info');
  } catch (err) {
    onProgress(`❌ Erreur CSV2 : ${err.message}`, 'error');
    return;
  }

  try {
    const csv3Text = await readCsvText(files.csv3, files.csv3Text);
    customersOrders = parseCustomersOrdersCsv(csv3Text);
    onProgress(`📋 CSV3 : ${customersOrders.length} ligne(s) clients détectée(s)`, 'info');
  } catch (err) {
    onProgress(`❌ Erreur CSV3 : ${err.message}`, 'error');
    return;
  }

  const combosByRef      = groupByProduct(combinations);
  const groupedCustomers = groupCustomerOrders(customersOrders);

  // ── Phase 2 : Images ZIP ──────────────────────────────────
  let imageFiles = {};
  if (files.zip) {
    onProgress('🗜 Extraction des images du ZIP...', 'info');
    try {
      imageFiles = await extractImagesFromZip(files.zip);
      onProgress(`🖼 ${Object.keys(imageFiles).length} image(s) extraite(s)`, 'info');
    } catch (err) {
      onProgress(`⚠ ZIP images : ${err.message}`, 'warning');
    }
  }

  // ── Phase 3 : Produits ────────────────────────────────────
  onProgress('', 'separator');
  onProgress('🏷 ÉTAPE 1/3 — Import des produits et catégories', 'phase');

  const refToProductId = await importProducts(products, imageFiles, onProgress);

  // ── Phase 4 : Combinaisons ────────────────────────────────
  onProgress('', 'separator');
  onProgress('🔀 ÉTAPE 2/3 — Import des combinaisons et stocks', 'phase');

  await importCombinations(refToProductId, combosByRef, onProgress);

  onProgress('🔗 Résolution des variantes pour les commandes...', 'info');
  const refToComboMap = await buildRefToComboMap(combosByRef, refToProductId);

  // ── Phase 5 : Clients + Commandes ─────────────────────────
  onProgress('', 'separator');
  onProgress('👥 ÉTAPE 3/3 — Import des clients, commandes et paniers', 'phase');

  await importCustomers(groupedCustomers, refToProductId, refToComboMap, onProgress);

  onProgress('', 'separator');
  onProgress('🎉 Import terminé !', 'success');
}