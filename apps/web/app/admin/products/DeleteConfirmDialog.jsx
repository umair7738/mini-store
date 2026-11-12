export default function DeleteConfirmDialog({ product, onCancel, onConfirm, busy = false }) {
  if (!product) return null;
  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-title">
        <h2 id="delete-title">Archive product?</h2>
        <p>This will remove <strong>{product.name}</strong> from the storefront while preserving order history.</p>
        <div className="button-row"><button className="button secondary" type="button" onClick={onCancel} disabled={busy}>Cancel</button><button className="button danger" type="button" onClick={onConfirm} disabled={busy}>{busy ? "Archiving…" : "Archive product"}</button></div>
      </section>
    </div>
  );
}
