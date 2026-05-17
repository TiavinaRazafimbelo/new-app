/**
 * ImportCombinationsPage.jsx
 * src/backoffice/import/ui/ImportCombinationsPage.jsx
 * ─────────────────────────────────────────────────────────────
 * Page d'import du CSV 2 (combinaisons / déclinaisons).
 *
 * WORKFLOW UI :
 *   1. Upload du fichier CSV
 *   2. Parsing + validation → aperçu du tableau des lignes
 *   3. Affichage des problèmes de validation ligne par ligne
 *   4. Bouton "Lancer l'import" → injection dans PS avec logs temps réel
 *   5. Rapport final (créés / stocks simples / ignorés / erreurs)
 *
 * DESIGN : identique à ImportProductsPage (palette CommandesPage.css)
 * ─────────────────────────────────────────────────────────────
 */

import React, { useState, useRef, useCallback } from 'react';
import { parseCSVCombinations } from '../parsers/parseCombinations.js';
import { importerCombinations } from '../importers/importCombinations.js';
import './ImportCombinationsPage.css';

// ─── Sous-composants ──────────────────────────────────────────

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

function LogLigne({ log }) {
  return (
    <div className={`log-ligne log-ligne--${log.type}`}>
      <LogBadge type={log.type} />
      {log.ref && <span className="log-ref">{log.ref}</span>}
      <span className="log-msg">{log.message}</span>
    </div>
  );
}

/**
 * Tableau d'aperçu des lignes du CSV 2 validées.
 * Affiche les deux modes : simple (stock seulement) et combo (déclinaison complète).
 */
function ApercuCombinations({ lignes }) {
  if (!lignes.length) return null;

  const nbCombos  = lignes.filter((l) => l.mode === 'combo').length;
  const nbSimples = lignes.filter((l) => l.mode === 'simple').length;

  return (
    <div className="apercu-wrapper">
      <h3 className="apercu-titre">
        Aperçu — {lignes.length} ligne{lignes.length > 1 ? 's' : ''} valide{lignes.length > 1 ? 's' : ''}
        {nbCombos  > 0 && <span className="apercu-chip apercu-chip--combo">{nbCombos} combo{nbCombos > 1 ? 's' : ''}</span>}
        {nbSimples > 0 && <span className="apercu-chip apercu-chip--simple">{nbSimples} stock{nbSimples > 1 ? 's' : ''} simple{nbSimples > 1 ? 's' : ''}</span>}
      </h3>
      <div className="apercu-scroll">
        <table className="apercu-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Référence</th>
              <th>Mode</th>
              <th>Groupe (FR)</th>
              <th>Valeur (FR)</th>
              <th>Valeur CSV</th>
              <th>Stock</th>
              <th>Prix TTC</th>
            </tr>
          </thead>
          <tbody>
            {lignes.map((l, i) => (
              <tr key={i} className={l.mode === 'simple' ? 'row--simple' : ''}>
                <td className="mono">{l.ligneCSV}</td>
                <td className="mono ref-cell">{l.reference}</td>
                <td>
                  {l.mode === 'simple'
                    ? <span className="mode-badge mode-badge--simple">Simple</span>
                    : <span className="mode-badge mode-badge--combo">Combo</span>
                  }
                </td>
                <td>{l.specificitePS ?? <span className="muted">—</span>}</td>
                <td className="val-ps">{l.karazanyPS ?? <span className="muted">—</span>}</td>
                <td className="mono muted">{l.karazany ?? '—'}</td>
                <td className="mono">{l.stockInitial}</td>
                <td className="mono">
                  {l.prixTTC !== null ? `${l.prixTTC.toFixed(2)} €` : <span className="muted">hérité</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

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
            <span className="avert-ligne__num">{a.ligne !== '—' ? `Ligne ${a.ligne}` : '—'}</span>
            <span className="avert-ligne__ref">{a.ref}</span>
            <span className="avert-ligne__msg">{a.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BilanFinal({ bilan }) {
  if (!bilan) return null;
  return (
    <div className="bilan-wrapper">
      <h3 className="bilan-titre">Résultat de l'import</h3>
      <div className="bilan-cartes">
        <div className="bilan-carte bilan-carte--succes">
          <span className="bilan-carte__val">{bilan.crees}</span>
          <span className="bilan-carte__label">Combo{bilan.crees > 1 ? 's' : ''} créé{bilan.crees > 1 ? 's' : ''}</span>
        </div>
        <div className="bilan-carte bilan-carte--info">
          <span className="bilan-carte__val">{bilan.simples}</span>
          <span className="bilan-carte__label">Stock{bilan.simples > 1 ? 's' : ''} simple{bilan.simples > 1 ? 's' : ''}</span>
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

export default function ImportCombinationsPage() {
  const [phase,         setPhase]         = useState('idle');
  const [parseResult,   setParseResult]   = useState(null);
  const [logs,          setLogs]          = useState([]);
  const [bilan,         setBilan]         = useState(null);
  const [erreurGlobale, setErreurGlobale] = useState('');

  const fileInputRef = useRef(null);
  const logsEndRef   = useRef(null);

  const ajouterLog = useCallback((log) => {
    setLogs((prev) => [...prev, { ...log, ts: Date.now() }]);
    setTimeout(() => logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  }, []);

  function handleFichierChange(e) {
    const fichier = e.target.files[0];
    if (!fichier) return;

    setLogs([]); setBilan(null); setErreurGlobale('');
    setParseResult(null); setPhase('idle');

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const result = parseCSVCombinations(ev.target.result);
        setParseResult(result);
        setPhase('parsed');
      } catch (err) {
        setErreurGlobale(`Erreur de lecture : ${err.message}`);
      }
    };
    reader.onerror = () => setErreurGlobale('Impossible de lire le fichier.');
    reader.readAsText(fichier, 'UTF-8');
  }

  function handleDrop(e) {
    e.preventDefault();
    const fichier = e.dataTransfer.files[0];
    if (!fichier) return;
    const dt = new DataTransfer();
    dt.items.add(fichier);
    fileInputRef.current.files = dt.files;
    handleFichierChange({ target: { files: dt.files } });
  }

  async function handleLancerImport() {
    if (!parseResult?.lignes?.length) return;
    setPhase('importing');
    setLogs([]); setBilan(null); setErreurGlobale('');
    try {
      const resultat = await importerCombinations(parseResult.lignes, ajouterLog);
      setBilan(resultat);
      setPhase('done');
    } catch (err) {
      setErreurGlobale(`Erreur critique : ${err.message}`);
      setPhase('done');
    }
  }

  function handleReset() {
    setPhase('idle'); setParseResult(null);
    setLogs([]); setBilan(null); setErreurGlobale('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  const nbValides   = parseResult?.lignes?.length        || 0;
  const nbProblemes = parseResult?.avertissements?.length || 0;
  const peutImporter = parseResult?.ok && nbValides > 0 && phase === 'parsed';

  return (
    <div className="import-page">

      {/* ── En-tête ─────────────────────────────────────────── */}
      <div className="import-entete">
        <div className="import-entete__left">
          <h2 className="import-titre">Import Déclinaisons</h2>
          <p className="import-sous-titre">
            CSV 2 — <code>reference, specificité, karazany, stock_initial, prix_vente_ttc</code>
          </p>
          <p className="import-prerequis">
            ⚠ Prérequis : les produits du CSV 1 doivent déjà être importés.
          </p>
        </div>
        {phase !== 'idle' && (
          <button className="btn-reset" onClick={handleReset}>↺ Recommencer</button>
        )}
      </div>

      {/* ── Upload ──────────────────────────────────────────── */}
      {phase === 'idle' && (
        <div
          className="upload-zone"
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="upload-zone__icone">🔀</div>
          <p className="upload-zone__texte">
            Glissez votre CSV déclinaisons ici ou <span className="upload-zone__lien">cliquez pour choisir</span>
          </p>
          <p className="upload-zone__hint">Fichier .csv · Encodage UTF-8</p>
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
          <span>⚠</span><span>{erreurGlobale}</span>
        </div>
      )}

      {parseResult && !parseResult.ok && (
        <div className="erreur-globale">
          <span>⚠ Import impossible :</span>
          <ul>{parseResult.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}

      {/* ── Résultat du parsing ──────────────────────────────── */}
      {parseResult?.ok && phase === 'parsed' && (
        <>
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

          <ApercuCombinations lignes={parseResult.lignes} />
          <AvertissementsValidation avertissements={parseResult.avertissements} />

          {peutImporter && (
            <div className="import-actions">
              <button className="btn-importer" onClick={handleLancerImport}>
                ▶ Lancer l'import ({nbValides} ligne{nbValides > 1 ? 's' : ''})
              </button>
            </div>
          )}
        </>
      )}

      {/* ── Logs ────────────────────────────────────────────── */}
      {(phase === 'importing' || phase === 'done') && logs.length > 0 && (
        <div className="logs-section">
          <div className="logs-header">
            <h3 className="logs-titre">Journal d'import</h3>
            {phase === 'importing' && (
              <span className="logs-spinner">
                <span className="spinner-dot" />En cours…
              </span>
            )}
          </div>
          <div className="logs-container">
            {logs.map((log, i) => <LogLigne key={i} log={log} />)}
            <div ref={logsEndRef} />
          </div>
        </div>
      )}

      {/* ── Bilan ────────────────────────────────────────────── */}
      {phase === 'done' && <BilanFinal bilan={bilan} />}

    </div>
  );
}
