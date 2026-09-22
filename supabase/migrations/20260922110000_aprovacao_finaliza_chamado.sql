-- Aprovação de cadastro: recusar também finaliza o chamado.
--
-- Antes só a aprovação fechava o ticket de "Aprovação de Acesso" — a recusa
-- deixava o card no quadro, esperando alguém fechar na mão. Pedido do
-- usuário: decidiu, acabou. Aprovado ou recusado, a análise terminou e o
-- ticket vai para Tickets finalizados, com a etiqueta de quem decidiu.
--
-- Reabrir continua possível pelo botão do detalhe (Reabrir chamado), que é
-- como se volta atrás de uma recusa por engano — o status_aprovacao da
-- pessoa continua editável do mesmo jeito.
--
-- Substitui notificar_aprovacao_cadastro() de
-- 20260914200000_notifica_aprovacao_cadastro.sql. O search_path fica como
-- 20260921090000_security_authorization_hardening.sql deixou, e o
-- create or replace preserva as permissões já revogadas.

create or replace function public.notificar_aprovacao_cadastro()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_chamado_id uuid;
  v_quem uuid;
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
  select c.id into v_chamado_id
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

  -- Null quando a decisao nao vem de uma sessao (Edge Function com a chave
  -- mestra, ou um update rodado no SQL Editor). O comentario ainda sai, em
  -- nome da equipe; so o vinculo de membro e que precisa de alguem.
  v_quem := auth.uid();

  select nome into v_nome_membro from usuarios where id = v_quem;

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
  values (v_chamado_id, v_quem, v_texto, 'publico', 'sistema');

  -- Quem decidiu vira membro do chamado: e a etiqueta que mostra, no card e
  -- no detalhe, quem aprovou ou recusou.
  if v_quem is not null then
    insert into chamado_membros (chamado_id, usuario_id)
    values (v_chamado_id, v_quem)
    on conflict do nothing;
  end if;

  -- AQUI ESTA A MUDANCA: fecha nos dois casos, e nao so na aprovacao.
  update chamados set fechamento_em = now() where id = v_chamado_id;

  return new;
end;
$$;

drop trigger if exists usuarios_notificar_aprovacao on public.usuarios;

create trigger usuarios_notificar_aprovacao
  after update on public.usuarios
  for each row
  execute function public.notificar_aprovacao_cadastro();
