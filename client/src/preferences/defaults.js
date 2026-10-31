export const DEFAULT_PREFERENCES = {
  theme: 'dark',
  palette: 'aurora',
  language: 'fa',
  persianFont: 'vazirmatn',
  customCursor: true,
  studentsPageSize: 25,
  studentsSort: 'newest',
  studentsShowCode: true,
  studentsShowAdded: true,
  studentDefaultTab: 'overview',
  studentShowAllPeriods: false,
  hiddenParameterIds: [],
  csvDelimiter: ',',
  reportScope: { groupIds: [], assignmentIds: [], periodIds: [], dimensions: ['quality'] },
  // The dashboard hero/constellation customization (schema-4): which dimension
  // feeds the values, what counts as "answered", and which assignment period
  // the class field shows (null = the assignment's latest period).
  dashboardConstellation: {
    dimension: 'quality',
    basis: 'value',
    assignmentId: null,
    seq: null,
    groupId: null,
    mode: 'auto',
    autoRotate: true,
    parameterIds: null, // null = all; [] = deliberately show none
  },
};
