-- Inventário somente leitura de funções SECURITY DEFINER e suas dependências.
begin read only;
set local statement_timeout = '30s';

select json_build_object(
  'functions', (
    select json_agg(x order by x.name)
    from (
      select
        p.oid::regprocedure::text as name,
        p.prorettype::regtype::text as returns,
        p.prosecdef,
        p.proconfig,
        has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec,
        pg_get_functiondef(p.oid) as definition
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef
    ) x
  ),
  'triggers', (
    select json_agg(x order by x.table_name, x.trigger_name)
    from (
      select
        t.tgrelid::regclass::text as table_name,
        t.tgname as trigger_name,
        t.tgfoid::regprocedure::text as function_name
      from pg_trigger t
      where not t.tgisinternal
        and t.tgfoid in (
          select p.oid
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.prosecdef
        )
    ) x
  ),
  'policies', (
    select json_agg(x order by x.tablename, x.policyname)
    from (
      select tablename, policyname, qual, with_check
      from pg_policies
      where schemaname = 'public'
        and (coalesce(qual, '') || coalesce(with_check, '')) ~
          '(is_admin|is_equipe_ti|is_aprovado|meu_setor|minha_unidade|pode_escrever|pode_abrir)'
    ) x
  )
);

rollback;
