let sequence = 1000000000;
export function studentIdentity() {
  return { gender: 'female', birthDate: '2000-01-01', fatherName: 'Test Father', nationalId: String(++sequence) };
}
