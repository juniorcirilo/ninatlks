import { buildBrCode, crc16 } from './pix.util';

describe('pix', () => {
  it('crc16 CCITT-FALSE', () => {
    expect(crc16('123456789')).toBe('29B1');
  });

  it('monta BR Code estático com CRC consistente', () => {
    const code = buildBrCode({
      key: '123.456.789-09',
      type: 'cpf',
      name: 'José da Silva',
      amount: '150,00',
    });
    expect(code.startsWith('00020101021126')).toBe(true);
    expect(code).toContain('BR.GOV.BCB.PIX0111' + '12345678909');
    expect(code).toContain('5406150.00');
    expect(code).toContain('JOSE DA SILVA');
    expect(code.slice(-4)).toBe(crc16(code.slice(0, -4)));
  });
});
