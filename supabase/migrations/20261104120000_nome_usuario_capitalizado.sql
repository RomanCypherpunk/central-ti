-- ============================================================================
-- NOME E SOBRENOME DE USUÁRIO SEMPRE CAPITALIZADOS
--
-- Quem se cadastra digitando "LUCIANO FUJIKAWA" passa a ficar como
-- "Luciano Fujikawa" (aparece assim nos gráficos, no chat e nos títulos).
-- Partículas ficam em minúsculas: "MARIA DA SILVA" -> "Maria da Silva".
--
-- Roda no INSERT e quando nome/sobrenome são editados. Não há backfill: as
-- contas que já existem só mudam se o nome for editado de novo.
-- ============================================================================

create or replace function public.capitalizar_nome_pessoa(p_nome text)
returns text
language sql
immutable
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $$
  select case
    -- Sem nome, ou o e-mail usado como nome provisório: não mexe.
    when p_nome is null or position('@' in p_nome) > 0 then p_nome
    else (
      select string_agg(
        case when ordem > 1 and palavra in ('da', 'de', 'do', 'das', 'dos', 'e')
             then palavra
             else initcap(palavra)
        end,
        ' ' order by ordem
      )
      from unnest(string_to_array(lower(btrim(p_nome)), ' ')) with ordinality as t(palavra, ordem)
      where palavra <> ''
    )
  end
$$;

create or replace function public.capitalizar_nome_usuario()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $$
begin
  new.nome := public.capitalizar_nome_pessoa(new.nome);
  new.sobrenome := public.capitalizar_nome_pessoa(new.sobrenome);

  return new;
end;
$$;

drop trigger if exists usuarios_capitalizar_nome on public.usuarios;

create trigger usuarios_capitalizar_nome
before insert or update of nome, sobrenome on public.usuarios
for each row
execute function public.capitalizar_nome_usuario();
