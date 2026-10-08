import {
  extractTarget,
  toPnJid,
  contactIdentifierFor,
  digitsOf,
  isGroupJid,
  isLidJid,
  isPnJid,
  normalizeJid,
  phoneOf,
} from './jid.util';

describe('jid.util', () => {
  it('remove o sufixo de dispositivo', () => {
    expect(normalizeJid('5511999999999:12@s.whatsapp.net')).toBe(
      '5511999999999@s.whatsapp.net',
    );
  });

  it('distingue telefone, LID e grupo', () => {
    expect(isPnJid('5511999999999@s.whatsapp.net')).toBe(true);
    expect(isLidJid('123456789012345@lid')).toBe(true);
    expect(isLidJid('5511999999999@s.whatsapp.net')).toBe(false);
    expect(isGroupJid('120363000000000000@g.us')).toBe(true);
  });

  it('só devolve telefone para JID de telefone', () => {
    expect(phoneOf('5511999999999@s.whatsapp.net')).toBe('5511999999999');
    expect(phoneOf('123456789012345@lid')).toBeNull();
    expect(digitsOf('5511999999999:3@s.whatsapp.net')).toBe('5511999999999');
  });

  it('mantém o identificador de contato compatível com os dados existentes', () => {
    expect(contactIdentifierFor('5511999999999@s.whatsapp.net')).toBe(
      'evolution:whatsapp:5511999999999',
    );
    // LID sem resolução mantém o sufixo para o envio não tratá-lo como telefone.
    expect(contactIdentifierFor('123456789012345@lid')).toBe(
      'evolution:whatsapp:123456789012345@lid',
    );
  });

  it('toPnJid resolve LID, preserva grupo e completa número', () => {
    const map = new Map([['123@lid', '5511999999999@s.whatsapp.net']]);
    expect(toPnJid('123:4@lid', map)).toBe('5511999999999@s.whatsapp.net');
    expect(toPnJid('999@lid', map)).toBe('999@lid');
    expect(toPnJid('120363000@g.us', map)).toBe('120363000@g.us');
    expect(toPnJid('5511999999999')).toBe('5511999999999@s.whatsapp.net');
  });

  it('extractTarget lê número, LID e grupo do identifier', () => {
    expect(extractTarget('evolution:whatsapp:5511999999999')).toBe(
      '5511999999999',
    );
    expect(extractTarget('evolution:whatsapp:123@lid')).toBe('123@lid');
    expect(extractTarget('evolution:whatsapp:5511-171@g.us')).toBe(
      '5511-171@g.us',
    );
    expect(extractTarget('outro')).toBeNull();
  });

  it('contactIdentifierFor mantém sufixo de grupo', () => {
    expect(contactIdentifierFor('120363000@g.us')).toBe(
      'evolution:whatsapp:120363000@g.us',
    );
  });
});
