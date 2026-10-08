import { toInteractivePayload } from './wa-send.service';

describe('toInteractivePayload', () => {
  it('botões só de resposta viram `buttons`', () => {
    const p = toInteractivePayload({
      kind: 'buttons',
      title: 'Pedido',
      description: 'Confirmar?',
      footer: 'UBVA',
      buttons: [
        { type: 'reply', displayText: 'Sim', id: 'sim' },
        { type: 'reply', displayText: 'Não' },
      ],
    });
    expect(p.text).toBe('*Pedido*\nConfirmar?');
    expect(p.footer).toBe('UBVA');
    expect(p.buttons).toEqual([
      { text: 'Sim', id: 'sim' },
      { text: 'Não', id: 'Não' }, // sem id, usa o texto
    ]);
    expect(p.nativeFlow).toBeUndefined();
  });

  it('link, ligar e copiar exigem native flow', () => {
    const p = toInteractivePayload({
      kind: 'buttons',
      title: 'Promoções',
      description: 'Veja',
      buttons: [
        { type: 'url', displayText: 'Ver', url: 'https://x.com' },
        { type: 'call', displayText: 'Ligar', phoneNumber: '5511999999999' },
        { type: 'copy', displayText: 'Cupom', copyCode: 'CUPOM10' },
        { type: 'reply', displayText: 'Ok', id: 'ok' },
      ],
    });
    expect(p.buttons).toBeUndefined();
    expect(p.nativeFlow).toEqual([
      { text: 'Ver', url: 'https://x.com' },
      { text: 'Ligar', call: '5511999999999' },
      { text: 'Cupom', copy: 'CUPOM10' },
      { text: 'Ok', id: 'ok' },
    ]);
  });

  it('lista mapeia seções e linhas', () => {
    const p = toInteractivePayload({
      kind: 'list',
      title: 'Menu',
      buttonText: 'Ver opções',
      sections: [
        {
          title: 'Setores',
          rows: [{ title: 'Financeiro', rowId: 'fin', description: 'Boletos' }],
        },
      ],
    });
    expect(p.title).toBe('Menu');
    expect(p.text).toBe('Menu'); // sem descrição, o título vira o texto
    expect(p.buttonText).toBe('Ver opções');
    expect(p.sections).toEqual([
      {
        title: 'Setores',
        rows: [{ title: 'Financeiro', description: 'Boletos', rowId: 'fin' }],
      },
    ]);
  });
});
