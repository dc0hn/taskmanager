import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, ClipboardCopy, Download, Upload, X } from 'lucide-react';
import { exportAll, importAll } from '../storage';

// ============================================================================
// BackupModal — the escape hatch.
//
// Every plan, streak and week of history lives in one WebKit-managed SQLite file
// with no cloud copy and no undo beyond the app. This produces a single
// self-contained JSON document of it, and takes one back.
//
// Deliberately clipboard-and-textarea rather than a file picker: a download in
// Tauri's WKWebView is unreliable and a native file dialog would mean a new Tauri
// plugin, a capability entry and a permission prompt. Copy-and-paste needs none
// of that and cannot fail silently — which matters most for the feature whose
// whole job is to work on the worst day you have.
// ============================================================================

interface Props {
  open: boolean;
  today: string;
  onClose: () => void;
  onNotify: (message: string) => void;
}

export default function BackupModal({ open, today, onClose, onNotify }: Props) {
  const [tab, setTab] = useState<'export' | 'import'>('export');
  const [paste, setPaste] = useState('');
  const [replace, setReplace] = useState(false);
  const [copied, setCopied] = useState(false);

  const json = useMemo(
    () => (open ? JSON.stringify(exportAll(today), null, 2) : ''),
    [open, today]
  );

  const stats = useMemo(() => {
    if (!open) return { records: 0, bytes: 0 };
    const doc = exportAll(today);
    return {
      records: Object.keys(doc.records).length,
      bytes: JSON.stringify(doc).length,
    };
  }, [open, today]);

  useEffect(() => {
    if (!open) {
      setPaste('');
      setCopied(false);
      setTab('export');
      setReplace(false);
    }
  }, [open]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    if (open) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      // Clipboard permission can be refused; say so instead of appearing to work.
      onNotify(
        'Copying to the clipboard was blocked. Select the text in the box and copy it manually.'
      );
    }
  }

  function runImport() {
    if (!paste.trim()) {
      onNotify('Paste an Almanac export into the box first.');
      return;
    }
    const result = importAll(paste, replace);
    onNotify(result.message);
    if (result.ok) onClose();
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14 }}
        >
          <motion.div
            className="absolute inset-0"
            style={{
              background: 'rgba(8, 8, 7, 0.70)',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
            }}
            onClick={onClose}
          />
          <motion.div
            initial={{ y: 12, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 8, opacity: 0, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            className="relative raised rounded-xl6 w-full max-w-2xl p-5 shadow-lift"
          >
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="smallcaps text-[9.5px] text-bone-3 mb-1">Your data</p>
                <h3 className="text-[17px] font-semibold text-ink-0">
                  Backup &amp; restore
                </h3>
              </div>
              <button
                onClick={onClose}
                aria-label="Close"
                className="grid place-items-center w-7 h-7 rounded-lg text-ink-3 hover:text-ink-0 hover:bg-paper-4 transition-colors"
              >
                <X size={15} strokeWidth={2} />
              </button>
            </div>
            <div className="rule-h mb-4" />

            <div className="segmented mb-3.5">
              <button
                data-active={tab === 'export'}
                onClick={() => setTab('export')}
                className="segmented-item"
              >
                Export
              </button>
              <button
                data-active={tab === 'import'}
                onClick={() => setTab('import')}
                className="segmented-item"
              >
                Import
              </button>
            </div>

            {tab === 'export' ? (
              <>
                <p className="text-[12px] text-ink-3 mb-2.5 leading-relaxed max-w-[70ch]">
                  Everything Almanac knows, as one JSON document — plans, weekly goals,
                  the carryover pile, routines, streaks and categories. Copy it somewhere
                  safe. There is no other copy.
                </p>
                <textarea
                  readOnly
                  value={json}
                  onClick={(e) => e.currentTarget.select()}
                  spellCheck={false}
                  className="input w-full h-56 font-mono text-[10.5px] leading-relaxed px-2.5 py-2 resize-none thin-scroll focus:outline-none"
                />
                <div className="flex items-center justify-between mt-3 gap-3 flex-wrap">
                  <span className="font-mono text-[10.5px] text-bone-3 tnum">
                    {stats.records} records · {(stats.bytes / 1024).toFixed(1)} KB
                  </span>
                  <button
                    onClick={copy}
                    className="btn-primary inline-flex items-center gap-1.5 text-[12.5px] font-semibold px-3.5 py-2 rounded-lg"
                  >
                    {copied ? (
                      <>
                        <Check size={13} strokeWidth={2.6} />
                        Copied
                      </>
                    ) : (
                      <>
                        <ClipboardCopy size={13} strokeWidth={2.2} />
                        Copy all
                      </>
                    )}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-[12px] text-ink-3 mb-2.5 leading-relaxed max-w-[70ch]">
                  Paste a previously exported document. Records go back through the same
                  validation as a normal read, so a truncated or hand-edited file restores
                  whatever was salvageable rather than breaking the app.
                </p>
                <textarea
                  value={paste}
                  onChange={(e) => setPaste(e.target.value)}
                  placeholder='{ "format": "almanac.export", ... }'
                  spellCheck={false}
                  className="input w-full h-48 font-mono text-[10.5px] leading-relaxed px-2.5 py-2 resize-none thin-scroll focus:outline-none"
                />
                <label className="flex items-start gap-2 mt-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={replace}
                    onChange={(e) => setReplace(e.target.checked)}
                    className="mt-[3px]"
                  />
                  <span className="text-[12px] text-ink-2 leading-snug">
                    Replace everything currently here.
                    <span className="text-bone-3">
                      {' '}
                      Leave this off to merge — imported records overwrite matching days
                      and weeks, and anything not in the file is left alone.
                    </span>
                  </span>
                </label>
                {replace && (
                  <p className="text-[11.5px] text-bad mt-2 leading-snug">
                    This deletes every Almanac record on this machine first. Export a copy
                    before you do it.
                  </p>
                )}
                <div className="flex items-center justify-end mt-3.5 gap-2">
                  <button
                    onClick={onClose}
                    className="text-[12px] font-medium text-ink-3 hover:text-ink-0 px-3 py-2 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={runImport}
                    className="btn-primary inline-flex items-center gap-1.5 text-[12.5px] font-semibold px-3.5 py-2 rounded-lg"
                  >
                    <Upload size={13} strokeWidth={2.2} />
                    Import
                  </button>
                </div>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Small nav-rail affordance that opens the modal. */
export function BackupButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-ink-2 hover:text-ink-0 hover:bg-paper-3 transition-colors w-full"
    >
      <Download size={14} strokeWidth={1.8} className="shrink-0" />
      <span className="text-[12px]">Backup &amp; restore</span>
    </button>
  );
}
