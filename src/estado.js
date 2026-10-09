// Decisão pura do alerta "sem sinal": abre uma vez quando o rastreador fica 15 min sem posição, sobe a gravidade com o tempo
// e fecha quando volta. Não repete alerta a cada execução. Tempos em epoch ms.
const SEM_SINAL_MIN = 15;
const RANK = { MEDIUM: 1, HIGH: 2, CRITICAL: 3 };

const gravidadePor = (min) => (min > 60 ? 'CRITICAL' : min > 30 ? 'HIGH' : 'MEDIUM');

// anterior: { alerta_id, severity } | null   (estado guardado no banco para a placa)
// Devolve { acao: 'abrir' | 'escalar' | 'normalizar' | null, severity, minutos }
function decidirSemSinal({ anterior, ultimoTs, agora }) {
  const minutos = Math.max(0, Math.floor((agora - ultimoTs) / 60000));
  if (minutos >= SEM_SINAL_MIN) {
    const severity = gravidadePor(minutos);
    if (!anterior?.alerta_id) return { acao: 'abrir', severity, minutos };
    if (RANK[severity] > RANK[anterior.severity || 'MEDIUM']) return { acao: 'escalar', severity, minutos };
    return { acao: null, severity: anterior.severity, minutos };
  }
  return { acao: anterior?.alerta_id ? 'normalizar' : null, severity: null, minutos };
}

// Chaves de trilha (epoch ms em texto) mais antigas que o limite
const chavesAntigas = (chaves, corte) => chaves.filter((k) => /^\d+$/.test(k) && Number(k) < corte);

module.exports = { decidirSemSinal, chavesAntigas, SEM_SINAL_MIN, gravidadePor };
