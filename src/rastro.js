// Cliente do painel Rastro Norte (GPSWOX/Laravel, sem API pública): login com token CSRF e leitura de /objects/items.
// Usa só fetch nativo do Node (sem dependências). Nunca registra placas, posições, nomes nem credenciais.
const { normalizarPlaca, placaValida } = require('./placa');

const BASE_PADRAO = 'https://app.rastronortesistemaiot.com.br';

class CookieJar {
  constructor() { this.cookies = new Map(); }
  absorver(linhas = []) {
    for (const linha of linhas) {
      const [par] = String(linha).split(';');
      const i = par.indexOf('=');
      if (i > 0) this.cookies.set(par.slice(0, i).trim(), par.slice(i + 1).trim());
    }
  }
  cabecalho() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '); }
  limpar() { this.cookies.clear(); }
}

function extrairToken(html = '') {
  const input = html.match(/name=["']_token["'][^>]*value=["']([^"']+)["']/i) || html.match(/value=["']([^"']+)["'][^>]*name=["']_token["']/i);
  const meta = html.match(/<meta[^>]+name=["']csrf-token["'][^>]+content=["']([^"']+)["']/i);
  return (input || meta || [])[1] || null;
}

// "QZJ9I89 M.BENZ BRANCO" -> "QZJ9I89"
const placaDoNome = (nome = '') => normalizarPlaca(String(nome).trim().split(/\s+/)[0]);

// Usa o campo `timestamp` (epoch em segundos); o campo `time` do painel vem ~7 h defasado.
// Devolve só veículos com posição válida e placa reconhecível; `ignorados` conta o resto (sem detalhes).
function normalizarItens(payload) {
  const itens = Array.isArray(payload?.data) ? payload.data : [];
  const veiculos = [];
  let ignorados = 0;
  for (const it of itens) {
    const lat = Number(it.lat);
    const lon = Number(it.lng);
    const epoch = Number(it.timestamp);
    const placa = placaDoNome(it.name);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(epoch) || epoch <= 0 || (lat === 0 && lon === 0)
      || Math.abs(lat) > 90 || Math.abs(lon) > 180 || !placaValida(placa)) { ignorados += 1; continue; }
    veiculos.push({ placa, lat, lon, vel: Math.max(0, Number(it.speed) || 0), ts: epoch * 1000 });
  }
  return { veiculos, ignorados, total: itens.length };
}

class SessaoExpirada extends Error {}

class ClienteRastroNorte {
  constructor({ base = BASE_PADRAO, usuario, senha, http = fetch, timeoutMs = 30000 }) {
    Object.assign(this, { base: base.replace(/\/$/, ''), usuario, senha, http, timeoutMs });
    this.jar = new CookieJar();
    this.logado = false;
  }

  async pedir(caminho, opcoes = {}) {
    const res = await this.http(caminho.startsWith('http') ? caminho : this.base + caminho, {
      redirect: 'manual',
      signal: AbortSignal.timeout(this.timeoutMs),
      ...opcoes,
      headers: { 'User-Agent': 'Mozilla/5.0 RA-Coletor', ...(opcoes.headers || {}), Cookie: this.jar.cabecalho() },
    });
    this.jar.absorver(typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []);
    return res;
  }

  async tokenDeLogin() {
    let url = '/login';
    for (let salto = 0; salto < 4; salto += 1) {
      const res = await this.pedir(url);
      if ([301, 302, 303].includes(res.status) && res.headers.get('location')) { url = res.headers.get('location'); continue; }
      const token = extrairToken(await res.text());
      if (!token) throw new Error('token CSRF não encontrado na página de login');
      return token;
    }
    throw new Error('redirecionamentos demais na página de login');
  }

  async entrar() {
    this.logado = false;
    this.jar.limpar();
    const _token = await this.tokenDeLogin();
    const res = await this.pedir('/authentication/store', {
      method: 'POST',
      body: new URLSearchParams({ _token, username: this.usuario, password: this.senha }).toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: `${this.base}/login` },
    });
    const destino = res.headers.get('location') || '';
    if (!(res.status === 302 && !/login|authentication/i.test(destino))) throw new Error(`login recusado (status ${res.status})`);
    this.logado = true;
  }

  async itens() {
    const res = await this.pedir(`/objects/items?_=${Date.now()}`, { headers: { Accept: 'application/json, text/javascript, */*; q=0.01', 'X-Requested-With': 'XMLHttpRequest' } });
    const texto = await res.text();
    let json = null;
    try { json = JSON.parse(texto); } catch { /* não é JSON */ }
    if (json && Array.isArray(json.data)) return json;
    if ([401, 419, 301, 302].includes(res.status) || /<html|login/i.test(texto)) throw new SessaoExpirada(`sessão inválida (status ${res.status})`);
    throw new Error(`resposta inesperada do Rastro Norte (status ${res.status})`);
  }

  // Uma tentativa extra de login se a sessão tiver expirado
  async coletar() {
    if (!this.logado) await this.entrar();
    let payload;
    try { payload = await this.itens(); } catch (e) {
      if (!(e instanceof SessaoExpirada)) throw e;
      await this.entrar();
      payload = await this.itens();
    }
    return normalizarItens(payload);
  }
}

module.exports = { ClienteRastroNorte, normalizarItens, extrairToken, placaDoNome, CookieJar, SessaoExpirada, BASE_PADRAO };
