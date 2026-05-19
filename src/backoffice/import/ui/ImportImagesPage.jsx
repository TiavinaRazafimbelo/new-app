/**
 * ImportImagesPage.jsx
 * src/backoffice/import/ui/ImportImagesPage.jsx
 * ─────────────────────────────────────────────────────────────
 * Page d'import du ZIP d'images produits.
 *
 * WORKFLOW :
 *   1. Upload du ZIP
 *   2. Extraction + aperçu des images trouvées
 *   3. Matching référence → id produit PrestaShop
 *   4. Upload de chaque image via POST /api/images/products/:id
 *
 * FORMAT ZIP ATTENDU :
 *   Les images sont nommées par référence produit : T_01.png, P_01.png...
 *   Extensions supportées : jpg, jpeg, png, webp, gif
 * ─────────────────────────────────────────────────────────────
 */

import React, { useState, useRef, useCallback } from 'react';
import JSZip from 'jszip';
import { prestaGet, prestaUploadImage, extraireVal } from '../config/prestaApi.js';
import './ImportImagesPage.css';

// ─── Constantes ───────────────────────────────────────────────

const EXTENSIONS_IMAGES = ['jpg', 'jpeg', 'png', 'webp', 'gif'];

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

function ApercuImages({ images }) {
  if (!images.length) return null;
  return (
    <div className="apercu-wrapper">
      <h3 className="apercu-titre">
        Aperçu — {images.length} image{images.length > 1 ? 's' : ''} trouvée{images.length > 1 ? 's' : ''}
      </h3>
      <div className="images-grille">
        {images.map((img) => (
          <div key={img.reference} className={`image-carte ${img.produitId ? 'image-carte--match' : 'image-carte--nomatch'}`}>
            <div className="image-carte__preview">
              <img src={img.objectUrl} alt={img.reference} />
            </div>
            <div className="image-carte__info">
              <span className="image-carte__ref">{img.reference}</span>
              <span className="image-carte__ext">.{img.ext}</span>
              {img.produitId
                ? <span className="image-carte__match">✓ Produit #{img.produitId}</span>
                : <span className="image-carte__nomatch">✗ Référence introuvable</span>
              }
            </div>
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
          <span className="bilan-carte__val">{bilan.uploades}</span>
          <span className="bilan-carte__label">Uploadée{bilan.uploades > 1 ? 's' : ''}</span>
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
  const [images,        setImages]        = useState([]);
  const [logs,          setLogs]          = useState([]);
  const [bilan,         setBilan]         = useState(null);
  const [erreurGlobale, setErreurGlobale] = useState('');
  const [progression,   setProgression]   = useState({ current: 0, total: 0 });

  const fileInputRef = useRef(null);
  const logsEndRef   = useRef(null);

  const ajouterLog = useCallback((type, message, ref = '') => {
    setLogs((prev) => [...prev, { type, message, ref, ts: Date.now() }]);
    setTimeout(() => logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  }, []);

  // ── Chargement des références PS ─────────────────────────────

  async function chargerReferencesPS() {
    const data  = await prestaGet('/products?display=[id,reference]');
    const bruts = data.products?.product || [];
    const liste = Array.isArray(bruts) ? bruts : [bruts];

    const map = new Map(); // référence → id produit
    for (const p of liste) {
      const ref = extraireVal(p.reference).trim();
      const id  = Number(extraireVal(p.id));
      if (ref && id) map.set(ref, id);
    }
    return map;
  }

  // ── Extraction du ZIP ─────────────────────────────────────────

  async function handleFichierChange(e) {
    const fichier = e.target.files[0];
    if (!fichier) return;

    setLogs([]); setBilan(null); setErreurGlobale('');
    setImages([]); setPhase('idle');

    try {
      ajouterLog('info', `Lecture du ZIP : ${fichier.name}`);

      const zip         = await JSZip.loadAsync(fichier);
      const referencesPS = await chargerReferencesPS();
      ajouterLog('info', `${referencesPS.size} référence(s) chargée(s) depuis PrestaShop`);

      const imagesExtraites = [];

      for (const [filename, entry] of Object.entries(zip.files)) {
        if (entry.dir) continue;

        const base = filename.split('/').pop();
        const dot  = base.lastIndexOf('.');
        if (dot === -1) continue;

        const ext = base.slice(dot + 1).toLowerCase();
        if (!EXTENSIONS_IMAGES.includes(ext)) continue;

        const reference = base.slice(0, dot).trim();
        const blob      = await entry.async('blob');
        const file      = new File([blob], base, { type: `image/${ext === 'jpg' ? 'jpeg' : ext}` });
        const objectUrl = URL.createObjectURL(blob);
        const produitId = referencesPS.get(reference) || null;

        imagesExtraites.push({ reference, ext, file, objectUrl, produitId });
      }

      if (!imagesExtraites.length) {
        setErreurGlobale('Aucune image trouvée dans le ZIP (formats acceptés : jpg, jpeg, png, webp, gif)');
        return;
      }

      ajouterLog('info', `${imagesExtraites.length} image(s) extraite(s)`);

      const sansProduit = imagesExtraites.filter((i) => !i.produitId).length;
      if (sansProduit > 0) {
        ajouterLog('warning', `${sansProduit} image(s) sans correspondance produit dans PS — ignorée(s) à l'import`);
      }

      setImages(imagesExtraites);
      setPhase('parsed');

    } catch (err) {
      setErreurGlobale(`Erreur : ${err.message}`);
    }
  }

  // ── Import ────────────────────────────────────────────────────

  async function handleLancerImport() {
    const aImporter = images.filter((i) => i.produitId);
    if (!aImporter.length) return;

    setPhase('importing');
    setLogs([]);
    setBilan(null);
    setProgression({ current: 0, total: aImporter.length });

    let uploades = 0, erreurs = 0, skips = 0;

    for (let i = 0; i < aImporter.length; i++) {
      const img = aImporter[i];
      setProgression({ current: i + 1, total: aImporter.length });

      try {
        ajouterLog('info', `Upload "${img.reference}.${img.ext}" → produit #${img.produitId}`, img.reference);
        await prestaUploadImage(img.produitId, img.file);
        ajouterLog('succes', `Image "${img.reference}" uploadée avec succès`, img.reference);
        uploades++;
      } catch (err) {
        ajouterLog('erreur', `Échec upload "${img.reference}" : ${err.message}`, img.reference);
        erreurs++;
      }
    }

    skips = images.filter((i) => !i.produitId).length;
    ajouterLog('info', `Import terminé — ✓ ${uploades} uploadée(s) · ⚠ ${skips} ignorée(s) · ✗ ${erreurs} erreur(s)`);

    setBilan({ uploades, skips, erreurs });
    setPhase('done');
  }

  function handleReset() {
    // Libérer les object URLs
    images.forEach((img) => URL.revokeObjectURL(img.objectUrl));
    setPhase('idle'); setImages([]); setLogs([]);
    setBilan(null); setErreurGlobale('');
    setProgression({ current: 0, total: 0 });
    if (fileInputRef.current) fileInputRef.current.value = '';
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

  const nbAvecProduit = images.filter((i) => i.produitId).length;
  const peutImporter  = nbAvecProduit > 0 && phase === 'parsed';

  // ─── Render ─────────────────────────────────────────────────

  return (
    <div className="import-page">

      {/* En-tête */}
      <div className="import-entete">
        <div className="import-entete__left">
          <h2 className="import-titre">Import Images</h2>
          <p className="import-sous-titre">
            ZIP — Images nommées par référence produit : <code>T_01.png</code>, <code>P_01.png</code>…
          </p>
          <p className="import-prerequis">
            ⚠ Prérequis : les produits (CSV 1) doivent être importés avant les images.
          </p>
        </div>
        {phase !== 'idle' && (
          <button className="btn-reset" onClick={handleReset}>↺ Recommencer</button>
        )}
      </div>

      {/* Zone d'upload */}
      {phase === 'idle' && (
        <div
          className="upload-zone"
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="upload-zone__icone">🗜</div>
          <p className="upload-zone__texte">
            Glissez votre fichier ZIP ici ou{' '}
            <span className="upload-zone__lien">cliquez pour choisir</span>
          </p>
          <p className="upload-zone__hint">
            Fichier .zip · Images nommées par référence (T_01.png, P_01.jpg…)
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip,application/zip"
            onChange={handleFichierChange}
            style={{ display: 'none' }}
          />
        </div>
      )}

      {/* Erreur globale */}
      {erreurGlobale && (
        <div className="erreur-globale">
          <span>⚠</span><span>{erreurGlobale}</span>
        </div>
      )}

      {/* Aperçu */}
      {phase === 'parsed' && images.length > 0 && (
        <>
          <div className="validation-resume">
            <div className={`validation-chip ${nbAvecProduit > 0 ? 'chip--vert' : 'chip--gris'}`}>
              ✓ {nbAvecProduit} image{nbAvecProduit > 1 ? 's' : ''} prête{nbAvecProduit > 1 ? 's' : ''}
            </div>
            {images.length - nbAvecProduit > 0 && (
              <div className="validation-chip chip--orange">
                ⚠ {images.length - nbAvecProduit} sans correspondance produit
              </div>
            )}
          </div>

          <ApercuImages images={images} />

          {peutImporter && (
            <div className="import-actions">
              <button className="btn-importer" onClick={handleLancerImport}>
                ▶ Uploader {nbAvecProduit} image{nbAvecProduit > 1 ? 's' : ''}
              </button>
            </div>
          )}
        </>
      )}

      {/* Barre de progression */}
      {phase === 'importing' && progression.total > 0 && (
        <div className="progression-wrapper">
          <div className="progression-barre">
            <div
              className="progression-barre__fill"
              style={{ width: `${(progression.current / progression.total) * 100}%` }}
            />
          </div>
          <span className="progression-label">
            {progression.current} / {progression.total} images
          </span>
        </div>
      )}

      {/* Logs */}
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

      {/* Bilan */}
      {phase === 'done' && <BilanFinal bilan={bilan} />}

    </div>
  );
}