-- ============================================================================
-- RETORNO AUTOMÁTICO NUNCA VOLTA PARA "AGUARDANDO RETORNO"
--
-- Fluxo: o card está em "Aguardando retorno" (ou em Atendimento I/II), o
-- solicitante responde e o card sobe para o Inbox (Regra 7). Se já há membro
-- no chamado, o retorno é agendado para 10 minutos depois (Regra 8).
--
-- Antes, o destino era sempre a fila de onde o card saiu. Agora, se essa fila
-- for "Aguardando retorno", o destino é a ÚLTIMA fila de atendimento
-- ("Em atendimento: Nível I" ou "Nível II") em que o chamado esteve. Sem
-- histórico, cai no Nível I.
--
-- O processamento dos 10 minutos (processar_retornos_pendentes) não muda: ele
-- usa o fila_destino_id gravado aqui.
-- ============================================================================

alter table public.chamados
  add column if not exists ultima_fila_atendimento_id uuid references public.filas(id) on delete set null;

-- Chamados que já estão em atendimento: a última fila é a atual. Os que estão
-- em "Aguardando retorno" ficam nulos e usam o fallback (Nível I).
update public.chamados
   set ultima_fila_atendimento_id = fila_id
 where fila_id in (select id from public.filas where nome like 'Em atendimento:%')
   and ultima_fila_atendimento_id is null;

create or replace function public.registrar_ultima_fila_atendimento()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $$
begin
  if exists (select 1 from filas where id = new.fila_id and nome like 'Em atendimento:%') then
    new.ultima_fila_atendimento_id := new.fila_id;
  end if;

  return new;
end;
$$;

drop trigger if exists chamados_registrar_ultima_fila_atendimento on public.chamados;

create trigger chamados_registrar_ultima_fila_atendimento
before update of fila_id on public.chamados
for each row
when (new.fila_id is distinct from old.fila_id)
execute function public.registrar_ultima_fila_atendimento();

create or replace function public.rotear_chamado_por_comentario()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $$
declare
  v_solicitante_id uuid;
  v_fila_atual_id uuid;
  v_fila_inbox_id uuid;
  v_fila_aguardando_id uuid;
  v_fila_nivel1_id uuid;
  v_ultima_atendimento_id uuid;
  v_tem_membro boolean;
  v_fila_destino_id uuid;
begin
  -- Só reage a mensagens humanas (ignora os comentários de sistema desta
  -- própria automação e das automações de abertura/fechamento).
  if new.tipo <> 'humano' then
    return new;
  end if;

  select solicitante_id, fila_id, ultima_fila_atendimento_id
    into v_solicitante_id, v_fila_atual_id, v_ultima_atendimento_id
  from chamados where id = new.chamado_id;

  select id into v_fila_inbox_id from filas where nome = 'Inbox';

  if new.autor_id = v_solicitante_id then
    -- Regra 7: solicitante respondeu -> volta pro Inbox, guardando de onde veio.
    if v_fila_atual_id is distinct from v_fila_inbox_id then
      update chamados
      set fila_anterior_id = v_fila_atual_id,
          fila_id = v_fila_inbox_id
      where id = new.chamado_id;

      -- Regra 8: se já tem atendente atribuído, agenda o retorno em 10min.
      select exists (
        select 1 from chamado_membros where chamado_id = new.chamado_id
      ) into v_tem_membro;

      if v_tem_membro then
        select id into v_fila_aguardando_id from filas where nome = 'Aguardando retorno';
        select id into v_fila_nivel1_id from filas where nome = 'Em atendimento: Nível I';

        if v_fila_atual_id is null then
          v_fila_destino_id := v_fila_nivel1_id;
        elsif v_fila_atual_id = v_fila_aguardando_id then
          -- Nunca volta para "Aguardando retorno": vai para a última fila de
          -- atendimento do chamado (Nível I se não houver registro).
          v_fila_destino_id := coalesce(v_ultima_atendimento_id, v_fila_nivel1_id);
        else
          v_fila_destino_id := v_fila_atual_id;
        end if;

        insert into chamado_retorno_pendente (chamado_id, fila_destino_id)
        values (new.chamado_id, v_fila_destino_id);
      end if;
    end if;
  end if;

  return new;
end;
$$;
