-- ============================================================================
-- CHECKLIST DE CRIAÇÃO NO CHAMADO DE CADASTRO
--
-- A equipe de TI acompanha o que já foi criado para o colaborador novo
-- (E-mail, NL, Teams). A lista nasce dos itens marcados em "Precisa de" no
-- formulário e fica em chamados.checklist_criacao:
--   [{"item": "NL", "feito": false}, {"item": "E-mail", "feito": true}]
--
-- Só chamados NOVOS ganham checklist: o trigger roda no INSERT e não há
-- backfill, então o que já existe continua com a coluna nula. Quem edita é a
-- equipe, pela policy "chamados: equipe TI atualiza"; o solicitante não tem
-- UPDATE e nada na tela dele lê esta coluna.
-- ============================================================================

alter table public.chamados
  add column if not exists checklist_criacao jsonb;

create or replace function public.montar_checklist_criacao()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- Sempre parte do zero: um valor mandado pelo cliente no INSERT é ignorado.
  new.checklist_criacao := null;

  if new.dados_formulario->>'tipo' = 'cadastro'
     and jsonb_typeof(new.dados_formulario->'colaborador'->'precisa_de') = 'array' then
    select jsonb_agg(jsonb_build_object('item', item, 'feito', false) order by ordem)
      into new.checklist_criacao
      from (
        select distinct on (valor) valor as item, ordem
          from jsonb_array_elements_text(new.dados_formulario->'colaborador'->'precisa_de')
               with ordinality as t(valor, ordem)
         where btrim(valor) <> ''
         order by valor, ordem
      ) itens;
  end if;

  return new;
end;
$$;

drop trigger if exists chamados_montar_checklist on public.chamados;

create trigger chamados_montar_checklist
before insert on public.chamados
for each row
execute function public.montar_checklist_criacao();
