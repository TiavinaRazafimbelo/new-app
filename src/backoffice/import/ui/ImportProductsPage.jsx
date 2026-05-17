/**
 * ImportProductsPage.jsx
 * src/backoffice/import/ui/ImportProductsPage.jsx
 * ─────────────────────────────────────────────────────────────
 * Page d'import du CSV 1 (produits).
 *
 * WORKFLOW UI :
 *   1. Upload du fichier CSV
 *   2. Parsing + validation → aperçu du tableau des produits
 *   3. Affichage des erreurs de validation ligne par ligne
 *   4. Bouton "Lancer l'import" → injection dans PS avec logs temps réel
 *   5. Rapport final (créés / ignorés / erreurs)
 * ─────────────────────────────────────────────────────────────
 */

import React, { useState, useRef, useCallback } from 'react';
import { parseCSVProduits }  from '../parsers/parseProducts.js';
import { importerProduits }  from '../importers/importProducts.js';
import './ImportProductsPage.css';

// ─── Sous-composants ──────────────────────────────────────────

/** Badge coloré selon le type de log */
function LogBadge({ type }) {
  const map = {
    info:    { label: 'INFO',    cls: 'log-badge--info'    },
    succes:  { label: '✓ OK',   cls: 'log-badge--succes'  },
    erreur:  { label: '✗ ERR',  cls: 'log-badge--erreur'  },
    warning: { label: '⚠ WARN', cls: 'log-badge--warning' },
  };
  const { label, cls } = map[type] || map.info;
  return <span className={`log-badge ${cls}`}>{label}</span>;
}

/** Une ligne de log */
function LogLigne({ log }) {
  return (
    <div className={`log-ligne log-ligne--${log.type}`}>
      <LogBadge type={log.type} />
      {log.ref && <span className="log-ref">{log.ref}</span>}
      <span className="log-msg">{log.message}</span>
    </div>
  );
}

/** Tableau d'aperçu des produits validés */
function ApercuProduits({ produits }) {
  if (!produits.length) return null;

  return (
    <div className="apercu-wrapper">
      <h3 className="apercu-titre">
        Aperçu — {produits.length} produit{produits.length > 1 ? 's' : ''} valide{produits.length > 1 ? 's' : ''}
      </h3>
      <div className="apercu-scroll">
        <table className="apercu-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Référence</th>
              <th>Nom</th>
              <th>Catégorie</th>
              <th>Prix TTC</th>
              <th>TVA</th>
              <th>Prix achat</th>
              <th>Dispo</th>
            </tr>
          </thead>
          <tbody>
            {produits.map((p) => (
              <tr key={p.reference}>
                <td className="mono">{p.ligneCSV}</td>
                <td className="mono ref-cell">{p.reference}</td>
                <td>{p.nom}</td>
                <td><span className="cat-badge">{p.categorie}</span></td>
                <td className="mono">{p.prixTTC.toFixed(2)} €</td>
                <td className="mono">{p.tauxTVA}%</td>
                <td className="mono">{p.prixAchat.toFixed(2)} €</td>
                <td className="mono">{p.dateDisponible}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Tableau des erreurs / avertissements de validation */
function AvertissementsValidation({ avertissements }) {
  if (!avertissements.length) return null;

  return (
    <div className="avert-wrapper">
      <h3 className="avert-titre">
        {avertissements.length} problème{avertissements.length > 1 ? 's' : ''} détecté{avertissements.length > 1 ? 's' : ''}
      </h3>
      <div className="avert-liste">
        {avertissements.map((a, i) => (
          <div key={i} className={`avert-ligne avert-ligne--${a.type || 'erreur'}`}>
            <span className="avert-ligne__num">Ligne {a.ligne}</span>
            <span className="avert-ligne__ref">{a.ref}</span>
            <span className="avert-ligne__msg">{a.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Carte bilan final */
function BilanFinal({ bilan }) {
  if (!bilan) return null;

  return (
    <div className="bilan-wrapper">
      <h3 className="bilan-titre">Résultat de l'import</h3>
      <div className="bilan-cartes">
        <div className="bilan-carte bilan-carte--succes">
          <span className="bilan-carte__val">{bilan.crees}</span>
          <span className="bilan-carte__label">Créé{bilan.crees > 1 ? 's' : ''}</span>
        </div>
        <div className="bilan-carte bilan-carte--warning">
          <span className="bilan-carte__val">{bilan.skips}</span>
          <span className="bilan-carte__label">Ignoré{bilan.skips > 1 ? 's' : ''}</span>
        </div>
        <div className="bilan-carte bilan-carte--erreur">
          <span className="bilan-carte__val">{bilan.erreurs}</span>
          <span className="bilan-carte__label">Erreur{bilan.erreurs > 1 ? 's' : ''}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Composant principal ──────────────────────────────────────

export default function ImportProductsPage() {
  // ── États ──────────────────────────────────────────────────
  const [phase, setPhase]             = useState('idle');
  // idle → parsed → importing → done

  const [parseResult, setParseResult] = useState(null);
  // résultat de parseCSVProduits()

  const [logs, setLogs]               = useState([]);
  const [bilan, setBilan]             = useState(null);
  const [erreurGlobale, setErreurGlobale] = useState('');

  const fileInputRef  = useRef(null);
  const logsEndRef    = useRef(null);

  // ── Callback de log temps réel ──────────────────────────────
  const ajouterLog = useCallback((log) => {
    setLogs((prev) => [...prev, { ...log, ts: Date.now() }]);
    // Scroll vers le bas
    setTimeout(() => {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 50);
  }, []);

  // ── Gestion du fichier uploadé ──────────────────────────────
  function handleFichierChange(e) {
    const fichier = e.target.files[0];
    if (!fichier) return;

    // Réinitialiser
    setLogs([]);
    setBilan(null);
    setErreurGlobale('');
    setParseResult(null);
    setPhase('idle');

    // Lire le fichier
    const reader = new FileReader();
    reader.onload = (ev) => {
      const texte = ev.target.result;
      try {
        const result = parseCSVProduits(texte);
        setParseResult(result);
        setPhase('parsed');
      } catch (err) {
        setErreurGlobale(`Erreur de lecture du fichier : ${err.message}`);
      }
    };
    reader.onerror = () => setErreurGlobale('Impossible de lire le fichier.');
    reader.readAsText(fichier, 'UTF-8');
  }

  // ── Drag & Drop ─────────────────────────────────────────────
  function handleDrop(e) {
    e.preventDefault();
    const fichier = e.dataTransfer.files[0];
    if (fichier) {
      // Simuler un changement d'input
      const dt       = new DataTransfer();
      dt.items.add(fichier);
      fileInputRef.current.files = dt.files;
      handleFichierChange({ target: { files: dt.files } });
    }
  }

  // ── Lancer l'import ─────────────────────────────────────────
  async function handleLancerImport() {
    if (!parseResult?.produits?.length) return;

    setPhase('importing');
    setLogs([]);
    setBilan(null);
    setErreurGlobale('');

    try {
      const resultat = await importerProduits(parseResult.produits, ajouterLog);
      setBilan(resultat);
      setPhase('done');
    } catch (err) {
      setErreurGlobale(`Erreur critique : ${err.message}`);
      setPhase('done');
    }
  }

  // ── Réinitialiser ───────────────────────────────────────────
  function handleReset() {
    setPhase('idle');
    setParseResult(null);
    setLogs([]);
    setBilan(null);
    setErreurGlobale('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  // ── Dérivations ─────────────────────────────────────────────
  const nbValides  = parseResult?.produits?.length        || 0;
  const nbProblemes = parseResult?.avertissements?.length || 0;
  const peutImporter = parseResult?.ok && nbValides > 0 && phase === 'parsed';

  // ─── Render ─────────────────────────────────────────────────
  return (
    <div className="import-page">

      {/* ── En-tête ─────────────────────────────────────────── */}
      <div className="import-entete">
        <div className="import-entete__left">
          <h2 className="import-titre">Import Produits</h2>
          <p className="import-sous-titre">
            CSV 1 — <code>date_availability_produit, nom, reference, prix_ttc, Taxe, categorie, prix_achat</code>
          </p>
        </div>
        {phase !== 'idle' && (
          <button className="btn-reset" onClick={handleReset}>
            ↺ Recommencer
          </button>
        )}
      </div>

      {/* ── Zone d'upload ────────────────────────────────────── */}
      {phase === 'idle' && (
        <div
          className="upload-zone"
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="upload-zone__icone">📄</div>
          <p className="upload-zone__texte">
            Glissez votre fichier CSV ici ou <span className="upload-zone__lien">cliquez pour choisir</span>
          </p>
          <p className="upload-zone__hint">Fichier .csv attendu · Encodage UTF-8</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleFichierChange}
            style={{ display: 'none' }}
          />
        </div>
      )}

      {/* ── Erreur globale ───────────────────────────────────── */}
      {erreurGlobale && (
        <div className="erreur-globale">
          <span>⚠</span>
          <span>{erreurGlobale}</span>
        </div>
      )}

      {/* ── Résultat du parsing ──────────────────────────────── */}
      {parseResult && !parseResult.ok && (
        <div className="erreur-globale">
          <span>⚠ Import impossible :</span>
          <ul>
            {parseResult.errors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </div>
      )}

      {parseResult?.ok && phase === 'parsed' && (
        <>
          {/* Résumé de validation */}
          <div className="validation-resume">
            <div className={`validation-chip ${nbValides > 0 ? 'chip--vert' : 'chip--gris'}`}>
              ✓ {nbValides} ligne{nbValides > 1 ? 's' : ''} valide{nbValides > 1 ? 's' : ''}
            </div>
            {nbProblemes > 0 && (
              <div className="validation-chip chip--orange">
                ⚠ {nbProblemes} problème{nbProblemes > 1 ? 's' : ''} détecté{nbProblemes > 1 ? 's' : ''}
              </div>
            )}
          </div>

          {/* Aperçu des produits valides */}
          <ApercuProduits produits={parseResult.produits} />

          {/* Avertissements de validation */}
          <AvertissementsValidation avertissements={parseResult.avertissements} />

          {/* Bouton lancer l'import */}
          {peutImporter && (
            <div className="import-actions">
              <button className="btn-importer" onClick={handleLancerImport}>
                ▶ Lancer l'import ({nbValides} produit{nbValides > 1 ? 's' : ''})
              </button>
            </div>
          )}
        </>
      )}

      {/* ── Logs d'import temps réel ─────────────────────────── */}
      {(phase === 'importing' || phase === 'done') && logs.length > 0 && (
        <div className="logs-section">
          <div className="logs-header">
            <h3 className="logs-titre">Journal d'import</h3>
            {phase === 'importing' && (
              <span className="logs-spinner">
                <span className="spinner-dot" />
                En cours…
              </span>
            )}
          </div>
          <div className="logs-container">
            {logs.map((log, i) => (
              <LogLigne key={i} log={log} />
            ))}
            <div ref={logsEndRef} />
          </div>
        </div>
      )}

      {/* ── Bilan final ─────────────────────────────────────── */}
      {phase === 'done' && <BilanFinal bilan={bilan} />}

    </div>
  );
}
