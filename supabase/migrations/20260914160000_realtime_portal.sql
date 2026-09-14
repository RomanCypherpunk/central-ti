-- Tempo real no Portal de Chamados.
--
-- O quadro escuta mudanças no banco pelo Supabase Realtime (postgres_changes)
-- e se atualiza sem recarregar: chamado novo, etiqueta, título, fila,
-- fechamento, comentário, membro, anexo e a cor/foto/nome das pessoas.
--
-- Para o Realtime mandar eventos de uma tabela, ela precisa estar na
-- publicação `supabase_realtime`. O RLS continua valendo: cada um só recebe
-- evento de linha que já poderia ler.

do $$
declare
  tabela text;
begin
  foreach tabela in array array['chamados', 'comentarios', 'chamado_membros', 'anexos', 'usuarios']
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

-- Em DELETE, o Postgres manda por padrão só a chave primária da linha. Sem o
-- chamado_id, a tela não saberia de qual chamado saiu o comentário, o membro
-- ou o anexo. `replica identity full` faz o evento trazer a linha inteira.
alter table public.comentarios replica identity full;
alter table public.chamado_membros replica identity full;
alter table public.anexos replica identity full;
