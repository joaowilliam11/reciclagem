// Log público: nunca imprime a mensagem crua de erro do Firebase/rede (pode trazer caminhos com placa ou hash do link, URLs, cabeçalhos).
// Só mensagens escritas por este projeto (conhecidas e sem dado sensível) passam; o resto vira código/nome do erro.
const SEGURAS = /^(login recusado|token CSRF|redirecion|sessão|resposta inesperada|O Rastro Norte|Defina |FIREBASE_SERVICE_ACCOUNT|Formato inesperado)/;

function descreverErro(erro) {
  const msg = String(erro?.message || '');
  if (SEGURAS.test(msg)) return msg;
  return `${erro?.code || erro?.name || 'erro'}`.replace(/[a-f0-9]{64}/g, '<hash>').slice(0, 80);
}

module.exports = { descreverErro };
