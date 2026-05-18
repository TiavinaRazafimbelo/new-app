/**
 * ImportOrdersPage.jsx — v2
 * src/backoffice/import/ui/ImportOrdersPage.jsx
 * ─────────────────────────────────────────────────────────────
 * MISE À JOUR v2 :
 *   - Badge "Panier seul" dans l'aperçu pour les lignes cartOnly=true
 *   - BilanFinal affiche la carte "Paniers" (bilan.cartsCrees)
 *   - Import appelle parseCSVCommandes (inchangé côté API)
 * ─────────────────────────────────────────────────────────────
 */

import React, { useState, useRef, useCallback } from 'react';
import { parseCSVCommandes } from '../parsers/parseOrders.js';
import { importerCommandes } from '../importers/importOrders.js';
import './ImportOrdersPage.css';

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
 * Badge d'état — gère aussi le mode "Panier seul" (cartOnly).
 */
function EtatBadge({ etatPS, etatRaw, cartOnly }) {
  if (cartOnly) {
    return <span className="etat-badge etat--panier">🛒 Panier seul</span>;
  }
  const config = {
    1: { label: 'En attente',   cls: 'etat--attente'     },
    2: { label: 'Payé',         cls: 'etat--paye'        },
    3: { label: 'En prépa',     cls: 'etat--preparation' },
    4: { label: 'Expédié',      cls: 'etat--expedie'     },
    5: { label: 'Livré',        cls: 'etat--livre'       },
    6: { label: 'Annulé',       cls: 'etat--annule'      },
    7: { label: 'Remboursé',    cls: 'etat--rembourse'   },
  };
  const { label, cls } = config[etatPS] || { label: etatRaw || '—', cls: 'etat--defaut' };
  return <span className={`etat-badge ${cls}`}>{label}</span>;
}

function ApercuCommandes({ commandes }) {
  if (!commandes.length) return null;

  const nbCommandes = commandes.filter((c) => !c.cartOnly).length;
  const nbPaniers   = commandes.filter((c) =>  c.cartOnly).length;

  const resumeArticles = (articles) =>
    articles.map((a) =>
      `${a.reference} ×${a.quantite}${a.variante ? ` (${a.variante})` : ''}`
    ).join(', ');

  return (
    <div className="apercu-wrapper">
      <h3 className="apercu-titre">
        Aperçu — {commandes.length} ligne{commandes.length > 1 ? 's' : ''} valide{commandes.length > 1 ? 's' : ''}
        {nbCommandes > 0 && (
          <span className="apercu-chip apercu-chip--commande">{nbCommandes} commande{nbCommandes > 1 ? 's' : ''}</span>
        )}
        {nbPaniers > 0 && (
          <span className="apercu-chip apercu-chip--panier">{nbPaniers} panier{nbPaniers > 1 ? 's' : ''} seul{nbPaniers > 1 ? 's' : ''}</span>
        )}
      </h3>
      <div className="apercu-scroll">
        <table className="apercu-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Date</th>
              <th>Client</th>
              <th>Email</th>
              <th>Adresse</th>
              <th>Articles</th>
              <th>État</th>
            </tr>
          </thead>
          <tbody>
            {commandes.map((c, i) => (
              <tr key={i} className={c.cartOnly ? 'row--cart-only' : ''}>
                <td className="mono">{c.ligneCSV}</td>
                <td className="mono">{c.dateRaw}</td>
                <td className="nom-cell">{c.nom}</td>
                <td className="mono email-cell">{c.email}</td>
                <td className="adresse-cell">{c.adresse}</td>
                <td className="articles-cell">
                  <span title={resumeArticles(c.articles)}>
                    {c.articles.length} article{c.articles.length > 1 ? 's' : ''}
                    {' — '}
                    <span className="articles-detail">{resumeArticles(c.articles)}</span>
                  </span>
                </td>
                <td>
                  <EtatBadge etatPS={c.etatPS} etatRaw={c.etat} cartOnly={c.cartOnly} />
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
            <span className="avert-ligne__num">
              {a.ligne !== '—' && a.ligne !== undefined ? `Ligne ${a.ligne}` : '—'}
            </span>
            <span className="avert-ligne__ref">{a.ref}</span>
            <span className="avert-ligne__msg">{a.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Bilan avec 5 cartes : commandes, paniers, clients créés, existants, erreurs.
 */
function BilanFinal({ bilan }) {
  if (!bilan) return null;
  return (
    <div className="bilan-wrapper">
      <h3 className="bilan-titre">Résultat de l'import</h3>
      <div className="bilan-cartes">
        <div className="bilan-carte bilan-carte--succes">
          <span className="bilan-carte__val">{bilan.crees}</span>
          <span className="bilan-carte__label">Commande{bilan.crees !== 1 ? 's' : ''}</span>
        </div>
        <div className="bilan-carte bilan-carte--panier">
          <span className="bilan-carte__val">{bilan.cartsCrees ?? 0}</span>
          <span className="bilan-carte__label">Panier{(bilan.cartsCrees ?? 0) !== 1 ? 's' : ''} seul{(bilan.cartsCrees ?? 0) !== 1 ? 's' : ''}</span>
        </div>
        <div className="bilan-carte bilan-carte--info">
          <span className="bilan-carte__val">{bilan.clientsCrees}</span>
          <span className="bilan-carte__label">Client{bilan.clientsCrees !== 1 ? 's' : ''} créé{bilan.clientsCrees !== 1 ? 's' : ''}</span>
        </div>
        <div className="bilan-carte bilan-carte--muted">
          <span className="bilan-carte__val">{bilan.clientsExistants}</span>
          <span className="bilan-carte__label">Existant{bilan.clientsExistants !== 1 ? 's' : ''}</span>
        </div>
        <div className="bilan-carte bilan-carte--erreur">
          <span className="bilan-carte__val">{bilan.erreurs}</span>
          <span className="bilan-carte__label">Erreur{bilan.erreurs !== 1 ? 's' : ''}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Composant principal ──────────────────────────────────────

export default function ImportOrdersPage() {
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
        const result = parseCSVCommandes(ev.target.result);
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
    if (!parseResult?.commandes?.length) return;
    setPhase('importing');
    setLogs([]); setBilan(null); setErreurGlobale('');
    try {
      const resultat = await importerCommandes(parseResult.commandes, ajouterLog);
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

  const nbValides   = parseResult?.commandes?.length      || 0;
  const nbProblemes = parseResult?.avertissements?.length || 0;
  const peutImporter = parseResult?.ok && nbValides > 0 && phase === 'parsed';

  return (
    <div className="import-page">

      {/* ── En-tête ─────────────────────────────────────────── */}
      <div className="import-entete">
        <div className="import-entete__left">
          <h2 className="import-titre">Import Commandes</h2>
          <p className="import-sous-titre">
            CSV 3 — <code>date, nom, email, pwd, adresse, achat, etat</code>
          </p>
          <p className="import-prerequis">
            ⚠ Prérequis : CSV 1 (produits) et CSV 2 (déclinaisons) déjà importés.
            État vide = panier uniquement (pas de commande créée).
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
          <div className="upload-zone__icone">🛒</div>
          <p className="upload-zone__texte">
            Glissez votre CSV commandes ici ou{' '}
            <span className="upload-zone__lien">cliquez pour choisir</span>
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

      {/* ── Erreurs globales ─────────────────────────────────── */}
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

          <ApercuCommandes commandes={parseResult.commandes} />
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