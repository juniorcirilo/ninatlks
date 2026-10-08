import {
  bindTenant,
  enforceTenantScope,
  validateIdentifier,
  validateReadOnlySql,
} from './tool-sql';

describe('validateReadOnlySql', () => {
  it('aceita SELECT e WITH, removendo o ; final', () => {
    expect(
      validateReadOnlySql(
        'SELECT id, nome FROM clientes WHERE id = 1;',
        'postgresql',
      ),
    ).toBe('SELECT id, nome FROM clientes WHERE id = 1');
    expect(
      validateReadOnlySql('WITH a AS (SELECT 1 x) SELECT * FROM a', 'mssql'),
    ).toContain('WITH a');
  });

  it.each([
    'DELETE FROM clientes',
    'UPDATE clientes SET nome = 1',
    'INSERT INTO t VALUES (1)',
    'DROP TABLE clientes',
    'SELECT 1; DROP TABLE x',
    'SELECT 1 -- comentario',
    'SELECT 1 /* x */',
    'SELECT pg_sleep(10)',
    "SELECT set_config('a','b',false)",
    'SELECT * INTO novo FROM t',
    'SELECT * FROM vault.secrets',
    'SELECT * FROM auth.users',
    'CALL minha_proc()',
    'SELECT dblink_exec(1)',
  ])('rejeita escrita/perigoso: %s', (q) => {
    expect(() => validateReadOnlySql(q, 'postgresql')).toThrow();
  });

  it('rejeita T-SQL de execução e fontes externas', () => {
    for (const q of [
      'EXEC sp_who',
      'SELECT * FROM OPENROWSET(x)',
      'SELECT xp_cmdshell',
      'DECLARE @a int; SELECT @a',
      'SELECT 1 WAITFOR DELAY 1',
    ])
      expect(() => validateReadOnlySql(q, 'mssql')).toThrow();
  });

  it('não confunde palavras proibidas dentro de strings', () => {
    expect(
      validateReadOnlySql(
        "SELECT * FROM t WHERE obs = 'delete me; drop'",
        'postgresql',
      ),
    ).toContain("'delete me; drop'");
  });

  it('rejeita vazio e o que não é SELECT', () => {
    expect(() => validateReadOnlySql('  ', 'postgresql')).toThrow();
    expect(() => validateReadOnlySql('SHOW tables', 'postgresql')).toThrow();
  });
});

describe('validateIdentifier', () => {
  it('aceita nomes comuns e rejeita injeção', () => {
    expect(validateIdentifier('dbo', 'esquema')).toBe('dbo');
    expect(validateIdentifier('Minha Tabela', 'tabela')).toBe('Minha Tabela');
    expect(() => validateIdentifier("x'; drop", 'tabela')).toThrow();
    expect(() => validateIdentifier('a.b', 'tabela')).toThrow();
  });
});

describe('tenant (client_id)', () => {
  it('aceita consultas com :client_id (inclusive em joins por client_id)', () => {
    expect(() =>
      enforceTenantScope(
        'SELECT c.nome FROM clientes c JOIN titulos t ON t.client_id = c.client_id WHERE c.client_id = :client_id AND c.telefone = 5541',
      ),
    ).not.toThrow();
  });
  it('recusa consulta sem o parâmetro', () => {
    expect(() => enforceTenantScope('SELECT * FROM clientes')).toThrow(
      /:client_id/,
    );
    expect(() =>
      enforceTenantScope("SELECT ':client_id' AS x FROM clientes"),
    ).toThrow(/:client_id/);
  });
  it.each([
    'SELECT 1 FROM t WHERE client_id = 7 AND client_id = :client_id',
    "SELECT 1 FROM t WHERE client_id = 'outro' AND x = :client_id",
    'SELECT 1 FROM t WHERE client_id IN (1,2) AND y = :client_id',
    'SELECT 1 FROM t WHERE 5 = client_id AND z = :client_id',
  ])('recusa comparar client_id com valor fixo: %s', (q) => {
    expect(() => enforceTenantScope(q)).toThrow(/valor fixo/);
  });
  it('troca :client_id pelo parâmetro do dialeto e preserva literais', () => {
    expect(
      bindTenant(
        "SELECT ':client_id' a FROM t WHERE client_id = :client_id",
        'postgresql',
        'abc',
      ),
    ).toEqual({
      text: "SELECT ':client_id' a FROM t WHERE client_id = $1",
      values: ['abc'],
    });
    expect(
      bindTenant('SELECT 1 WHERE client_id = :client_id', 'mssql', '9').text,
    ).toBe('SELECT 1 WHERE client_id = @p1');
  });
});
