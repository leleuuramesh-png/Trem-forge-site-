// functions/.netlify/functions/[[route]].js
//
// Existe só pra cobrir o caminho EXATO que o front-end antigo chama
// (/.netlify/functions/*). No Cloudflare Pages, uma Function num caminho
// exato tem prioridade sobre as regras do _redirects — então, mesmo que
// o _redirects devesse cobrir isso, ter esse arquivo aqui garante que
// funciona independente disso.
//
// Reaproveita o MESMO handler de functions/api/[[route]].js em vez de
// duplicar a lógica — assim não tem como os dois ficarem dessincronizados
// de novo (foi exatamente isso que quebrou o stripe-reactivate antes).

export { onRequest } from '../../api/[[route]].js';
