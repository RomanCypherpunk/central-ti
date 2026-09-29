-- ============================================================================
-- TEMPO REAL COMPLETO NO PORTAL
--
-- O Portal escutava sete tabelas, mas so cinco estavam na publicacao
-- `supabase_realtime` (20260914160000_realtime_portal.sql). As outras nunca
-- mandavam evento — e o quadro so se atualizava com F5:
--
--   chamado_terceiros -> fornecedor (Vivo, Sematec…) posto ou tirado de um
--                        chamado por outra pessoa;
--   terceiros         -> nome/foto de um fornecedor trocados no Painel;
--   filas             -> nao era nem escutada: lista criada, renomeada,
--                        reordenada ou arquivada por outra pessoa. Pior: um
--                        chamado movido para uma lista nova sumia do quadro,
--                        porque a coluna dela nao existia na tela.
--
-- O RLS continua valendo: cada um so recebe evento de linha que ja poderia
-- ler.
-- ============================================================================

do $$
declare
  tabela text;
begin
  foreach tabela in array array['chamado_terceiros', 'terceiros', 'filas']
  loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = tabela
    ) then
      execute format('alter publication supabase_realtime add table public.%I', tabela);
    end if;
  end loop;
end
$$;

-- Em DELETE o Postgres manda por padrao so a chave primaria. O Portal precisa
-- do chamado_id para saber de qual chamado o fornecedor saiu — mesmo motivo
-- de comentarios, chamado_membros e anexos na migration de 14/09.
alter table public.chamado_terceiros replica identity full;
