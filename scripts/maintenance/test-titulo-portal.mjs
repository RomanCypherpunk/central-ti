import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../public/js/componentes/chamado-comum.js', import.meta.url), 'utf8')
  .replace('import { pintarFoto } from "./avatar.js";', '');
const { contarPendenciasDoPortal: contar } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const chamado = (campos = {}) => ({
  solicitante_id: 'solicitante', comentarios: [], chamado_membros: [], chamado_terceiros: [],
  ...campos,
});
const membro = usuario_id => ({ usuario_id });
const resposta = autor_id => ({ autor_id, visibilidade: 'publico', tipo: 'humano', criado_em: '2026-10-05T10:00:00Z' });
const aberto = chamado();
const meuRespondido = chamado({ chamado_membros: [membro('eu'), membro('outro')], comentarios: [resposta('solicitante')] });
const excluidos = [
  chamado({ chamado_membros: [membro('outro')] }),
  chamado({ chamado_terceiros: [{ terceiro_id: 'fornecedor' }] }),
  chamado({ chamado_membros: [membro('eu')] }),
  chamado({ comentarios: [resposta('solicitante')] }),
  chamado({ chamado_membros: [membro('outro')], comentarios: [resposta('solicitante')] }),
  chamado({ chamado_membros: [membro('eu')], comentarios: [resposta('eu')] }),
  chamado({ fechamento_em: '2026-10-05T11:00:00Z' }),
  { ...meuRespondido, fechamento_em: '2026-10-05T11:00:00Z' },
];
assert.equal(contar([aberto, meuRespondido, ...excluidos], 'eu'), 2);
assert.equal(contar(excluidos, 'eu'), 0);
assert.equal(contar([meuRespondido], null), 0);
assert.equal(contar([{ ...meuRespondido, chamado_terceiros: [{ terceiro_id: 'fornecedor' }] }], 'eu'), 1);
assert.equal(contar([chamado({ comentarios: [{ ...resposta('eu'), visibilidade: 'interno' }] })], 'eu'), 1);
assert.equal(contar([chamado({ comentarios: [{ ...resposta('solicitante'), tipo: 'automatico' }] })], 'eu'), 1);
assert.equal(contar([], 'eu'), 0);
console.log('Contagem da guia: pendências, atendentes, terceiros e status aprovados.');
