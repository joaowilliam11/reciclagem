const test = require('node:test');
const assert = require('node:assert');
const { normalizarPlaca, placaValida } = require('../src/placa');
const { normalizarItens, extrairToken, placaDoNome, CookieJar, ClienteRastroNorte } = require('../src/rastro');
const { decidirSemSinal, chavesAntigas, gravidadePor } = require('../src/estado');

const MIN = 60000;
const AGORA = Date.UTC(2026, 9, 9, 15, 0, 0);

test('placa: 0/O e I/1 por posição, tamanho errado fica como veio', () => {
  assert.strictEqual(normalizarPlaca('0PH0E39'), 'OPH0E39');
  assert.strictEqual(normalizarPlaca('abc-1d23'), 'ABC1D23');
  assert.strictEqual(normalizarPlaca('AB12'), 'AB12');
  assert(placaValida('ABC1D23') && !placaValida('ABC1D2') && !placaValida(''));
});

test('placaDoNome pega a primeira palavra', () => {
  assert.strictEqual(placaDoNome('QZJ9I89 M.BENZ BRANCO'), 'QZJ9I89');
  assert.strictEqual(placaDoNome(undefined), '');
});

test('normalizarItens: usa timestamp em segundos, descarta inválidos sem lançar', () => {
  const r = normalizarItens({ data: [
    { id: 1, name: '0PH0E39 SCANIA', lat: '-3.1', lng: '-60.0', speed: 52, timestamp: 1760000000 },
    { id: 2, name: 'QZI9I39 VOLVO', lat: 0, lng: 0, speed: 0, timestamp: 1760000000 },
    { id: 3, name: 'ABC1D23', lat: -3, lng: -60, timestamp: 0 },
    { id: 4, name: 'CURTO', lat: -3, lng: -60, timestamp: 1760000000 },
    { id: 5, name: 'ABC1D24', lat: 95, lng: -60, timestamp: 1760000000 },
    { id: 6, name: 'ABC1D25', lat: -3, lng: -60, speed: -5, timestamp: 1760000000, time: 'defasado' },
  ] });
  assert.deepStrictEqual([r.veiculos.length, r.ignorados, r.total], [2, 4, 6]);
  assert.deepStrictEqual(r.veiculos[0], { placa: 'OPH0E39', lat: -3.1, lon: -60, vel: 52, ts: 1760000000000 });
  assert.strictEqual(r.veiculos[1].vel, 0);
  assert.deepStrictEqual(normalizarItens(null), { veiculos: [], ignorados: 0, total: 0 });
  assert.deepStrictEqual(normalizarItens({ data: 'x' }), { veiculos: [], ignorados: 0, total: 0 });
});

test('extrairToken e jar de cookies', () => {
  assert.strictEqual(extrairToken('<input type="hidden" name="_token" value="abc123">'), 'abc123');
  assert.strictEqual(extrairToken('<meta name="csrf-token" content="meta9">'), 'meta9');
  assert.strictEqual(extrairToken('<html></html>'), null);
  const j = new CookieJar();
  j.absorver(['a=1; Path=/; HttpOnly', 'b=2']);
  j.absorver(['a=3']);
  assert.strictEqual(j.cabecalho(), 'a=3; b=2');
});

test('sem sinal: abre uma vez aos 15 min, escala, não repete e normaliza', () => {
  assert.deepStrictEqual(decidirSemSinal({ anterior: null, ultimoTs: AGORA - 14 * MIN, agora: AGORA }).acao, null);
  let r = decidirSemSinal({ anterior: null, ultimoTs: AGORA - 15 * MIN, agora: AGORA });
  assert.deepStrictEqual([r.acao, r.severity, r.minutos], ['abrir', 'MEDIUM', 15]);
  const aberto = { alerta_id: 'x', severity: 'MEDIUM' };
  assert.strictEqual(decidirSemSinal({ anterior: aberto, ultimoTs: AGORA - 20 * MIN, agora: AGORA }).acao, null, 'não repete');
  r = decidirSemSinal({ anterior: aberto, ultimoTs: AGORA - 40 * MIN, agora: AGORA });
  assert.deepStrictEqual([r.acao, r.severity], ['escalar', 'HIGH']);
  r = decidirSemSinal({ anterior: { alerta_id: 'x', severity: 'HIGH' }, ultimoTs: AGORA - 90 * MIN, agora: AGORA });
  assert.deepStrictEqual([r.acao, r.severity], ['escalar', 'CRITICAL']);
  assert.strictEqual(decidirSemSinal({ anterior: { alerta_id: 'x', severity: 'CRITICAL' }, ultimoTs: AGORA - 999 * MIN, agora: AGORA }).acao, null);
  assert.strictEqual(decidirSemSinal({ anterior: aberto, ultimoTs: AGORA - 2 * MIN, agora: AGORA }).acao, 'normalizar');
  assert.strictEqual(decidirSemSinal({ anterior: null, ultimoTs: AGORA, agora: AGORA }).acao, null);
  assert.deepStrictEqual([gravidadePor(15), gravidadePor(31), gravidadePor(61)], ['MEDIUM', 'HIGH', 'CRITICAL']);
});

test('limpeza: só chaves numéricas mais antigas que o corte', () => {
  assert.deepStrictEqual(chavesAntigas(['100', '200', '300', 'abc', '20x'], 250), ['100', '200']);
  assert.deepStrictEqual(chavesAntigas([], 1), []);
});

test('cliente: login com CSRF, cookies e leitura (rede simulada)', async () => {
  const chamadas = [];
  const resposta = (status, corpo, cabecalhos = {}, cookies = []) => ({ status, text: async () => corpo, headers: { get: (k) => cabecalhos[k.toLowerCase()] ?? null, getSetCookie: () => cookies } });
  const http = async (url, op = {}) => {
    chamadas.push({ url, metodo: op.method || 'GET', cookie: op.headers?.Cookie });
    if (url.endsWith('/login')) return resposta(200, '<input name="_token" value="T1">', {}, ['sess=S1; Path=/']);
    if (url.endsWith('/authentication/store')) { assert(String(op.body).includes('_token=T1')); return resposta(302, '', { location: '/objects' }, ['sess=S2']); }
    if (url.includes('/objects/items')) return resposta(200, JSON.stringify({ data: [{ id: 1, name: 'ABC1D23 X', lat: -3, lng: -60, speed: 1, timestamp: 1760000000 }] }));
    throw new Error('url inesperada');
  };
  const c = new ClienteRastroNorte({ usuario: 'u', senha: 's', http });
  const r = await c.coletar();
  assert.strictEqual(r.veiculos.length, 1);
  assert.strictEqual(chamadas.at(-1).cookie, 'sess=S2');
});

test('cliente: login recusado e sessão expirada', async () => {
  const resposta = (status, corpo, cab = {}) => ({ status, text: async () => corpo, headers: { get: (k) => cab[k.toLowerCase()] ?? null, getSetCookie: () => [] } });
  const recusa = new ClienteRastroNorte({ usuario: 'u', senha: 'x', http: async (url) => (url.endsWith('/login') ? resposta(200, '<input name="_token" value="T">') : resposta(302, '', { location: '/login' })) });
  await assert.rejects(() => recusa.coletar(), /login recusado/);
  let logins = 0; let itens = 0;
  const expira = new ClienteRastroNorte({ usuario: 'u', senha: 's', http: async (url) => {
    if (url.endsWith('/login')) return resposta(200, '<input name="_token" value="T">');
    if (url.endsWith('/authentication/store')) { logins += 1; return resposta(302, '', { location: '/objects' }); }
    itens += 1;
    return itens === 1 ? resposta(200, '<html>login</html>') : resposta(200, JSON.stringify({ data: [] }));
  } });
  const r = await expira.coletar();
  assert.deepStrictEqual([logins, r.total], [2, 0]);
});
