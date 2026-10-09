// Uma vez por dia: apaga pontos de trilha (trilhas/<viagem>/<epoch_ms>) com mais de 48 h, para caber no 1 GB gratuito do Realtime Database.
// Lê só as chaves das viagens (shallow) e, de cada uma, só os pontos antigos: não baixa a trilha inteira.
const { getDatabase } = require('firebase-admin/database');
const { iniciar } = require('./firebase');
const { chavesAntigas } = require('./estado');

const HORAS = 48;

async function main() {
  const { credencial, databaseURL } = iniciar();
  const db = getDatabase();
  const corte = Date.now() - HORAS * 3600 * 1000;
  const { access_token: token } = await credencial.getAccessToken();
  const res = await fetch(`${databaseURL.replace(/\/$/, '')}/trilhas.json?shallow=true`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`não consegui listar as viagens (status ${res.status})`);
  const viagens = Object.keys((await res.json()) || {});
  let apagados = 0;
  for (const id of viagens) {
    const snap = await db.ref(`trilhas/${id}`).orderByKey().endAt(String(corte)).get();
    const antigas = chavesAntigas(Object.keys(snap.val() || {}), corte);
    if (!antigas.length) continue;
    const remover = {};
    for (const k of antigas) remover[k] = null;
    await db.ref(`trilhas/${id}`).update(remover);
    apagados += antigas.length;
  }
  console.log(`Limpeza: ${viagens.length} viagem(ns) verificada(s), ${apagados} ponto(s) com mais de ${HORAS} h apagado(s).`);
}

main().then(() => process.exit(0), (erro) => { console.error('ERRO:', erro.message); process.exit(1); });
