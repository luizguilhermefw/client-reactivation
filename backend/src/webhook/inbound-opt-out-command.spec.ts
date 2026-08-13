import { normalizeInboundOptOutCommand } from './inbound-opt-out-command';

describe('normalizeInboundOptOutCommand', () => {
  it.each([
    ['PARAR', 'PARAR'],
    ['parar', 'PARAR'],
    [' PARAR ', 'PARAR'],
    ['SAIR', 'SAIR'],
    ['Cancelar', 'CANCELAR'],
  ])('normalizes exact command %p to %s', (input, expected) => {
    expect(normalizeInboundOptOutCommand(input)).toBe(expected);
  });

  it.each([
    'quero parar',
    'parar por favor',
    'cancelar pedido',
    'não quero mais',
    'sair daqui',
    'STOP',
    '',
    null,
  ])('rejects non-command input %p', (input) => {
    expect(normalizeInboundOptOutCommand(input)).toBeNull();
  });
});
