-- reabrir_chamado(p_chamado_id) já existe no banco (criada direto no
-- Studio, sem migração local — mesmo caso de handle_new_user()): verifica
-- se quem chama é o dono do chamado ou equipe TI, devolve ao Inbox, zera
-- fechamento_em e grava a mensagem automática. Só faltava uma coisa: a
-- reabertura não atualizava abertura_em, então o chamado reaberto não
-- pulava para o topo do Inbox (a lista ordena por abertura_em desc) —
-- reaparecia na posição da data original, podendo ficar atrás de
-- chamados mais recentes.
--
-- Reabrir conta como chamado novo de novo: quem atende precisa notar.

create or replace function public.reabrir_chamado(p_chamado_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_fila_inbox_id uuid;
  v_eh_dono boolean;
  v_nome_quem_reabriu text;
begin
  select (solicitante_id = auth.uid()) into v_eh_dono
  from chamados where id = p_chamado_id;

  if v_eh_dono is null then
    raise exception 'Chamado não encontrado';
  end if;

  if not (v_eh_dono or is_equipe_ti()) then
    raise exception 'Sem permissão para reabrir este chamado';
  end if;

  select id into v_fila_inbox_id from filas where nome = 'Inbox';

  update chamados
  set fechamento_em = null,
      fila_id = coalesce(v_fila_inbox_id, fila_id),
      -- Único ponto novo: sobe para o topo do Inbox, como um chamado que
      -- chegou agora — a lista já ordena por esta data, não precisa mexer
      -- em mais nada para o card aparecer em cima.
      abertura_em = now()
  where id = p_chamado_id;

  select nome into v_nome_quem_reabriu from usuarios where id = auth.uid();

  insert into comentarios (chamado_id, autor_id, texto, visibilidade, tipo)
  values (
    p_chamado_id,
    auth.uid(),
    format('Ticket reaberto por %s.', coalesce(v_nome_quem_reabriu, 'usuário')),
    'publico',
    'sistema'
  );
end;
$$;
