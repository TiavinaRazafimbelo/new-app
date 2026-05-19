/**
 * ImportImagesPage.jsx
 * src/backoffice/import/ui/ImportImagesPage.jsx
 * ─────────────────────────────────────────────────────────────
 * Import d'un fichier ZIP contenant les images des produits.
 *
 * Convention de nommage : {reference}.png (ex: T_01.png)
 * L'image est uploadée via POST /api/images/products/:id
 *
 * WORKFLOW :
 *   1. Upload du fichier ZIP
 *   2. Extraction des fichiers via JSZip
 *   3. Pour chaque image, résolution de la référence → id_product PS
 *   4. Upload via prestaUploadImage()
 *   5. Journal temps réel + bilan final
 * ─────────────────────────────────────────────────────────────
 */

import React, { useState, useRef, useCallback } from 'react';
import JSZip from 'jszip';
import { prestaGet, prestaUploadImage, extraireVal } from '../config/prestaApi.js';
import './ImportImagesPage.css';

// ─── Helpers ──────────────────────────────────────────────────

/** Extrait la référence depuis un nom de fichier : "T_01.png" → "T_01" */
function refDepuisNomFichier(nomFichier) {
  return nomFichier.replace(/\.[^.]+$/, '').trim();
}

/** Vérifie qu'un fichier est une image supportée */
function estImage(nom) {
  return /\.(png|jpg|jpeg|gif|webp)$/i.test(nom);
}

/** Filtre les fichiers parasites des ZIPs (macOS __MACOSX, .DS_Store, etc.) */
function estFichierValide(chemin) {
  return (
    !chemin.startsWith('__MACOSX/') &&
    !chemin.includes('/.') &&
    !chemin.endsWith('.DS_Store') &&
    estImage(chemin.split('/').pop())
  );
}

/** Charge le mapping référence → id_product depuis l'API PrestaShop */
async function chargerMappingProduits() {
  const data  = await prestaGet('/products?display=[id,reference]');
  const bruts = data.products?.product || [];
  const liste = Array.isArray(bruts) ? bruts : [bruts];

  const map = new Map(); // reference → id
  for (const p of liste) {
    const ref = extraireVal(p.reference).trim();
    const id  = extraireVal(p.id).trim();
    if (ref && id) map.set(ref, id);
  }
  return map;
}

// ─── Sous-composants ──────────────────────────────────────────

function LogBadge({ type }) {
  const map = {
    info:    { label: 'INFO',    cls: 'log-badge--info'    },
    succes:  { label: '✓ OK',   cls: 'log-badge--succes'  },
    erreur:  { label: '✗ ERR',  cls: 'log-badge--erreur'  },
    warning: { label: '⚠ SKIP', cls: 'log-badge--warning' },
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

function BilanFinal({ bilan }) {
  if (!bilan) return null;
  return (
    <div className="bilan-wrapper">
      <h3 className="bilan-titre">Résultat de l'import</h3>
      <div className="bilan-cartes">
        <div className="bilan-carte bilan-carte--succes">
          <span className="bilan-carte__val">{bilan.uploades}</span>
          <span className="bilan-carte__label">Image{bilan.uploades > 1 ? 's' : ''} uploadée{bilan.uploades > 1 ? 's' : ''}</span>
        </div>
        <div className="bilan-carte bilan-carte--warning">
          <span className="bilan-carte__val">{bilan.skips}</span>
          <span className="bilan-carte__label">Ignorée{bilan.skips > 1 ? 's' : ''}</span>
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

export default function ImportImagesPage() {
  const [phase,         setPhase]         = useState('idle');
  const [fichierZip,    setFichierZip]    = useState(null);
  const [apercu,        setApercu]        = useState([]); // [{ nom, ref }]
  const [logs,          setLogs]          = useState([]);
  const [bilan,         setBilan]         = useState(null);
  const [erreurGlobale, setErreurGlobale] = useState('');

  const fileInputRef = useRef(null);
  const logsEndRef   = useRef(null);

  const ajouterLog = useCallback((type, message, ref = '') => {
    setLogs((prev) => [...prev, { type, message, ref, ts: Date.now() }]);
    setTimeout(() => logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  }, []);

  // ── Lecture du ZIP ──────────────────────────────────────────
  async function handleFichierChange(e) {
    const fichier = e.target.files[0];
    if (!fichier) return;

    setLogs([]); setBilan(null); setErreurGlobale('');
    setApercu([]); setPhase('idle');

    try {
      const zip      = await JSZip.loadAsync(fichier);
      const entrees  = Object.values(zip.files)
        .filter((f) => !f.dir && estFichierValide(f.name));

      if (entrees.length === 0) {
        setErreurGlobale('Aucune image valide trouvée dans le ZIP (formats: png, jpg, jpeg, gif, webp).');
        return;
      }

      const apercuListe = entrees.map((f) => ({
        nom: f.name.split('/').pop(),
        ref: refDepuisNomFichier(f.name.split('/').pop()),
      }));

      setFichierZip(fichier);
      setApercu(apercuListe);
      setPhase('parsed');
    } catch (err) {
      setErreurGlobale(`Impossible de lire le ZIP : ${err.message}`);
    }
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

  // ── Lancer l'import ─────────────────────────────────────────
  async function handleLancerImport() {
    if (!fichierZip) return;
    setPhase('importing');
    setLogs([]); setBilan(null);

    const bilan = { uploades: 0, skips: 0, erreurs: 0 };

    try {
      // Charger le mapping référence → id_produit
      ajouterLog('info', 'Chargement du mapping produits PrestaShop…');
      const prodMap = await chargerMappingProduits();
      ajouterLog('info', `${prodMap.size} produit(s) trouvé(s) dans PS`);

      // Rouvrir le ZIP
      const zip     = await JSZip.loadAsync(fichierZip);
      const entrees = Object.values(zip.files)
        .filter((f) => !f.dir && estFichierValide(f.name));

      ajouterLog('info', `${entrees.length} image(s) à traiter dans le ZIP`);

      for (const entry of entrees) {
        const nomFichier = entry.name.split('/').pop();
        const ref        = refDepuisNomFichier(nomFichier);
        const idProduit  = prodMap.get(ref);

        if (!idProduit) {
          ajouterLog('warning', `Référence "${ref}" introuvable dans PS — image ignorée`, ref);
          bilan.skips++;
          continue;
        }

        try {
          // Extraire le blob du fichier depuis le ZIP
          const blob = await entry.async('blob');
          // Déterminer le type MIME selon l'extension
          const ext      = nomFichier.split('.').pop().toLowerCase();
          const mimeMap  = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
          const mimeType = mimeMap[ext] || 'image/png';
          const imageFile = new File([blob], nomFichier, { type: mimeType });

          await prestaUploadImage(idProduit, imageFile);
          ajouterLog('succes', `"${nomFichier}" uploadée → produit id=${idProduit} (ref=${ref})`, ref);
          bilan.uploades++;
        } catch (err) {
          ajouterLog('erreur', `"${nomFichier}" : ${err.message}`, ref);
          bilan.erreurs++;
        }

        // Délai pour ne pas surcharger l'API
        await new Promise((r) => setTimeout(r, 150));
      }

      ajouterLog('info', `Import terminé — ✓ ${bilan.uploades} uploadée(s) · ⚠ ${bilan.skips} ignorée(s) · ✗ ${bilan.erreurs} erreur(s)`);
      setBilan(bilan);
      setPhase('done');

    } catch (err) {
      setErreurGlobale(`Erreur critique : ${err.message}`);
      setPhase('done');
    }
  }

  function handleReset() {
    setPhase('idle'); setFichierZip(null);
    setApercu([]); setLogs([]); setBilan(null); setErreurGlobale('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  const peutImporter = phase === 'parsed' && apercu.length > 0;

  // ─── Render ──────────────────────────────────────────────
  return (
    <div className="import-page">

      <div className="import-entete">
        <div className="import-entete__left">
          <h2 className="import-titre">Import Images</h2>
          <p className="import-sous-titre">
            ZIP — fichiers nommés <code>{'{reference}.png'}</code> (ex: <code>T_01.png</code>)
          </p>
          <p className="import-prerequis">
            ⚠ Prérequis : les produits (CSV 1) doivent être importés.
          </p>
        </div>
        {phase !== 'idle' && (
          <button className="btn-reset" onClick={handleReset}>↺ Recommencer</button>
        )}
      </div>

      {phase === 'idle' && (
        <div
          className="upload-zone"
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="upload-zone__icone">🖼️</div>
          <p className="upload-zone__texte">
            Glissez votre fichier ZIP ici ou{' '}
            <span className="upload-zone__lien">cliquez pour choisir</span>
          </p>
          <p className="upload-zone__hint">Fichier .zip · Images: png, jpg, jpeg, gif, webp</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip,application/zip"
            onChange={handleFichierChange}
            style={{ display: 'none' }}
          />
        </div>
      )}

      {erreurGlobale && (
        <div className="erreur-globale"><span>⚠</span><span>{erreurGlobale}</span></div>
      )}

      {phase === 'parsed' && apercu.length > 0 && (
        <>
          <div className="validation-resume">
            <div className="validation-chip chip--vert">
              ✓ {apercu.length} image{apercu.length > 1 ? 's' : ''} détectée{apercu.length > 1 ? 's' : ''} dans le ZIP
            </div>
          </div>

          <div className="apercu-wrapper">
            <h3 className="apercu-titre">Aperçu des images à importer</h3>
            <div className="apercu-scroll">
              <table className="apercu-table">
                <thead>
                  <tr>
                    <th>Fichier</th>
                    <th>Référence produit</th>
                  </tr>
                </thead>
                <tbody>
                  {apercu.map((img, i) => (
                    <tr key={i}>
                      <td className="mono">{img.nom}</td>
                      <td className="mono ref-cell">{img.ref}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {peutImporter && (
            <div className="import-actions">
              <button className="btn-importer" onClick={handleLancerImport}>
                ▶ Lancer l'import ({apercu.length} image{apercu.length > 1 ? 's' : ''})
              </button>
            </div>
          )}
        </>
      )}

      {(phase === 'importing' || phase === 'done') && logs.length > 0 && (
        <div className="logs-section">
          <div className="logs-header">
            <h3 className="logs-titre">Journal d'import</h3>
            {phase === 'importing' && (
              <span className="logs-spinner"><span className="spinner-dot" />En cours…</span>
            )}
          </div>
          <div className="logs-container">
            {logs.map((log, i) => <LogLigne key={i} log={log} />)}
            <div ref={logsEndRef} />
          </div>
        </div>
      )}

      {phase === 'done' && <BilanFinal bilan={bilan} />}
    </div>
  );
}