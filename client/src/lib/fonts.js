export const PERSIAN_FONTS = [
  { id: 'vazirmatn', name: 'وزیرمتن', family: 'Vazirmatn' },
  { id: 'estedad', name: 'استعداد', family: 'Estedad' },
  { id: 'shabnam', name: 'شبنم', family: 'Shabnam' },
  { id: 'sahel', name: 'ساحل', family: 'Sahel' },
];
const KEY = 'studentPanelPersianFont';
export function applyPersianFont(id) {
  const font = PERSIAN_FONTS.find(item => item.id === id) ?? PERSIAN_FONTS[0];
  document.documentElement.dataset.persianFont = font.id;
  try { localStorage.setItem(KEY, font.id); } catch { /* optional boot draft */ }
}
export function applyRememberedFont() {
  let stored;
  try { stored = localStorage.getItem(KEY); } catch { /* optional boot draft */ }
  applyPersianFont(stored);
}
