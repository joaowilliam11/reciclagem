// Roda a cada ~10 min no GitHub Actions: lê o Rastro Norte, grava rastro/<placa> no Realtime Database do RA-TMS e abre/fecha
// o alerta "sem sinal" das viagens em andamento. Log público: só contagens (nada de placas, posições ou nomes).
// Variáveis: RASTRO_USERNAME, RASTRO_PASSWORD, FIREBASE_SERVICE_ACCOUNT, RTDB_URL (opcional), DRY_RUN=1 (não grava).
const { getDatabase } = require('firebase-admin/database');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { iniciar } = require('./firebase');
const { ClienteRastroNorte } = require('./rastro');
const { normalizarPlaca } = require('./placa');
const { decidirSemSinal, linkVencido, HASH_RE } = require('./estado');

async function placasComViagem(fs) {
  const snap = await fs.collection('viagens').where('status', '==', 'em_andamento').get();
  const mapa = new Map(); // placa -> viagem_id (só viagens já iniciadas pelo motorista)
  for (const d of snap.docs) {
    const v = d.data();
    const placa = normalizarPlaca(v.cavalo_placa || '');
    if (placa && v.iniciada_em) mapa.set(placa, d.id);
  }
  return mapa;
}

// Links de cliente: tira do ar o que venceu ou cuja viagem terminou (apaga links_cliente/<hash> e publico/<hash>)
async function varrerLinks(fs, db, agora, simular) {
  const snap = await fs.collection('links_cliente').get();
  let removidos = 0;
  for (const d of snap.docs) {
    if (!HASH_RE.test(d.id)) continue; // id fora do padrão nunca vira caminho do banco
    const link = d.data();
    const viagem = link.viagem_id ? await fs.collection('viagens').doc(link.viagem_id).get() : null;
    if (!linkVencido({ link, viagem: viagem?.exists ? viagem.data() : null, agora })) continue;
    if (!simular) {
      await db.ref(`publico/${d.id}`).remove();
      await d.ref.delete();
      if (viagem?.exists) await viagem.ref.update({ links_cliente_hashes: FieldValue.arrayRemove(d.id) }).catch(() => {});
    }
    removidos += 1;
  }
  return removidos;
}

async function main() {
  const simular = process.env.DRY_RUN === '1';
  if (!process.env.RASTRO_USERNAME || !process.env.RASTRO_PASSWORD) throw new Error('Defina os secrets RASTRO_USERNAME e RASTRO_PASSWORD.');
  iniciar();
  const db = getDatabase();
  const fs = getFirestore();
  const agora = Date.now();

  const cliente = new ClienteRastroNorte({ usuario: process.env.RASTRO_USERNAME, senha: process.env.RASTRO_PASSWORD });
  const { veiculos, ignorados, total } = await cliente.coletar();
  if (total === 0) throw new Error('O Rastro Norte devolveu zero veículos (login ok, lista vazia).');

  const atualizacoes = {};
  for (const v of veiculos) atualizacoes[`rastro/${v.placa}`] = { lat: v.lat, lon: v.lon, vel: v.vel, ts: v.ts };
  if (!simular && veiculos.length) await db.ref().update(atualizacoes);

  // Alerta "sem sinal": só para veículos com viagem em andamento já iniciada
  const viagens = await placasComViagem(fs);
  const estados = (await db.ref('coletor/estado').get()).val() || {};
  const porPlaca = new Map(veiculos.map((v) => [v.placa, v]));
  const cont = { abertos: 0, escalados: 0, normalizados: 0 };

  for (const [placa, viagemId] of viagens) {
    const v = porPlaca.get(placa);
    if (!v) continue; // sem rastreador (ou fora da lista): quem avisa é o app do motorista
    const r = decidirSemSinal({ anterior: estados[placa] || null, ultimoTs: v.ts, agora });
    if (!r.acao || simular) continue;
    if (r.acao === 'abrir') {
      const ref = await fs.collection('alertas_diretoria').add({
        tipo: 'rastreamento', subtipo: 'OFFLINE', severity: r.severity, titulo: `OFFLINE — ${placa}`,
        descricao: `Rastreador ${placa} sem sinal há ${r.minutos} min`, parametros: { offline_minutos: r.minutos },
        viagem_id: viagemId, placa, lat: v.lat, lon: v.lon, status: 'aberto', origem: 'coletor', criado_em: FieldValue.serverTimestamp(),
      });
      await db.ref(`coletor/estado/${placa}`).set({ alerta_id: ref.id, severity: r.severity, desde: v.ts });
      cont.abertos += 1;
    } else if (r.acao === 'escalar') {
      const est = estados[placa];
      await fs.collection('alertas_diretoria').doc(est.alerta_id).update({ severity: r.severity, descricao: `Rastreador ${placa} sem sinal há ${r.minutos} min`, parametros: { offline_minutos: r.minutos } });
      await db.ref(`coletor/estado/${placa}`).update({ severity: r.severity });
      cont.escalados += 1;
    } else if (r.acao === 'normalizar') {
      await fs.collection('alertas_diretoria').doc(estados[placa].alerta_id).update({ normalizado_em: agora });
      await db.ref(`coletor/estado/${placa}`).remove();
      cont.normalizados += 1;
    }
  }
  // Viagem terminou com o alerta aberto: fecha e esquece
  for (const [placa, est] of Object.entries(estados)) {
    if (viagens.has(placa) || simular) continue;
    await fs.collection('alertas_diretoria').doc(est.alerta_id).update({ normalizado_em: agora }).catch(() => {});
    await db.ref(`coletor/estado/${placa}`).remove();
    cont.normalizados += 1;
  }

  // A limpeza de links nunca derruba a coleta (as posições já foram gravadas acima)
  let linksRemovidos = 'erro';
  try { linksRemovidos = await varrerLinks(fs, db, agora, simular); } catch (e) { console.error('Aviso: não consegui varrer os links:', e.message); }

  console.log(`${simular ? '[simulação] ' : ''}Links de cliente encerrados: ${linksRemovidos}.`);
  console.log(`${simular ? '[simulação] ' : ''}Rastro Norte: ${veiculos.length} veículo(s) gravado(s), ${ignorados} ignorado(s) de ${total}. Viagens acompanhadas: ${viagens.size}. Alertas: ${JSON.stringify(cont)}.`);
}

main().then(() => process.exit(0), (erro) => { console.error('ERRO:', erro.message); process.exit(1); });
