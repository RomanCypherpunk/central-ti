-- CANDIDATO DE CORREÇÃO, não executado, fora da cadeia de migrations.
-- Pré-requisitos: baseline real, rls-inventory.sql revisado, staging com fixtures.
-- Aplicar como owner das tabelas/funções. Não remove proteção existente.
-- Policies RESTRICTIVE se combinam por AND às permissivas já existentes.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- RLS-01: unidade_id participa da autorização de artigos. Só TI muda unidade.
-- Função separada para não sobrescrever triggers eventualmente ajustados no Studio.
create or replace function public.proteger_unidade_usuario()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.unidade_id is distinct from old.unidade_id
     and not public.is_equipe_ti() then
    raise exception 'Somente a equipe de TI pode alterar a unidade.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.proteger_unidade_usuario() from public, anon, authenticated;
drop trigger if exists usuarios_proteger_unidade on public.usuarios;
create trigger usuarios_proteger_unidade
before update on public.usuarios
for each row execute function public.proteger_unidade_usuario();

-- RLS-02: contribuinte não atribui autoria a terceiro. TI conserva seus fluxos.
-- UPDATE já tem autor_id = auth.uid() no WITH CHECK da policy de 17/09;
-- este fechamento do INSERT não concede UPDATE/DELETE nem novos setores.
drop policy if exists "seguranca: autoria artigo no insert" on public.artigos;
create policy "seguranca: autoria artigo no insert"
on public.artigos as restrictive for insert to authenticated
with check (public.is_equipe_ti() or autor_id = auth.uid());

-- RLS-03: somente fluxos privilegiados geram mensagens de sistema. Cliente TI
-- manda humano/solucao, solicitante só humano. O vínculo de artigo respeita RLS.
-- reabrir_chamado/notificar_aprovacao continuam gerando sistema como owner,
-- desde que esse owner tenha o bypass já utilizado pelas funções atuais.
drop policy if exists "seguranca: origem e tipo comentario" on public.comentarios;
create policy "seguranca: origem e tipo comentario"
on public.comentarios as restrictive for insert to authenticated
with check (
  autor_id = auth.uid()
  and (
    (tipo = 'humano' and artigo_id is null)
    or (
      public.is_equipe_ti() and tipo = 'solucao' and artigo_id is not null
      and exists (select 1 from public.artigos a where a.id = comentarios.artigo_id)
    )
  )
);

-- ACL-01: PUBLIC é um pseudo-role herdado por anon e authenticated.
-- Funções de trigger/cron só são invocadas pelo Postgres, nunca pela API.
revoke execute on function public.abrir_chamado_de_acesso() from public, anon, authenticated;
revoke execute on function public.bloquear_autoaprovacao() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.incluir_unidade_nos_artigos() from public, anon, authenticated;
revoke execute on function public.montar_titulo_chamado() from public, anon, authenticated;
revoke execute on function public.notificar_abertura_chamado() from public, anon, authenticated;
revoke execute on function public.notificar_aprovacao_cadastro() from public, anon, authenticated;
revoke execute on function public.notificar_fechamento_chamado() from public, anon, authenticated;
revoke execute on function public.notificar_portal_via_webhook() from public, anon, authenticated;
revoke execute on function public.protege_perfil_usuario() from public, anon, authenticated;
revoke execute on function public.rotear_chamado_por_categoria() from public, anon, authenticated;
revoke execute on function public.rotear_chamado_por_comentario() from public, anon, authenticated;
revoke execute on function public.limpar_historico_do_cron() from public, anon, authenticated;
revoke execute on function public.processar_retornos_pendentes() from public, anon, authenticated;

-- Helpers de RLS e RPCs legítimas continuam disponíveis somente após login.
revoke execute on function public.aprovar_acesso(uuid) from public, anon;
revoke execute on function public.rejeitar_acesso(uuid) from public, anon;
revoke execute on function public.reabrir_chamado(uuid) from public, anon;
revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.is_aprovado() from public, anon;
revoke execute on function public.is_equipe_ti() from public, anon;
revoke execute on function public.meu_setor_id() from public, anon;
revoke execute on function public.meu_setor_nome() from public, anon;
revoke execute on function public.minha_unidade_id() from public, anon;
revoke execute on function public.pode_abrir_chamado_de_colaborador() from public, anon;
revoke execute on function public.pode_escrever_artigo() from public, anon;
revoke execute on function public.setores_permitidos_para_artigo() from public, anon;
grant execute on function public.aprovar_acesso(uuid) to authenticated;
grant execute on function public.rejeitar_acesso(uuid) to authenticated;
grant execute on function public.reabrir_chamado(uuid) to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_aprovado() to authenticated;
grant execute on function public.is_equipe_ti() to authenticated;
grant execute on function public.meu_setor_id() to authenticated;
grant execute on function public.meu_setor_nome() to authenticated;
grant execute on function public.minha_unidade_id() to authenticated;
grant execute on function public.pode_abrir_chamado_de_colaborador() to authenticated;
grant execute on function public.pode_escrever_artigo() to authenticated;
grant execute on function public.setores_permitidos_para_artigo() to authenticated;

-- Funções futuras criadas pela role da migração nascem privadas. RPCs novas
-- devem receber GRANT explícito para authenticated ou service_role.
alter default privileges in schema public revoke execute on functions from public;

-- PATH-01: pg_temp explicitamente por último, pg_catalog primeiro.
-- Complementar com revisão de CREATE no schema public. Não presumir explorável
-- pelo REST: o ataque por tabela temporária requer execução SQL apropriada.
alter function public.is_equipe_ti() set search_path = pg_catalog, public, pg_temp;
alter function public.is_admin() set search_path = pg_catalog, public, pg_temp;
alter function public.is_aprovado() set search_path = pg_catalog, public, pg_temp;
alter function public.pode_escrever_artigo() set search_path = pg_catalog, public, pg_temp;
alter function public.meu_setor_id() set search_path = pg_catalog, public, pg_temp;
alter function public.minha_unidade_id() set search_path = pg_catalog, public, pg_temp;
alter function public.meu_setor_nome() set search_path = pg_catalog, public, pg_temp;
alter function public.setores_permitidos_para_artigo() set search_path = pg_catalog, public, pg_temp;
alter function public.pode_abrir_chamado_de_colaborador() set search_path = pg_catalog, public, pg_temp;
alter function public.reabrir_chamado(uuid) set search_path = pg_catalog, public, pg_temp;
alter function public.limpar_historico_do_cron() set search_path = pg_catalog, public, pg_temp;
alter function public.aprovar_acesso(uuid) set search_path = pg_catalog, public, pg_temp;
alter function public.rejeitar_acesso(uuid) set search_path = pg_catalog, public, pg_temp;
alter function public.processar_retornos_pendentes() set search_path = pg_catalog, public, pg_temp;
alter function public.abrir_chamado_de_acesso() set search_path = pg_catalog, public, pg_temp;
alter function public.bloquear_autoaprovacao() set search_path = pg_catalog, public, pg_temp;
alter function public.handle_new_user() set search_path = pg_catalog, public, pg_temp;
alter function public.incluir_unidade_nos_artigos() set search_path = pg_catalog, public, pg_temp;
alter function public.montar_titulo_chamado() set search_path = pg_catalog, public, pg_temp;
alter function public.notificar_abertura_chamado() set search_path = pg_catalog, public, pg_temp;
alter function public.notificar_aprovacao_cadastro() set search_path = pg_catalog, public, pg_temp;
alter function public.notificar_fechamento_chamado() set search_path = pg_catalog, public, pg_temp;
alter function public.protege_perfil_usuario() set search_path = pg_catalog, public, pg_temp;
alter function public.rotear_chamado_por_categoria() set search_path = pg_catalog, public, pg_temp;
alter function public.rotear_chamado_por_comentario() set search_path = pg_catalog, public, pg_temp;
alter function public.set_updated_at() set search_path = pg_catalog, public, pg_temp;
alter function public.set_atualizado_em() set search_path = pg_catalog, public, pg_temp;
alter function public.artigos_atualizar_busca() set search_path = pg_catalog, public, pg_temp;
alter function public.tocar_atualizado_em() set search_path = pg_catalog, public, pg_temp;
alter function public.textos_rapidos_tocar() set search_path = pg_catalog, public, pg_temp;
alter function public.definir_urgencia_chamado() set search_path = pg_catalog, public, pg_temp;
commit;
