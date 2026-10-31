import { useState } from 'react';
import CreateSection from '../components/CreateSection.jsx';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { listCafeProducts, listCafeSuppliers } from '../api/cafe.js';
import { listCafePurchases, recordPurchase } from '../api/cafePurchases.js';
import EmptyState from '../components/EmptyState.jsx';
import JalaliDatePicker from '../components/JalaliDatePicker.jsx';
import { errorMessage } from '../i18n/errors.js';
import { formatIsoDate, toIsoDate } from '../lib/format.js';
import { formatAmount, parseQuantity, parseWholeNumber } from '../lib/money.js';
import { invalidateAccounting } from '../lib/accountingCache.js';

// Money is whole-number Toman (bigint on the server arrives as a string over
// JSON), but a live line total is qty × unit cost and qty carries up to three
// decimals — so amounts format exactly, without forcing a whole number.
// Like the other cafe tables, amounts keep Latin digits with thousands
// separators (data, not UI chrome); only the unit word is translated.

function emptyLine() {
  return { productId: '', qty: '', unitCost: '' };
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function isLineBlank(line) {
  return (
    line.productId === '' && line.qty.trim() === '' && line.unitCost.trim() === ''
  );
}

// The item cell shows the first few lines and hides the rest behind a title
// tooltip with the full list — long deliveries stay scannable.
const SHOWN_ITEMS = 2;
function itemText(item) {
  return `${formatAmount(item.qty)} × ${item.productName}`;
}
function itemsSummary(items, t) {
  const shown = items.slice(0, SHOWN_ITEMS).map(itemText).join(', ');
  const rest = items.length - SHOWN_ITEMS;
  return rest > 0 ? `${shown} ${t('list.moreItems', { more: rest })}` : shown;
}
function itemsTitle(items) {
  return items.map(itemText).join('; ');
}

// The record form: supplier + optional note/date + dynamic item lines with
// live totals. Mirrors the server's purchase validation (whole-Toman unit
// cost, 3-decimal quantities, one line per product) so most mistakes are
// caught before the round trip.
function PurchaseForm({ products, suppliers, loading }) {
  const { t } = useTranslation(['purchases', 'common']);
  const queryClient = useQueryClient();
  const [supplierId, setSupplierId] = useState('');
  const [note, setNote] = useState('');
  // '' means "today" — the server defaults purchased_at to current_date.
  const [purchasedAt, setPurchasedAt] = useState('');
  const [lines, setLines] = useState([emptyLine()]);
  const [fieldError, setFieldError] = useState('');

  const parsedLines = lines.map((line) => ({
    ...line,
    qtyValue: parseQuantity(line.qty),
    costValue: parseWholeNumber(line.unitCost),
  }));
  const lineTotals = parsedLines.map((line) =>
    line.qtyValue !== null && line.costValue !== null
      ? line.qtyValue * line.costValue
      : null
  );
  const grandTotal = lineTotals.reduce(
    (sum, value) => (value === null ? sum : sum + value),
    0
  );

  const save = useMutation({
    mutationFn: recordPurchase,
    onSuccess: () => {
      // A purchase moves stock and the product's moving-average cost.
      queryClient.invalidateQueries({ queryKey: ['cafe-purchases'] });
      queryClient.invalidateQueries({ queryKey: ['cafe-products'] });
      queryClient.invalidateQueries({ queryKey: ['cafe-inventory'] });
      queryClient.invalidateQueries({ queryKey: ['cafe-reports'] });
      invalidateAccounting(queryClient);
      setSupplierId('');
      setNote('');
      setPurchasedAt('');
      setLines([emptyLine()]);
    },
  });

  function setLine(index, patch) {
    setLines((current) =>
      current.map((line, i) => (i === index ? { ...line, ...patch } : line))
    );
  }

  function handleSubmit(event) {
    event.preventDefault();
    const filled = parsedLines.filter((line) => !isLineBlank(line));
    let problem = '';
    if (supplierId === '') {
      problem = t('form.chooseSupplier');
    } else if (filled.length === 0) {
      problem = t('form.needOneItem');
    } else {
      for (const line of filled) {
        if (line.productId === '') {
          problem = t('form.chooseProduct');
          break;
        }
        if (line.qtyValue === null) {
          problem = t('form.invalidQty');
          break;
        }
        if (line.costValue === null) {
          problem = t('form.invalidUnitCost');
          break;
        }
      }
      if (!problem) {
        const ids = filled.map((line) => line.productId);
        if (new Set(ids).size !== ids.length) {
          problem = t('form.duplicateProduct');
        }
      }
    }
    if (problem) {
      save.reset();
      setFieldError(problem);
      return;
    }
    setFieldError('');
    save.mutate({
      supplierId,
      note,
      purchasedAt,
      items: filled.map((line) => ({
        productId: line.productId,
        qty: line.qtyValue,
        unitCost: line.costValue,
      })),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="edit-form">
      <label htmlFor="purchase-supplier">{t('form.supplier')}</label>
      <select
        id="purchase-supplier"
        value={supplierId}
        onChange={(event) => setSupplierId(event.target.value)}
        disabled={loading || save.isPending}
      >
        <option value="">{t('form.supplierPlaceholder')}</option>
        {suppliers.map((supplier) => (
          <option key={supplier.id} value={supplier.id}>
            {supplier.name}
          </option>
        ))}
      </select>
      {!loading && suppliers.length === 0 && (
        <p className="hint">
          {t('form.noSuppliers')}{' '}
          <Link to="/cafe/products">{t('form.noSuppliersLink')}</Link>
        </p>
      )}

      <label htmlFor="purchase-note">{t('form.note')}</label>
      <input
        id="purchase-note"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        maxLength={500}
        autoComplete="off"
        disabled={save.isPending}
      />

      <label htmlFor="purchased-at">{t('form.purchasedAt')}</label>
      <JalaliDatePicker
        id="purchased-at"
        value={purchasedAt}
        onChange={setPurchasedAt}
        disabled={save.isPending}
      />

      <p className="group-title">{t('form.items')}</p>
      {!loading && products.length === 0 && (
        <p className="hint">
          {t('form.noProducts')}{' '}
          <Link to="/cafe/products">{t('form.noProductsLink')}</Link>
        </p>
      )}
      {parsedLines.map((line, index) => (
        <div className="filter-row" key={index}>
          <select
            aria-label={`${t('form.product')} ${index + 1}`}
            value={line.productId}
            onChange={(event) =>
              setLine(index, { productId: event.target.value })
            }
            disabled={loading || save.isPending}
          >
            <option value="">{t('form.productPlaceholder')}</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>
          <input
            aria-label={`${t('form.qty')} ${index + 1}`}
            value={line.qty}
            onChange={(event) => setLine(index, { qty: event.target.value })}
            inputMode="decimal"
            placeholder={t('form.qtyPlaceholder')}
            autoComplete="off"
            disabled={save.isPending}
          />
          <input
            aria-label={`${t('form.unitCost', { unit: t('money.unit') })} ${index + 1}`}
            value={line.unitCost}
            onChange={(event) => setLine(index, { unitCost: event.target.value })}
            inputMode="numeric"
            placeholder={t('form.unitCostPlaceholder')}
            autoComplete="off"
            disabled={save.isPending}
          />
          <span className="hint" aria-label={t('form.lineTotal')}>
            {lineTotals[index] === null
              ? '—'
              : `${formatAmount(lineTotals[index])} ${t('money.unit')}`}
          </span>
          <button
            type="button"
            className="quiet"
            onClick={() =>
              setLines((current) => current.filter((_, i) => i !== index))
            }
            disabled={save.isPending}
          >
            {t('form.removeItem')}
          </button>
        </div>
      ))}
      <div className="row">
        <button
          type="button"
          onClick={() => setLines((current) => [...current, emptyLine()])}
          disabled={save.isPending}
        >
          {t('form.addItem')}
        </button>
        <span className="hint">
          {t('form.grandTotal', {
            total: formatAmount(grandTotal),
            unit: t('money.unit'),
          })}
        </span>
      </div>

      <div className="row">
        <button type="submit" disabled={save.isPending || loading}>
          {save.isPending ? t('common:actions.saving') : t('form.submit')}
        </button>
      </div>
      {fieldError && (
        <p className="error" role="alert">
          {fieldError}
        </p>
      )}
      {save.isError && (
        <p className="error" role="alert">
          {errorMessage(save.error)}
        </p>
      )}
      {save.isSuccess && (
        <p className="success" role="status">
          {t('form.recorded', {
            supplier: save.data.purchase.supplierName,
            total: formatAmount(save.data.purchase.total),
            unit: t('money.unit'),
          })}
        </p>
      )}
    </form>
  );
}

function CafePurchasesPage() {
  const { t } = useTranslation(['purchases', 'common']);
  const today = new Date();

  // Purchases land on any past day, so the list opens on the last month.
  const [from, setFrom] = useState(toIsoDate(addDays(today, -30)));
  const [to, setTo] = useState(toIsoDate(today));
  const [supplierId, setSupplierId] = useState('');

  // Same keys as the products page, so its invalidations (and ours) keep
  // both pages in step.
  const suppliersQuery = useQuery({
    queryKey: ['cafe-suppliers', { includeInactive: false }],
    queryFn: () => listCafeSuppliers({}),
  });
  const productsQuery = useQuery({
    queryKey: ['cafe-products', { includeInactive: false }],
    queryFn: () => listCafeProducts({}),
  });
  const purchasesQuery = useQuery({
    queryKey: ['cafe-purchases', { from, to, supplierId }],
    queryFn: () =>
      listCafePurchases({ from, to, supplierId: supplierId || null }),
  });

  const suppliers = suppliersQuery.data ?? [];
  const products = productsQuery.data ?? [];
  const purchases = purchasesQuery.data?.purchases ?? [];

  return (
    <main className="wide">
      <div className="page-head">
        <div>
          <h1>{t('title')}</h1>
          <p className="hint">{t('hint')}</p>
        </div>
      </div>

      <CreateSection title={t('form.title')}>
        {suppliersQuery.isError || productsQuery.isError ? (
          <p className="error" role="alert">
            {errorMessage(suppliersQuery.error ?? productsQuery.error)}
          </p>
        ) : (
          <PurchaseForm
            products={products}
            suppliers={suppliers}
            loading={suppliersQuery.isPending || productsQuery.isPending}
          />
        )}
      </CreateSection>

      <section className="section-card">
        <h2>{t('list.title')}</h2>
        <div className="toolbar">
          <label htmlFor="purchases-from">{t('list.from')}</label>
          <JalaliDatePicker id="purchases-from" value={from} onChange={setFrom} />
          <label htmlFor="purchases-to">{t('list.to')}</label>
          <JalaliDatePicker id="purchases-to" value={to} onChange={setTo} />
          <select
            aria-label={t('list.filterSupplier')}
            value={supplierId}
            onChange={(event) => setSupplierId(event.target.value)}
          >
            <option value="">{t('list.allSuppliers')}</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </select>
        </div>

        {purchasesQuery.isPending && (
          <p className="hint">{t('common:status.loading')}</p>
        )}
        {purchasesQuery.isError && (
          <p className="error" role="alert">
            {errorMessage(purchasesQuery.error)}
          </p>
        )}
        {purchasesQuery.data?.truncated && (
          <p className="hint">{t('list.truncated')}</p>
        )}
        {purchases.length === 0 &&
          !purchasesQuery.isPending &&
          !purchasesQuery.isError && (
            <EmptyState
              title={t('list.emptyTitle')}
              description={t('list.emptyDescription')}
            />
          )}

        {purchases.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">{t('common:table.date')}</th>
                  <th scope="col">{t('list.colSupplier')}</th>
                  <th scope="col">{t('list.colItems')}</th>
                  <th scope="col">{t('list.colTotal')}</th>
                  <th scope="col">{t('common:table.note')}</th>
                </tr>
              </thead>
              <tbody>
                {purchases.map((purchase) => (
                  <tr key={purchase.id}>
                    <td>{formatIsoDate(purchase.purchasedAt)}</td>
                    <th scope="row">{purchase.supplierName}</th>
                    <td title={itemsTitle(purchase.items)}>
                      {t('list.itemCount', { lines: purchase.items.length })} ·{' '}
                      {itemsSummary(purchase.items, t)}
                    </td>
                    <td>
                      {formatAmount(purchase.total)}{' '}
                      <span className="hint">{t('money.unit')}</span>
                    </td>
                    <td>{purchase.note || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

export default CafePurchasesPage;
