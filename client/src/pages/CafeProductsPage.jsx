import { useState } from 'react';
import CreateSection from '../components/CreateSection.jsx';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  createCafeProduct,
  createCafeSupplier,
  deactivateCafeProduct,
  deactivateCafeSupplier,
  listCafeProducts,
  listCafeSuppliers,
  updateCafeProduct,
  updateCafeSupplier,
} from '../api/cafe.js';
import { useAuth } from '../auth/AuthContext.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { errorMessage } from '../i18n/errors.js';
import { toLatinDigits } from '../lib/locale.js';
import { formatWhole } from '../lib/money.js';

// Money is whole-number Toman (bigint on the server arrives as a string over
// JSON). Tables keep Latin digits with thousands separators — amounts are data,
// not UI chrome — and only the unit word is translated.

// A whole-number field (price, sort order): accepts Persian or Latin digits
// plus stray separators, and returns a non-negative integer or null.
function parseWholeNumber(text) {
  const normalized = toLatinDigits(text).replace(/[\s,٬]/g, '');
  return /^\d+$/.test(normalized) ? Number(normalized) : null;
}

// Products: an inline create form (and the same form embedded in the edited
// row), following the TeachersPage pattern. Price is a whole number of Toman.
function ProductForm({ product, onDone }) {
  const { t } = useTranslation(['cafe', 'common']);
  const queryClient = useQueryClient();
  const isEdit = product !== null;
  const [name, setName] = useState(product?.name ?? '');
  const [price, setPrice] = useState(product != null ? String(product.price) : '');
  const [sortOrder, setSortOrder] = useState(
    product?.sortOrder != null ? String(product.sortOrder) : ''
  );
  const [fieldError, setFieldError] = useState('');

  const save = useMutation({
    mutationFn: (body) =>
      isEdit ? updateCafeProduct(product.id, body) : createCafeProduct(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cafe-products'] });
      if (isEdit) onDone();
      else {
        setName('');
        setPrice('');
        setSortOrder('');
      }
    },
  });

  function handleSubmit(event) {
    event.preventDefault();
    const parsedPrice = parseWholeNumber(price);
    if (parsedPrice === null) {
      setFieldError(t('products.invalidPrice'));
      return;
    }
    let parsedSort;
    if (sortOrder.trim() !== '') {
      parsedSort = parseWholeNumber(sortOrder);
      if (parsedSort === null) {
        setFieldError(t('products.invalidSortOrder'));
        return;
      }
    }
    setFieldError('');
    save.mutate({
      name,
      price: parsedPrice,
      ...(parsedSort !== undefined && { sortOrder: parsedSort }),
    });
  }

  const suffix = isEdit ? `-${product.id}` : '';
  return (
    <form onSubmit={handleSubmit} className="edit-form">
      <label htmlFor={`cafe-product-name${suffix}`}>{t('products.name')}</label>
      <input
        id={`cafe-product-name${suffix}`}
        value={name}
        onChange={(event) => setName(event.target.value)}
        maxLength={80}
        autoComplete="off"
        disabled={save.isPending}
      />

      <label htmlFor={`cafe-product-price${suffix}`}>
        {t('products.price', { unit: t('money.unit') })}
      </label>
      <input
        id={`cafe-product-price${suffix}`}
        value={price}
        onChange={(event) => setPrice(event.target.value)}
        inputMode="numeric"
        placeholder={t('products.pricePlaceholder')}
        autoComplete="off"
        disabled={save.isPending}
      />

      <label htmlFor={`cafe-product-sort${suffix}`}>{t('products.sortOrder')}</label>
      <input
        id={`cafe-product-sort${suffix}`}
        value={sortOrder}
        onChange={(event) => setSortOrder(event.target.value)}
        inputMode="numeric"
        placeholder={t('products.sortOrderPlaceholder')}
        autoComplete="off"
        disabled={save.isPending}
      />

      <div className="row">
        <button type="submit" disabled={save.isPending}>
          {save.isPending
            ? t('common:actions.saving')
            : isEdit
              ? t('products.saveEdit')
              : t('products.addSubmit')}
        </button>
        {isEdit && (
          <button type="button" onClick={onDone} disabled={save.isPending}>
            {t('common:actions.cancel')}
          </button>
        )}
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
      {save.isSuccess && !isEdit && (
        <p className="success" role="status">
          {t('products.added', { name: save.data.product.name })}
        </p>
      )}
    </form>
  );
}

// Suppliers: free-text fields only; an empty phone/note is cleared to null
// server-side.
function SupplierForm({ supplier, onDone }) {
  const { t } = useTranslation(['cafe', 'common']);
  const queryClient = useQueryClient();
  const isEdit = supplier !== null;
  const [name, setName] = useState(supplier?.name ?? '');
  const [phone, setPhone] = useState(supplier?.phone ?? '');
  const [note, setNote] = useState(supplier?.note ?? '');

  const save = useMutation({
    mutationFn: (body) =>
      isEdit ? updateCafeSupplier(supplier.id, body) : createCafeSupplier(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cafe-suppliers'] });
      if (isEdit) onDone();
      else {
        setName('');
        setPhone('');
        setNote('');
      }
    },
  });

  function handleSubmit(event) {
    event.preventDefault();
    save.mutate({ name, phone, note });
  }

  const suffix = isEdit ? `-${supplier.id}` : '';
  return (
    <form onSubmit={handleSubmit} className="edit-form">
      <label htmlFor={`cafe-supplier-name${suffix}`}>{t('suppliers.name')}</label>
      <input
        id={`cafe-supplier-name${suffix}`}
        value={name}
        onChange={(event) => setName(event.target.value)}
        maxLength={80}
        autoComplete="off"
        disabled={save.isPending}
      />

      <label htmlFor={`cafe-supplier-phone${suffix}`}>{t('suppliers.phone')}</label>
      <input
        id={`cafe-supplier-phone${suffix}`}
        value={phone}
        onChange={(event) => setPhone(event.target.value)}
        maxLength={30}
        inputMode="tel"
        autoComplete="off"
        disabled={save.isPending}
      />

      <label htmlFor={`cafe-supplier-note${suffix}`}>{t('suppliers.note')}</label>
      <input
        id={`cafe-supplier-note${suffix}`}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        maxLength={500}
        autoComplete="off"
        disabled={save.isPending}
      />

      <div className="row">
        <button type="submit" disabled={save.isPending}>
          {save.isPending
            ? t('common:actions.saving')
            : isEdit
              ? t('suppliers.saveEdit')
              : t('suppliers.addSubmit')}
        </button>
        {isEdit && (
          <button type="button" onClick={onDone} disabled={save.isPending}>
            {t('common:actions.cancel')}
          </button>
        )}
      </div>
      {save.isError && (
        <p className="error" role="alert">
          {errorMessage(save.error)}
        </p>
      )}
      {save.isSuccess && !isEdit && (
        <p className="success" role="status">
          {t('suppliers.added', { name: save.data.supplier.name })}
        </p>
      )}
    </form>
  );
}

function CafeProductsPage() {
  const { t } = useTranslation(['cafe', 'common']);
  const { can } = useAuth();
  const queryClient = useQueryClient();
  // One shared toggle for both sections: the lists are short, so a single
  // "include inactive" is simpler than per-section state.
  const [includeInactive, setIncludeInactive] = useState(false);
  const [editingProductId, setEditingProductId] = useState(null);
  const [editingSupplierId, setEditingSupplierId] = useState(null);

  const canManageProducts = can('cafe.manage');
  const canSupplies = can('cafe.supplies');

  const productsQuery = useQuery({
    queryKey: ['cafe-products', { includeInactive }],
    queryFn: () => listCafeProducts({ includeInactive }),
  });
  const suppliersQuery = useQuery({
    queryKey: ['cafe-suppliers', { includeInactive }],
    queryFn: () => listCafeSuppliers({ includeInactive }),
    enabled: canSupplies,
  });

  const invalidateProducts = () =>
    queryClient.invalidateQueries({ queryKey: ['cafe-products'] });
  const deactivateProduct = useMutation({
    mutationFn: deactivateCafeProduct,
    onSuccess: invalidateProducts,
  });
  const reactivateProduct = useMutation({
    mutationFn: (id) => updateCafeProduct(id, { isActive: true }),
    onSuccess: invalidateProducts,
  });
  const productChange = deactivateProduct.isPending || reactivateProduct.isPending;

  const invalidateSuppliers = () =>
    queryClient.invalidateQueries({ queryKey: ['cafe-suppliers'] });
  const deactivateSupplier = useMutation({
    mutationFn: deactivateCafeSupplier,
    onSuccess: invalidateSuppliers,
  });
  const reactivateSupplier = useMutation({
    mutationFn: (id) => updateCafeSupplier(id, { isActive: true }),
    onSuccess: invalidateSuppliers,
  });
  const supplierChange = deactivateSupplier.isPending || reactivateSupplier.isPending;

  return (
    <main className="wide">
      <div className="page-head">
        <div>
          <h1>{t('title')}</h1>
          <p className="hint">{t('hint')}</p>
        </div>
        <div className="page-head-actions">
          <label className="hint">
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(event) => setIncludeInactive(event.target.checked)}
            />
            {t('includeInactive')}
          </label>
        </div>
      </div>

      <section className="section-card">
        <h2>{t('products.title')}</h2>

        {canManageProducts && editingProductId === null && (
          <CreateSection title={t('products.addSubmit')}>
            <ProductForm product={null} onDone={() => {}} />
          </CreateSection>
        )}

        {productsQuery.isPending && (
          <p className="hint">{t('common:status.loading')}</p>
        )}
        {productsQuery.isError && (
          <p className="error" role="alert">
            {errorMessage(productsQuery.error)}
          </p>
        )}
        {productsQuery.data?.length === 0 && (
          <EmptyState
            title={t('products.emptyTitle')}
            description={t('products.emptyDescription')}
          />
        )}

        {productsQuery.data && productsQuery.data.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
              <tr>
                <th scope="col">{t('common:table.name')}</th>
                <th scope="col">{t('products.colPrice')}</th>
                <th scope="col">{t('products.colAvgCost')}</th>
                <th scope="col">{t('products.colStatus')}</th>
                {canManageProducts && (
                  <th scope="col">{t('common:table.actions')}</th>
                )}
              </tr>
            </thead>
            <tbody>
              {productsQuery.data.map((product) =>
                editingProductId === product.id ? (
                  <tr key={product.id}>
                    <td colSpan={canManageProducts ? 5 : 4}>
                      <ProductForm
                        product={product}
                        onDone={() => setEditingProductId(null)}
                      />
                    </td>
                  </tr>
                ) : (
                  <tr
                    key={product.id}
                    className={product.isActive ? undefined : 'stale'}
                  >
                    <th scope="row">{product.name}</th>
                    <td>
                      {formatWhole(product.price)}{' '}
                      <span className="hint">{t('money.unit')}</span>
                    </td>
                    <td>
                      {Number(product.avgCost) > 0 ? (
                        <>
                          {formatWhole(product.avgCost)}{' '}
                          <span className="hint">{t('money.unit')}</span>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>{t(product.isActive ? 'status.active' : 'status.inactive')}</td>
                    {canManageProducts && (
                      <td className="actions">
                        {product.isActive ? (
                          <>
                            <button
                              type="button"
                              className="quiet"
                              disabled={productChange}
                              onClick={() => setEditingProductId(product.id)}
                            >
                              {t('common:actions.edit')}
                            </button>{' '}
                            <button
                              type="button"
                              className="danger"
                              disabled={productChange}
                              onClick={() => deactivateProduct.mutate(product.id)}
                            >
                              {t('actions.deactivate')}
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="quiet"
                            disabled={productChange}
                            onClick={() => reactivateProduct.mutate(product.id)}
                          >
                            {t('actions.reactivate')}
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ),
              )}
            </tbody>
          </table>
          </div>
        )}
        {(deactivateProduct.isError || reactivateProduct.isError) && (
          <p className="error" role="alert">
            {errorMessage(
              deactivateProduct.error ?? reactivateProduct.error
            )}
          </p>
        )}
      </section>

      {canSupplies && (
        <section className="section-card">
          <h2>{t('suppliers.title')}</h2>

          {editingSupplierId === null && (
            <CreateSection title={t('suppliers.addSubmit')}>
              <SupplierForm supplier={null} onDone={() => {}} />
            </CreateSection>
          )}

          {suppliersQuery.isPending && (
            <p className="hint">{t('common:status.loading')}</p>
          )}
          {suppliersQuery.isError && (
            <p className="error" role="alert">
              {errorMessage(suppliersQuery.error)}
            </p>
          )}
          {suppliersQuery.data?.length === 0 && (
            <EmptyState
              title={t('suppliers.emptyTitle')}
              description={t('suppliers.emptyDescription')}
            />
          )}

          {suppliersQuery.data && suppliersQuery.data.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                <tr>
                  <th scope="col">{t('common:table.name')}</th>
                  <th scope="col">{t('suppliers.colPhone')}</th>
                  <th scope="col">{t('common:table.note')}</th>
                  <th scope="col">{t('suppliers.colStatus')}</th>
                  <th scope="col">{t('common:table.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {suppliersQuery.data.map((supplier) =>
                  editingSupplierId === supplier.id ? (
                    <tr key={supplier.id}>
                      <td colSpan={5}>
                        <SupplierForm
                          supplier={supplier}
                          onDone={() => setEditingSupplierId(null)}
                        />
                      </td>
                    </tr>
                  ) : (
                    <tr
                      key={supplier.id}
                      className={supplier.isActive ? undefined : 'stale'}
                    >
                      <th scope="row">{supplier.name}</th>
                      <td>{supplier.phone || '—'}</td>
                      <td>{supplier.note || '—'}</td>
                      <td>
                        {t(supplier.isActive ? 'status.active' : 'status.inactive')}
                      </td>
                      <td className="actions">
                        {supplier.isActive ? (
                          <>
                            <button
                              type="button"
                              className="quiet"
                              disabled={supplierChange}
                              onClick={() => setEditingSupplierId(supplier.id)}
                            >
                              {t('common:actions.edit')}
                            </button>{' '}
                            <button
                              type="button"
                              className="danger"
                              disabled={supplierChange}
                              onClick={() =>
                                deactivateSupplier.mutate(supplier.id)
                              }
                            >
                              {t('actions.deactivate')}
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="quiet"
                            disabled={supplierChange}
                            onClick={() => reactivateSupplier.mutate(supplier.id)}
                          >
                            {t('actions.reactivate')}
                          </button>
                        )}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
            </div>
          )}
          {(deactivateSupplier.isError || reactivateSupplier.isError) && (
            <p className="error" role="alert">
              {errorMessage(
                deactivateSupplier.error ?? reactivateSupplier.error
              )}
            </p>
          )}
        </section>
      )}
    </main>
  );
}

export default CafeProductsPage;
