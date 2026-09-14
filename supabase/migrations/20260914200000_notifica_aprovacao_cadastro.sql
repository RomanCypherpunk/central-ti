-- Aprovação de cadastro: quando a equipe de TI aprova ou rejeita o
-- status_aprovacao de um usuário, o chamado de "Aprovação de Acesso"
-- correspondente (criado por handle_new_user() no cadastro) recebe:
--   1) uma mensagem automática avisando a pessoa do resultado;
--   2) quem aprovou/rejeitou como membro do chamado, para rastrear quem
--      decidiu (o Portal já mostra os membros no card e no detalhe).
--
-- Aprovar também fecha o chamado — decisão do usuário: some da fila,
-- igual a qualquer chamado resolvido, sem lixo no quadro. Rejeitar não
-- fecha nem desativa a conta (ativo continua true): só marca
-- status_aprovacao = 'rejeitado', reversível se for engano.
--
-- Reusa o padrão de notificar_fechamento_chamado() (mesma tabela,
-- mesmo tipo 'sistema', mesmo texto em primeira pessoa da equipe).

create or replace function public.notificar_aprovacao_cadastro()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_chamado_id uuid;
  v_numero int;
  v_nome_membro text;
  v_texto text;
begin
  -- So dispara na transicao de pendente para aprovado/rejeitado — editar
  -- outros campos (nome, setor sozinho, etc) nao deve reenviar a mensagem.
  if new.status_aprovacao = old.status_aprovacao then
    return new;
  end if;

  if new.status_aprovacao not in ('aprovado', 'rejeitado') then
    return new;
  end if;

  -- O chamado de Aprovação de Acesso daquele usuário: o mais recente
  -- ainda aberto. Se não existir (cadastro antigo, sem chamado, ou já
  -- fechado por outro caminho), não há onde avisar — segue sem erro.
  select c.id, c.numero into v_chamado_id, v_numero
  from chamados c
  join categorias cat on cat.id = c.categoria_id
  where c.solicitante_id = new.id
    and cat.nome = 'Aprovação de Acesso'
    and c.fechamento_em is null
  order by c.abertura_em desc
  limit 1;

  if v_chamado_id is null then
    return new;
  end if;

  select nome into v_nome_membro from usuarios where id = auth.uid();

  v_texto := case new.status_aprovacao
    when 'aprovado' then format(
      e'Olá, %s\nSeu cadastro foi aprovado por %s. Você já pode acessar a Base de Soluções e abrir chamados.',
      new.nome, coalesce(v_nome_membro, 'nossa equipe')
    )
    else format(
      e'Olá, %s\nSeu cadastro foi analisado por %s e não foi aprovado desta vez.\n\nSe for engano ou quiser mais informações, entre em contato com a equipe de TI.',
      new.nome, coalesce(v_nome_membro, 'nossa equipe')
    )
  end;

  insert into comentarios (chamado_id, autor_id, texto, visibilidade, tipo)
  values (v_chamado_id, auth.uid(), v_texto, 'publico', 'sistema');

  -- Quem decidiu vira membro do chamado, para constar quem aprovou/rejeitou
  -- (o card e o detalhe do Portal já mostram os membros).
  insert into chamado_membros (chamado_id, usuario_id)
  values (v_chamado_id, auth.uid())
  on conflict do nothing;

  -- So a aprovacao fecha o chamado: rejeitar mantem aberto, para a equipe
  -- decidir depois se conversa mais com a pessoa antes de arquivar.
  if new.status_aprovacao = 'aprovado' then
    update chamados set fechamento_em = now() where id = v_chamado_id;
  end if;

  return new;
end;
$$;

drop trigger if exists usuarios_notificar_aprovacao on public.usuarios;

create trigger usuarios_notificar_aprovacao
  after update on public.usuarios
  for each row
  execute function public.notificar_aprovacao_cadastro();
