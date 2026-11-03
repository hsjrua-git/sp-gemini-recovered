// One source of truth for the public audit filter. Some UI categories are
// umbrellas over several action prefixes.
export const AUDIT_CATEGORY_PREFIXES = Object.freeze({
  student: ['student'],
  parameter: ['parameter'],
  teacher: ['teacher'],
  interval: ['interval'],
  assignment: ['assignment'],
  session: ['session'],
  task: ['task'],
  task_template: ['task_template'],
  alert: ['alert'],
  scores: ['scores', 'evaluation', 'period'],
  user: ['user'],
  role: ['role'],
  group: ['group', 'membership'],
  field: ['field', 'field_definition'],
  cafe_product: ['cafe_product'],
  cafe_supplier: ['cafe_supplier'],
  cafe_purchase: ['cafe_purchase'],
  cafe_sale: ['cafe_sale'],
  cafe_inventory: ['cafe_inventory', 'cafe_waste', 'cafe_adjustment'],
  cafe_balance: ['cafe_balance'],
  accounting: ['accounting', 'accounting_account', 'accounting_mapping', 'accounting_entry'],
  accounting_period: ['accounting_period'],
  agent: ['agent'],
  auth: ['auth'],
  api: ['api'],
});

export const AUDIT_CATEGORIES = Object.freeze(Object.keys(AUDIT_CATEGORY_PREFIXES));
