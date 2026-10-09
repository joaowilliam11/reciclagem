// Normaliza placa para comparar fontes diferentes ("0PH0E39" do painel == "OPH0E39" do app).
// Formato Mercosul LLLNLNN (e antigo LLLNNNN): corrige O/0, I/1, S/5, B/8, Z/2, G/6 por posição. (Igual ao ra-tms.)
const PARA_LETRA = { 0: 'O', 1: 'I', 5: 'S', 8: 'B', 2: 'Z', 6: 'G' };
const PARA_DIGITO = { O: '0', I: '1', S: '5', B: '8', Z: '2', G: '6', Q: '0', D: '0' };

function normalizarPlaca(valor = '') {
  const p = String(valor).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (p.length !== 7) return p;
  return [...p].map((c, i) => {
    if (i < 3) return PARA_LETRA[c] || c;
    if (i === 3 || i >= 5) return PARA_DIGITO[c] || c;
    return c;
  }).join('');
}

const placaValida = (p) => /^[A-Z0-9]{7}$/.test(p);

module.exports = { normalizarPlaca, placaValida };
