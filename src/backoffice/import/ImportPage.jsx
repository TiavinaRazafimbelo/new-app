/**
 * ImportPage.jsx
 * Interface backoffice pour l'import intelligent des CSV + ZIP.
 *
 * Fonctionnalités :
 *   - Upload des 3 CSV et du ZIP d'images
 *   - Aperçu des données parsées avant import
 *   - Lancement de l'import avec log en temps réel
 *   - Résumé final (succès / erreurs / skips)
 */

import { useState, useRef, useCallback } from 'react';
import { runImport } from './importOrchestrator.js';

// ─── Composant principal ──────────────────────────────────────

export default function ImportPage() {
  const [files, setFiles]         = useState({ csv1: null, csv2: null, csv3: null, zip: null });
  const [previews, setPreviews]   = useState({});
  const [logs, setLogs]           = useState([]);
  const [running, setRunning]     = useState(false);
  const [done, setDone]           = useState(false);
  const [stats, setStats]         = useState({ success: 0, warning: 0, error: 0, skip: 0 });
  const logsEndRef                = useRef(null);

  // ── Gestion fichiers ────────────────────────────────────────

  const handleFileChange = useCallback(async (key, file) => {
    if (!file) return;
    setFiles((prev) => ({ ...prev, [key]: file }));

    // Aperçu CSV
    if (key !== 'zip') {
      try {
        const text  = await file.text();
        const lines = text.split('\n').slice(0, 6).join('\n');
        setPreviews((prev) => ({ ...prev, [key]: lines }));
      } catch {}
    } else {
      setPreviews((prev) => ({ ...prev, zip: `📦 ${file.name} (${(file.size / 1024).toFixed(1)} Ko)` }));
    }
  }, []);

  // ── Import ──────────────────────────────────────────────────

  const addLog = useCallback((message, type = 'info') => {
    setLogs((prev) => [...prev, { message, type, ts: Date.now() }]);
    if (type === 'success') setStats((s) => ({ ...s, success: s.success + 1 }));
    if (type === 'warning') setStats((s) => ({ ...s, warning: s.warning + 1 }));
    if (type === 'error')   setStats((s) => ({ ...s, error:   s.error   + 1 }));
    if (type === 'skip')    setStats((s) => ({ ...s, skip:    s.skip    + 1 }));
    setTimeout(() => logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  }, []);

  const handleImport = useCallback(async () => {
    if (!files.csv1 || !files.csv2 || !files.csv3) {
      alert('Les 3 fichiers CSV sont requis.');
      return;
    }

    setLogs([]);
    setStats({ success: 0, warning: 0, error: 0, skip: 0 });
    setRunning(true);
    setDone(false);

    try {
      await runImport(files, addLog);
    } catch (err) {
      addLog(`❌ Erreur fatale : ${err.message}`, 'error');
    } finally {
      setRunning(false);
      setDone(true);
    }
  }, [files, addLog]);

  const canImport = files.csv1 && files.csv2 && files.csv3 && !running;

  // ── Rendu ───────────────────────────────────────────────────

  return (
    <div style={styles.page}>
      <h1 style={styles.title}>📥 Import intelligent PrestaShop</h1>
      <p style={styles.subtitle}>
        Importe produits, combinaisons, stocks, images, clients et commandes
        depuis les fichiers CSV fournis par le professeur.
      </p>

      {/* Zone upload */}
      <div style={styles.uploadGrid}>
        <FileZone
          label="CSV 1 — Produits"
          hint="date_availability_produit | nom | reference | prix_ttc | Taxe | categorie | prix_achat"
          accept=".csv,.txt"
          preview={previews.csv1}
          onChange={(f) => handleFileChange('csv1', f)}
          icon="🏷"
        />
        <FileZone
          label="CSV 2 — Combinaisons & Stocks"
          hint="reference | specificité | karazany | stock_initial | prix_vente_ttc"
          accept=".csv,.txt"
          preview={previews.csv2}
          onChange={(f) => handleFileChange('csv2', f)}
          icon="🔀"
        />
        <FileZone
          label="CSV 3 — Clients & Commandes"
          hint="date | nom | email | pwd | adresse | achat | etat"
          accept=".csv,.txt"
          preview={previews.csv3}
          onChange={(f) => handleFileChange('csv3', f)}
          icon="👥"
        />
        <FileZone
          label="ZIP — Images produits"
          hint="Nommées par référence : T_01.jpg, P_01.jpg..."
          accept=".zip"
          preview={previews.zip}
          onChange={(f) => handleFileChange('zip', f)}
          icon="🖼"
          optional
        />
      </div>

      {/* Ordre d'import */}
      <div style={styles.orderBox}>
        <strong>Ordre d'import automatique :</strong>
        <span style={styles.step}>1. Catégories</span>
        <span style={styles.arrow}>→</span>
        <span style={styles.step}>2. Produits + Images</span>
        <span style={styles.arrow}>→</span>
        <span style={styles.step}>3. Combinaisons + Stocks</span>
        <span style={styles.arrow}>→</span>
        <span style={styles.step}>4. Clients + Commandes + Paniers</span>
      </div>

      {/* Bouton */}
      <button
        style={{ ...styles.btn, opacity: canImport ? 1 : 0.5 }}
        onClick={handleImport}
        disabled={!canImport}
      >
        {running ? '⏳ Import en cours...' : '🚀 Lancer l\'import'}
      </button>

      {/* Stats */}
      {logs.length > 0 && (
        <div style={styles.statsRow}>
          <Stat label="Succès"    value={stats.success} color="#22c55e" />
          <Stat label="Ignorés"   value={stats.skip}    color="#3b82f6" />
          <Stat label="Warnings"  value={stats.warning} color="#f59e0b" />
          <Stat label="Erreurs"   value={stats.error}   color="#ef4444" />
        </div>
      )}

      {/* Logs */}
      {logs.length > 0 && (
        <div style={styles.logBox}>
          {logs.map((log, i) => (
            log.type === 'separator'
              ? <div key={i} style={styles.separator} />
              : <div key={i} style={{ ...styles.logLine, color: LOG_COLORS[log.type] || '#ccc' }}>
                  {log.type === 'phase'
                    ? <strong>{log.message}</strong>
                    : log.message}
                </div>
          ))}
          <div ref={logsEndRef} />
        </div>
      )}

      {done && (
        <div style={styles.doneBox}>
          {stats.error === 0
            ? '🎉 Import terminé avec succès !'
            : `⚠ Import terminé avec ${stats.error} erreur(s). Vérifiez les logs ci-dessus.`}
        </div>
      )}
    </div>
  );
}

// ─── Sous-composants ──────────────────────────────────────────

function FileZone({ label, hint, accept, preview, onChange, icon, optional }) {
  const inputRef = useRef(null);

  return (
    <div style={styles.fileZone}>
      <div style={styles.fileLabel}>
        <span>{icon}</span> {label}
        {optional && <span style={styles.optionalBadge}>optionnel</span>}
      </div>
      <div style={styles.fileHint}>{hint}</div>
      <button
        style={styles.uploadBtn}
        onClick={() => inputRef.current?.click()}
      >
        {preview ? '✅ Fichier chargé — Changer' : '📂 Choisir le fichier'}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        style={{ display: 'none' }}
        onChange={(e) => onChange(e.target.files?.[0] || null)}
      />
      {preview && (
        <pre style={styles.preview}>{preview}</pre>
      )}
    </div>
  );
}

function Stat({ label, value, color }) {
  return (
    <div style={{ ...styles.statBox, borderColor: color }}>
      <div style={{ ...styles.statValue, color }}>{value}</div>
      <div style={styles.statLabel}>{label}</div>
    </div>
  );
}

// ─── Couleurs logs ────────────────────────────────────────────

const LOG_COLORS = {
  info:    '#94a3b8',
  success: '#22c55e',
  warning: '#f59e0b',
  error:   '#ef4444',
  skip:    '#3b82f6',
  phase:   '#e2e8f0',
};

// ─── Styles ───────────────────────────────────────────────────

const styles = {
  page: {
    maxWidth: 1100,
    margin: '0 auto',
    padding: '32px 24px',
    fontFamily: 'system-ui, sans-serif',
    color: '#1e293b',
  },
  title: {
    fontSize: 28,
    fontWeight: 700,
    marginBottom: 8,
  },
  subtitle: {
    color: '#64748b',
    marginBottom: 32,
  },
  uploadGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
    gap: 16,
    marginBottom: 24,
  },
  fileZone: {
    border: '2px dashed #cbd5e1',
    borderRadius: 12,
    padding: 16,
    background: '#f8fafc',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  fileLabel: {
    fontWeight: 600,
    fontSize: 15,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  fileHint: {
    fontSize: 11,
    color: '#94a3b8',
    fontFamily: 'monospace',
    lineHeight: 1.4,
  },
  uploadBtn: {
    background: '#3b82f6',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    padding: '8px 14px',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 500,
  },
  preview: {
    background: '#1e293b',
    color: '#94a3b8',
    borderRadius: 6,
    padding: 8,
    fontSize: 10,
    overflow: 'auto',
    maxHeight: 100,
    margin: 0,
    fontFamily: 'monospace',
  },
  optionalBadge: {
    fontSize: 10,
    background: '#e2e8f0',
    color: '#64748b',
    borderRadius: 4,
    padding: '2px 6px',
    marginLeft: 6,
  },
  orderBox: {
    background: '#f1f5f9',
    borderRadius: 10,
    padding: '12px 20px',
    marginBottom: 20,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    fontSize: 13,
    color: '#475569',
  },
  step: {
    background: '#fff',
    border: '1px solid #cbd5e1',
    borderRadius: 6,
    padding: '4px 10px',
    fontSize: 12,
  },
  arrow: {
    color: '#94a3b8',
    fontWeight: 700,
  },
  btn: {
    background: '#16a34a',
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    padding: '14px 32px',
    fontSize: 16,
    fontWeight: 600,
    cursor: 'pointer',
    marginBottom: 24,
    display: 'block',
  },
  statsRow: {
    display: 'flex',
    gap: 12,
    marginBottom: 16,
    flexWrap: 'wrap',
  },
  statBox: {
    border: '2px solid',
    borderRadius: 10,
    padding: '10px 20px',
    textAlign: 'center',
    minWidth: 80,
  },
  statValue: {
    fontSize: 28,
    fontWeight: 700,
  },
  statLabel: {
    fontSize: 12,
    color: '#64748b',
  },
  logBox: {
    background: '#0f172a',
    borderRadius: 12,
    padding: '16px 20px',
    maxHeight: 450,
    overflowY: 'auto',
    fontFamily: 'monospace',
    fontSize: 13,
    lineHeight: 1.8,
  },
  logLine: {
    display: 'block',
  },
  separator: {
    height: 1,
    background: '#1e293b',
    margin: '10px 0',
  },
  doneBox: {
    marginTop: 20,
    background: '#f0fdf4',
    border: '1px solid #86efac',
    borderRadius: 10,
    padding: '16px 24px',
    fontWeight: 600,
    color: '#15803d',
    fontSize: 16,
  },
};
