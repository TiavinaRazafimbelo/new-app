/**
 * taxMapping.js — v5
 * src/backoffice/import/config/taxMapping.js
 *
 * FIX #1 — ID tax_rule_group non trouvé :
 *   La réponse PS retourne tax_rule_group comme tableau (isArray le met en [])
 *   donc resGroupe.tax_rule_group est un Array, pas un objet.
 *   On dépile correctement : resGroupe.tax_rule_group?.[0] ?? resGroupe.tax_rule_group
 *
 * FIX #2 — Même correction pour tax et tax_rule si besoin.
 */

import { prestaGet, prestaWrite, extraireVal } from './prestaApi.js';

let taxGroupCache = null;

// ─── Chargement du mapping existant ──────────────────────────

export async function chargerTaxMapping() {
  if (taxGroupCache) return taxGroupCache;

  const groupsData  = await prestaGet('/tax_rule_groups?display=full');
  const groupsBruts = groupsData.tax_rule_groups?.tax_rule_group || [];
  const groupsListe = Array.isArray(groupsBruts) ? groupsBruts : [groupsBruts];

  const taxesData  = await prestaGet('/taxes?display=full');
  const taxesBruts = taxesData.taxes?.tax || [];
  const taxesListe = Array.isArray(taxesBruts) ? taxesBruts : [taxesBruts];

  const taxById = new Map();
  for (const t of taxesListe) {
    taxById.set(Number(extraireVal(t.id)), parseFloat(extraireVal(t.rate) || 0));
  }

  const rulesData  = await prestaGet('/tax_rules?display=full');
  const rulesBruts = rulesData.tax_rules?.tax_rule || [];
  const rulesListe = Array.isArray(rulesBruts) ? rulesBruts : [rulesBruts];

  const rateByGroupId = new Map();
  for (const rule of rulesListe) {
    const groupId = Number(extraireVal(rule.id_tax_rules_group));
    const taxId   = Number(extraireVal(rule.id_tax));
    if (!rateByGroupId.has(groupId) && taxById.has(taxId)) {
      rateByGroupId.set(groupId, taxById.get(taxId));
    }
  }

  taxGroupCache = new Map();
  for (const group of groupsListe) {
    const groupId = Number(extraireVal(group.id));
    const rate    = rateByGroupId.get(groupId);
    if (rate !== undefined) {
      const key = rate.toFixed(2);
      if (!taxGroupCache.has(key)) taxGroupCache.set(key, groupId);
    }
  }

  // Fallback 0%
  for (const group of groupsListe) {
    const groupId = Number(extraireVal(group.id));
    if (!rateByGroupId.has(groupId) && !taxGroupCache.has('0.00')) {
      taxGroupCache.set('0.00', groupId);
    }
  }

  console.debug('[taxMapping] Mapping chargé :', Object.fromEntries(taxGroupCache));
  return taxGroupCache;
}

// ─── Utilitaire : extraire ID depuis réponse PS ───────────────

/**
 * PS peut retourner la ressource sous plusieurs formes selon isArray :
 *   { tax_rule_group: { id: ... } }         → objet direct
 *   { tax_rule_group: [{ id: ... }] }       → tableau (isArray=true)
 *   { tax_rule_groups: { tax_rule_group: [...] } }
 *
 * Cette fonction normalise les trois cas.
 */
function extraireIdDepuisReponse(reponse, nomRessource) {
  // Cas 1 : reponse[nomRessource] est un tableau
  const direct = reponse[nomRessource];
  if (Array.isArray(direct) && direct.length > 0) {
    return Number(extraireVal(direct[0]?.id));
  }
  // Cas 2 : reponse[nomRessource] est un objet direct
  if (direct && !Array.isArray(direct)) {
    return Number(extraireVal(direct?.id));
  }
  // Cas 3 : reponse[nomRessource + 's'][nomRessource]
  const pluriel = reponse[nomRessource + 's']?.[nomRessource];
  if (Array.isArray(pluriel) && pluriel.length > 0) {
    return Number(extraireVal(pluriel[0]?.id));
  }
  if (pluriel && !Array.isArray(pluriel)) {
    return Number(extraireVal(pluriel?.id));
  }
  return 0;
}

// ─── Création taxe + groupe si absent ────────────────────────

export async function resoudreTaxGroup(tauxCSV, taxMapping, onLog = null) {
  const normalise = tauxCSV.replace('%', '').replace(',', '.').trim();
  const tauxNum   = parseFloat(normalise);
  if (isNaN(tauxNum)) throw new Error(`Taux TVA invalide : "${tauxCSV}"`);

  // Chercher dans le mapping existant (tolérance 0.02)
  for (const [key, id] of taxMapping) {
    if (Math.abs(parseFloat(key) - tauxNum) < 0.02) {
      return { idTaxGroup: id, tauxNum };
    }
  }

  const label = `${tauxNum.toFixed(2)}%`;
  onLog?.('info', `Taux TVA ${label} absent dans PS → création automatique`);

  try {
    // ── Étape 1 : Créer la taxe ───────────────────────────────
    const nomTaxe = `TVA ${label}`;

    const xmlTaxe = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop xmlns:xlink="http://www.w3.org/1999/xlink">
  <tax>
    <rate><![CDATA[${tauxNum.toFixed(3)}]]></rate>
    <active><![CDATA[1]]></active>
    <deleted><![CDATA[0]]></deleted>
    <name><language id="1"><![CDATA[${nomTaxe}]]></language><language id="2"><![CDATA[${nomTaxe}]]></language></name>
  </tax>
</prestashop>`;

    onLog?.('info', `Création taxe "${nomTaxe}"…`);
    const resTaxe = await prestaWrite('/taxes', xmlTaxe, 'POST');

    // FIX #2 : dépiler le tableau si besoin
    const idTaxe = extraireIdDepuisReponse(resTaxe, 'tax');
    if (!idTaxe) {
      throw new Error(`ID taxe non retourné — réponse : ${JSON.stringify(resTaxe).slice(0, 200)}`);
    }
    onLog?.('info', `Taxe créée : "${nomTaxe}" → id=${idTaxe}`);

    // ── Étape 2 : Créer le groupe ─────────────────────────────
    const nomGroupe = `FR TVA ${label}`;

    const xmlGroupe = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop xmlns:xlink="http://www.w3.org/1999/xlink">
  <tax_rule_group>
    <name><![CDATA[${nomGroupe}]]></name>
    <active><![CDATA[1]]></active>
    <deleted><![CDATA[0]]></deleted>
  </tax_rule_group>
</prestashop>`;

    const resGroupe = await prestaWrite('/tax_rule_groups', xmlGroupe, 'POST');

    // FIX #1 : dépiler le tableau — PS retourne tax_rule_group:[{id:{__cdata:"6"}}]
    const idGroupe = extraireIdDepuisReponse(resGroupe, 'tax_rule_group');
    if (!idGroupe) {
      throw new Error(`ID tax_rule_group non retourné — réponse : ${JSON.stringify(resGroupe).slice(0, 200)}`);
    }
    onLog?.('info', `Groupe TVA créé : "${nomGroupe}" → id=${idGroupe}`);

    // ── Étape 3 : Créer la règle fiscale (France = id_country 8) ──
    const xmlRegle = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop xmlns:xlink="http://www.w3.org/1999/xlink">
  <tax_rule>
    <id_tax_rules_group><![CDATA[${idGroupe}]]></id_tax_rules_group>
    <id_country><![CDATA[8]]></id_country>
    <id_state><![CDATA[0]]></id_state>
    <id_tax><![CDATA[${idTaxe}]]></id_tax>
    <zipcode_from><![CDATA[0]]></zipcode_from>
    <zipcode_to><![CDATA[0]]></zipcode_to>
    <behavior><![CDATA[1]]></behavior>
    <description><![CDATA[]]></description>
  </tax_rule>
</prestashop>`;

    await prestaWrite('/tax_rules', xmlRegle, 'POST');
    onLog?.('succes', `Groupe TVA ${label} prêt → id_tax_rules_group=${idGroupe}`);

    taxGroupCache.set(tauxNum.toFixed(2), idGroupe);
    taxMapping.set(tauxNum.toFixed(2), idGroupe);

    return { idTaxGroup: idGroupe, tauxNum };

  } catch (err) {
    throw new Error(`Impossible de créer le groupe TVA ${label} : ${err.message}`);
  }
}

export function ttcVersHT(prixTTC, tauxTVA) {
  if (tauxTVA === 0) return prixTTC;
  return prixTTC / (1 + tauxTVA / 100);
}