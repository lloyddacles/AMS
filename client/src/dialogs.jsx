import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import Modal from './components/Modal.jsx';

const DialogContext = createContext(null);

function DialogModal({ dialog, onResolve }) {
  if (!dialog) return null;
  const { type, title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', okLabel = 'OK', danger = false, details } = dialog;

  const footer = type === 'confirm' ? (
    <>
      <button type="button" className="btn" onClick={() => onResolve(false)}>{cancelLabel}</button>
      <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => onResolve(true)}>{confirmLabel}</button>
    </>
  ) : (
    <button type="button" className="btn btn-primary" onClick={() => onResolve(true)}>{okLabel}</button>
  );

  return (
    <Modal title={title || (type === 'confirm' ? 'Please confirm' : 'Notification')} onClose={() => onResolve(type !== 'confirm')} footer={footer}>
      {message && <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{message}</p>}
      {details ? <div className="muted small" style={{ marginTop: '0.6rem', whiteSpace: 'pre-wrap' }}>{details}</div> : null}
    </Modal>
  );
}

export function DialogProvider({ children }) {
  const [queue, setQueue] = useState([]);
  const active = queue[0] || null;
  const resolverRef = useRef(null);

  const enqueue = useCallback((dialog) => {
    return new Promise((resolve) => {
      setQueue((q) => [...q, { dialog, resolve }]);
    });
  }, []);

  // Keep resolver for current item in sync for rendering simplicity
  const handleResolve = useCallback((value) => {
    setQueue((q) => {
      const [head, ...rest] = q;
      if (head) head.resolve(value);
      return rest;
    });
  }, []);

  const confirm = useCallback((opts = {}) => enqueue({ type: 'confirm', ...opts }), [enqueue]);
  const notify = useCallback((opts = {}) => enqueue({ type: 'notify', ...opts }), [enqueue]);

  const value = useMemo(() => ({ confirm, notify }), [confirm, notify]);

  return (
    <DialogContext.Provider value={value}>
      {children}
      <DialogModal dialog={active?.dialog || null} onResolve={handleResolve} />
    </DialogContext.Provider>
  );
}

export function useDialog() {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useDialog must be used within DialogProvider');
  return ctx;
}
