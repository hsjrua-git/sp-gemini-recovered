import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { AuthContext } from '../auth/AuthContext.jsx';
import { setLanguage } from '../i18n/index.js';
import EvaluatePage from './EvaluatePage.jsx';

const mocks = vi.hoisted(() => ({
  assignments: vi.fn(), sessions: vi.fn(), members: vi.fn(), parameters: vi.fn(),
  evaluations: vi.fn(), save: vi.fn(),
}));
vi.mock('../api/schedule.js', () => ({ listAssignments: mocks.assignments }));
vi.mock('../api/sessions.js', () => ({ listSessions: mocks.sessions }));
vi.mock('../api/groups.js', () => ({ listGroupMembers: mocks.members, listGroups: async () => [] }));
vi.mock('../api/tasks.js', () => ({ listSessionTasks: async () => [], listTaskTargets: async () => ({ targets: [] }) }));
vi.mock('../api/parameters.js', () => ({ listParameters: mocks.parameters }));
vi.mock('../api/evaluations.js', () => ({ listEvaluations: mocks.evaluations, saveEvaluations: mocks.save }));

const student = { id: 'student', membershipId: 'membership', fullName: 'Test Student',
  studentCode: 'ABCD2345', joinedOn: '2020-01-01', leftOn: null };
const parameter = { id: 'parameter', name: 'Speed', minValue: 0, maxValue: 100 };
const clients = [];
beforeEach(() => {
  vi.resetAllMocks();
  setLanguage('en');
  mocks.parameters.mockResolvedValue([parameter]);
  mocks.sessions.mockResolvedValue({ sessions: [{ id: 'session', sessionDate: '2026-10-29' }] });
  mocks.members.mockResolvedValue([student]);
  mocks.evaluations.mockResolvedValue([]);
  mocks.save.mockResolvedValue({ changed: 1 });
});
afterEach(() => { for (const client of clients.splice(0)) client.clear(); });

function mount({ individual = false, blind = false, override = false, url = '/evaluate' } = {}) {
  mocks.assignments.mockResolvedValue([{ id: 'assignment', name: 'Test Assignment',
    groupId: individual ? null : 'group', groupName: 'Test Group',
    membershipId: individual ? student.membershipId : null,
    studentName: individual ? student.fullName : null }]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(client);
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[url]}>
    <AuthContext value={{ can: key => key === 'scores.enter' || (!blind && key === 'scores.view') || (override && key === 'scores.override') }}>
      <EvaluatePage />
    </AuthContext>
  </MemoryRouter></QueryClientProvider>);
  return client;
}

test.each([
  ['sighted group', {}], ['sighted individual', { individual: true }],
  ['blind group', { blind: true }], ['blind individual', { blind: true, individual: true }],
])('%s can select, enter and save a member score', async (_label, mode) => {
  mount(mode);
  fireEvent.click(await screen.findByRole('checkbox', { name: /Speed.*Test Student/ }));
  const quality = screen.getByRole('textbox', { name: /Quality.*Speed.*Test Student/ });
  expect(quality).toBeEnabled();
  fireEvent.change(quality, { target: { value: '77' } });
  fireEvent.click(screen.getByRole('button', { name: /Save 1/ }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  expect(mocks.save.mock.calls[0][0]).toMatchObject({ sessionId: 'session', entries: [
    { membershipId: 'membership', parameterId: 'parameter', selected: true, qualityValue: 77, quantityValue: null },
  ] });
  if (mode.blind) expect(mocks.evaluations).not.toHaveBeenCalled();
  if (mode.individual) expect(mocks.members).not.toHaveBeenCalled();
});

test.each(['parameters', 'members', 'evaluations', 'sessions'])('required %s loading and errors keep the grid unavailable', async (dependency) => {
  let reject;
  mocks[dependency].mockReturnValue(new Promise((_resolve, no) => { reject = no; }));
  const client = mount();
  await waitFor(() => expect(mocks[dependency]).toHaveBeenCalled());
  expect(screen.queryByRole('checkbox', { name: /Speed.*Test Student/ })).not.toBeInTheDocument();
  reject(new Error(`${dependency} unavailable`));
  expect(await screen.findByText(`${dependency} unavailable`)).toBeInTheDocument();
  await waitFor(() => expect(client.isFetching()).toBe(0));
  expect(screen.queryByRole('checkbox', { name: /Speed.*Test Student/ })).not.toBeInTheDocument();
});

test('an assignment without sessions has a settled empty state', async () => {
  mocks.sessions.mockResolvedValue({ sessions: [] });
  const client = mount({ individual: true, blind: true });
  await waitFor(() => expect(client.getQueryData(['sessions', { assignmentId: 'assignment' }])).toEqual({ sessions: [] }));
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
  expect(mocks.evaluations).not.toHaveBeenCalled();
  expect(mocks.members).not.toHaveBeenCalled();
});

test('locked edits require a written reason and discard clears it', async () => {
  mocks.evaluations.mockResolvedValue([{ membershipId: 'membership', parameterId: 'parameter',
    selected: true, qualityValue: 60, quantityValue: null, isLocked: true, locksAt: '2026-01-01T00:00:00Z' }]);
  mount({ individual: true, override: true });
  const quality = await screen.findByRole('textbox', { name: /Quality.*Speed.*Test Student/ });
  fireEvent.change(quality, { target: { value: '70' } });
  const save = screen.getByRole('button', { name: /Save 1/ });
  expect(save).toBeDisabled();
  const reason = screen.getByRole('textbox', { name: /reason for changing/ });
  fireEvent.change(reason, { target: { value: '   ok   ' } });
  expect(save).toBeDisabled();
  fireEvent.change(reason, { target: { value: '  Corrected source sheet  ' } });
  fireEvent.click(save);
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  expect(mocks.save.mock.calls[0][0].overrideReason).toBe('Corrected source sheet');
  await waitFor(() => expect(screen.queryByRole('textbox', { name: /reason for changing/ })).toBeNull());
  fireEvent.change(quality, { target: { value: '80' } });
  expect(screen.getByRole('textbox', { name: /reason for changing/ }).value).toBe('');
  fireEvent.click(screen.getByRole('button', { name: /Discard/ }));
  expect(screen.queryByRole('textbox', { name: /reason for changing/ })).toBeNull();
});

function hideSpeed() {
  const picker = screen.getByRole('group', { name: /Columns/ });
  fireEvent.click(picker.querySelector('summary'));
  fireEvent.click(within(picker).getByRole('checkbox', { name: 'Speed' }));
}

test.each([false, true])('hidden drafts are saved, including blind entry=%s', async blind => {
  mount({ individual: true, blind });
  fireEvent.click(await screen.findByRole('checkbox', { name: /Speed.*Test Student/ }));
  fireEvent.change(screen.getByRole('textbox', { name: /Quality.*Speed.*Test Student/ }), { target: { value: '77' } });
  hideSpeed();
  expect(screen.queryByRole('textbox', { name: /Quality.*Speed.*Test Student/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Save 1/ }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  expect(mocks.save.mock.calls[0][0].entries[0]).toMatchObject({ parameterId: 'parameter', qualityValue: 77 });
});

test('error navigation reveals a hidden column, focuses the invalid dimension, and works repeatedly', async () => {
  const scroll = vi.fn();
  const previous = HTMLElement.prototype.scrollIntoView;
  HTMLElement.prototype.scrollIntoView = scroll;
  try {
    mount({ individual: true });
    fireEvent.click(await screen.findByRole('checkbox', { name: /Speed.*Test Student/ }));
    fireEvent.change(screen.getByRole('textbox', { name: /Quantity.*Speed.*Test Student/ }), { target: { value: '101' } });
    hideSpeed();
    expect(screen.getByRole('button', { name: /Save 1/ })).toBeDisabled();
    const jump = screen.getByRole('button', { name: 'Go to the first error' });
    fireEvent.click(jump);
    const input = screen.getByRole('textbox', { name: /Quantity.*Speed.*Test Student/ });
    await waitFor(() => expect(input).toHaveFocus());
    expect(input).toHaveAttribute('aria-invalid', 'true');
    jump.focus();
    fireEvent.click(jump);
    await waitFor(() => expect(input).toHaveFocus());
    expect(scroll).toHaveBeenCalledTimes(2);
    fireEvent.change(input, { target: { value: '80' } });
    expect(screen.getByRole('button', { name: /Save 1/ })).toBeEnabled();
  } finally { HTMLElement.prototype.scrollIntoView = previous; }
});

test('a dashboard deep link selects its session instead of the default', async () => {
  mocks.sessions.mockResolvedValue({ sessions: [
    { id: 'session', sessionDate: '2026-10-29' },
    { id: 'linked', sessionDate: '2026-10-28' },
  ] });
  mount({ individual: true, url: '/evaluate?assignmentId=assignment&sessionId=linked' });
  fireEvent.click(await screen.findByRole('checkbox', { name: /Speed.*Test Student/ }));
  fireEvent.change(screen.getByRole('textbox', { name: /Quality.*Speed.*Test Student/ }), { target: { value: '70' } });
  fireEvent.click(screen.getByRole('button', { name: /Save 1/ }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  expect(mocks.save.mock.calls[0][0].sessionId).toBe('linked');
});
