# Coletor do Rastro Norte (RA Transportes)

Repositório **público** de propósito: o GitHub não cobra minutos de Actions em repositório público, e o coletor roda a cada 10 minutos o dia todo.
Nada sensível fica aqui: login, senha e chave do Firebase ficam em **secrets**, e o log mostra só contagens (nunca placas, posições ou nomes).

## O que faz
- `coletar.yml` (a cada ~10 min): entra no painel Rastro Norte, lê a posição dos veículos e grava `rastro/<placa>` no Realtime Database do RA-TMS. Para veículos com viagem em andamento já iniciada, abre o alerta "sem sinal" (15 min), sobe a gravidade (30 e 60 min) e fecha quando o sinal volta.
- `limpar.yml` (diário): apaga pontos de trilha com mais de 48 h.
- `manter-ativo.yml` (mensal): evita que o GitHub desligue o agendamento por inatividade.

## Secrets (Settings > Secrets and variables > Actions > New repository secret)
| Nome | Conteúdo |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | JSON inteiro da chave da conta de serviço do projeto **ra-tms** |
| `RASTRO_USERNAME` | usuário do painel Rastro Norte |
| `RASTRO_PASSWORD` | senha do painel Rastro Norte |

## Segurança
- Dependências travadas em `package-lock.json` (`npm ci --ignore-scripts`): nada novo é baixado a cada execução.
- Log público só com contagens; erros do Firebase/rede viram código (nunca a mensagem crua, que pode trazer caminho com placa ou hash).
- Se o Rastro Norte mudar de formato, a execução FALHA (e-mail do GitHub) em vez de congelar a frota em silêncio; o painel do TMS também avisa quando o coletor para (`coletor/ultimo_ok`).

## Testes
`npm test` (sem rede e sem Firebase). Nada aqui foi testado com o Rastro Norte nem com o Firebase reais: o primeiro teste é rodar o workflow **Coletar Rastro Norte** manualmente com **simular** marcado.
