// Uma vez por dia: apaga pontos de trilha (trilhas/<viagem>/<epoch_ms>) com mais de 48 h, para caber no 1 GB gratuito do Realtime Database.
// Lê só as chaves das viagens (shallow) e, de cada uma, só os pontos antigos: não baixa a trilha inteira.
const { getDatabase } = require('firebase-admin/database');
const { iniciar } = require('./firebase');
const { getFirestore } = require('firebase-admin/firestore');
const { chavesAntigas, copiasOrfas } = require('./estado');
const { descreverErro } = require('./log');

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
    // chaves que não são um instante (13 dígitos) não deveriam existir (as regras recusam): apaga junto, não ficam para sempre
    const todas = Object.keys(snap.val() || {});
    const antigas = [...chavesAntigas(todas, corte), ...todas.filter((k) => !/^\d{13}$/.test(k))];
    if (!antigas.length) continue;
    const remover = {};
    for (const k of antigas) remover[k] = null;
    await db.ref(`trilhas/${id}`).update(remover);
    apagados += antigas.length;
  }
  // Cópias públicas sem link (sobras de link encerrado): apaga
  const resPub = await fetch(`${databaseURL.replace(/\/$/, '')}/publico.json?shallow=true`, { headers: { Authorization: `Bearer ${token}` } });
  let orfas = 0;
  if (resPub.ok) {
    const links = (await getFirestore().collection('links_cliente').get()).docs.map((d) => d.id);
    for (const k of copiasOrfas(Object.keys((await resPub.json()) || {}), links)) { await db.ref(`publico/${k}`).remove(); orfas += 1; }
  }
  // Donos de cópia pública sem link correspondente
  const resDono = await fetch(`${databaseURL.replace(/\/$/, '')}/publico_dono.json?shallow=true`, { headers: { Authorization: `Bearer ${token}` } });
  if (resDono.ok) {
    const links = (await getFirestore().collection('links_cliente').get()).docs.map((d) => d.id);
    for (const k of copiasOrfas(Object.keys((await resDono.json()) || {}), links)) { await db.ref(`publico_dono/${k}`).remove(); orfas += 1; }
  }
  console.log(`Cópias públicas órfãs apagadas: ${orfas}.`);
  console.log(`Limpeza: ${viagens.length} viagem(ns) verificada(s), ${apagados} ponto(s) com mais de ${HORAS} h apagado(s).`);
}

main().then(() => process.exit(0), (erro) => { console.error('ERRO:', descreverErro(erro)); process.exit(1); });
