-- ============================================================================
-- AJUSTE DA CAPITALIZAÇÃO DE NOMES + PADRONIZAÇÃO DAS CONTAS EXISTENTES
--
-- 1) A função agora só mexe em nome TODO em maiúsculas ou TODO em minúsculas.
--    Nome com mistura ("Sant'Ana", "Tania Silva Oliveira") é preservado, e o
--    que vem depois de apóstrofo também ganha maiúscula: "D'AVILA" -> "D'Avila".
-- 2) Padroniza quem já está cadastrado, com a mesma regra.
-- ============================================================================

create or replace function public.capitalizar_nome_pessoa(p_nome text)
returns text
language sql
immutable
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $$
  select case
    -- Sem nome, e-mail usado como nome provisório, ou nome já com mistura de
    -- maiúsculas e minúsculas (escrito de propósito): não mexe.
    when p_nome is null
      or position('@' in p_nome) > 0
      or (p_nome <> upper(p_nome) and p_nome <> lower(p_nome)) then p_nome
    else (
      select string_agg(
        case when ordem > 1 and palavra in ('da', 'de', 'do', 'das', 'dos', 'e')
             then palavra
             else array_to_string(array(
               select initcap(parte) from unnest(string_to_array(palavra, '''')) as p(parte)
             ), '''')
        end,
        ' ' order by ordem
      )
      from unnest(string_to_array(lower(btrim(p_nome)), ' ')) with ordinality as t(palavra, ordem)
      where palavra <> ''
    )
  end
$$;

update public.usuarios
   set nome = public.capitalizar_nome_pessoa(nome),
       sobrenome = public.capitalizar_nome_pessoa(sobrenome)
 where nome is distinct from public.capitalizar_nome_pessoa(nome)
    or sobrenome is distinct from public.capitalizar_nome_pessoa(sobrenome);
