// Inicialização do firebase-admin a partir do secret FIREBASE_SERVICE_ACCOUNT (JSON da chave). Nunca imprime o conteúdo.
const { initializeApp, cert } = require('firebase-admin/app');

const RTDB_PADRAO = 'https://ra-tms-default-rtdb.firebaseio.com';

function iniciar() {
  const bruto = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!bruto) throw new Error('Defina o secret FIREBASE_SERVICE_ACCOUNT com o JSON da chave da conta de serviço.');
  let credencial;
  try { credencial = cert(JSON.parse(bruto)); } catch { throw new Error('FIREBASE_SERVICE_ACCOUNT não é um JSON válido de conta de serviço.'); }
  const databaseURL = process.env.RTDB_URL || RTDB_PADRAO;
  return { app: initializeApp({ credential: credencial, databaseURL }), credencial, databaseURL };
}

module.exports = { iniciar, RTDB_PADRAO };
