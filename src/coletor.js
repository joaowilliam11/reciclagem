// Roda a cada ~10 min no GitHub Actions: lê o Rastro Norte, grava rastro/<placa> no Realtime Database do RA-TMS e abre/fecha
// o alerta "sem sinal" das viagens em andamento. Log público: só contagens (nada de placas, posições, nomes, hashes).
// Variáveis: RASTRO_USERNAME, RASTRO_PASSWORD, FIREBASE_SERVICE_ACCOUNT, RTDB_URL (opcional), DRY_RUN=1 (não grava).
const { getDatabase } = require('firebase-admin/database');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { iniciar } = require('./firebase');
const { ClienteRastroNorte } = require('./rastro');
const { normalizarPlaca } = require('./placa');
const { decidirSemSinal, linkVencido, HASH_RE } = require('./estado');
const { descreverErro } = require('./log');

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

const naoEncontrado = (e) => e?.code === 5 || /NOT_FOUND/.test(String(e?.message || '') + String(e?.code || ''));

// Alerta "sem sinal" de UMA placa. Falha aqui nunca impede as outras placas nem a varredura de links.
async function tratarSemSinal({ placa, viagemId, v, estados, agora, fs, db, cont }) {
  const bruto = estados[placa];
  const anterior = bruto && typeof bruto === 'object' && typeof bruto.alerta_id === 'string' ? bruto : null; // estado malformado é ignorado
  const r = decidirSemSinal({ anterior, ultimoTs: v.ts, agora });
  if (!r.acao) return;
  const texto = `Rastreador ${placa} sem sinal há ${r.minutos} min`;
  if (r.acao === 'abrir') {
    // O estado vai ANTES do alerta, com id já definido: se a execução cair no meio, a próxima não abre um alerta duplicado
    const ref = fs.collection('alertas_diretoria').doc();
    await db.ref(`coletor/estado/${placa}`).set({ alerta_id: ref.id, severity: r.severity, desde: v.ts });
    await ref.set({
      tipo: 'rastreamento', subtipo: 'OFFLINE', severity: r.severity, titulo: `OFFLINE — ${placa}`, descricao: texto, parametros: { offline_minutos: r.minutos },
      viagem_id: viagemId, placa, lat: v.lat, lon: v.lon, status: 'aberto', origem: 'coletor', criado_em: FieldValue.serverTimestamp(),
    });
    cont.abertos += 1;
    return;
  }
  const alvo = fs.collection('alertas_diretoria').doc(anterior.alerta_id);
  try {
    if (r.acao === 'escalar') {
      await alvo.update({ severity: r.severity, descricao: texto, parametros: { offline_minutos: r.minutos } });
      await db.ref(`coletor/estado/${placa}`).update({ severity: r.severity });
      cont.escalados += 1;
    } else {
      await alvo.update({ normalizado_em: agora });
      await db.ref(`coletor/estado/${placa}`).remove();
      cont.normalizados += 1;
    }
  } catch (e) {
    if (!naoEncontrado(e)) throw e;
    await db.ref(`coletor/estado/${placa}`).remove(); // alerta apagado à mão: considera fechado e esquece o estado (não trava mais o coletor)
    cont.normalizados += 1;
  }
}

// Links de cliente: tira do ar o que venceu ou cuja viagem terminou. Um link com problema não impede os outros.
async function varrerLinks(fs, db, agora, simular) {
  const snap = await fs.collection('links_cliente').get();
  const viagens = new Map(); // várias linhas da mesma viagem = 1 leitura
  let removidos = 0;
  let erros = 0;
  for (const d of snap.docs) {
    try {
      if (!HASH_RE.test(d.id)) continue; // id fora do padrão nunca vira caminho do banco
      const link = d.data();
      const idViagem = typeof link.viagem_id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(link.viagem_id) ? link.viagem_id : null;
      if (idViagem && !viagens.has(idViagem)) viagens.set(idViagem, await fs.collection('viagens').doc(idViagem).get());
      const viagem = idViagem ? viagens.get(idViagem) : null;
      if (!linkVencido({ link, viagem: viagem?.exists ? viagem.data() : null, agora })) continue;
      if (!simular) {
        await db.ref(`publico/${d.id}`).remove();
        await db.ref(`publico_dono/${d.id}`).remove();
        await d.ref.delete();
        if (idViagem) await fs.collection('viagens_links').doc(idViagem).update({ hashes: FieldValue.arrayRemove(d.id) }).catch(() => {});
      }
      removidos += 1;
    } catch { erros += 1; }
  }
  return { removidos, erros };
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
  // Se o painel mudar o formato, quase tudo vira "ignorado": melhor falhar (e-mail do GitHub) do que congelar a frota em silêncio
  if (veiculos.length === 0 || ignorados / total > 0.5) throw new Error(`Formato inesperado do Rastro Norte: ${ignorados} de ${total} itens recusados.`);

  const atualizacoes = {};
  for (const v of veiculos) atualizacoes[`rastro/${v.placa}`] = { lat: v.lat, lon: v.lon, vel: v.vel, ts: v.ts };
  if (!simular) {
    await db.ref().update(atualizacoes);
    await db.ref('coletor/ultimo_ok').set(agora); // batimento: o painel avisa se o coletor parar
  }

  // Alerta "sem sinal": só para veículos com viagem em andamento já iniciada
  const viagens = await placasComViagem(fs);
  const estados = (await db.ref('coletor/estado').get()).val() || {};
  const porPlaca = new Map(veiculos.map((v) => [v.placa, v]));
  const cont = { abertos: 0, escalados: 0, normalizados: 0, erros: 0 };

  if (!simular) {
    for (const [placa, viagemId] of viagens) {
      const v = porPlaca.get(placa);
      if (!v) continue; // sem rastreador (ou fora da lista): quem avisa é o app do motorista
      try { await tratarSemSinal({ placa, viagemId, v, estados, agora, fs, db, cont }); } catch { cont.erros += 1; }
    }
    // Viagem terminou com o alerta aberto: fecha e esquece
    for (const [placa, est] of Object.entries(estados)) {
      if (viagens.has(placa)) continue;
      try {
        if (est && typeof est.alerta_id === 'string') await fs.collection('alertas_diretoria').doc(est.alerta_id).update({ normalizado_em: agora }).catch(() => {});
        await db.ref(`coletor/estado/${placa}`).remove();
        cont.normalizados += 1;
      } catch { cont.erros += 1; }
    }
  }

  // A limpeza de links nunca derruba a coleta (as posições já foram gravadas acima)
  let links = { removidos: 'erro', erros: 0 };
  try { links = await varrerLinks(fs, db, agora, simular); } catch (e) { console.error('Aviso: não consegui varrer os links:', descreverErro(e)); }

  console.log(`${simular ? '[simulação] ' : ''}Links de cliente encerrados: ${links.removidos} (erros: ${links.erros}).`);
  console.log(`${simular ? '[simulação] ' : ''}Rastro Norte: ${veiculos.length} veículo(s) gravado(s), ${ignorados} ignorado(s) de ${total}. Alertas: ${JSON.stringify(cont)}.`);
}

main().then(() => process.exit(0), (erro) => { console.error('ERRO:', descreverErro(erro)); process.exit(1); });
