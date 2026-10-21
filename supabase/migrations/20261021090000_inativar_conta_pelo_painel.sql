-- Inativar conta pela ficha do Painel voltou a funcionar.
--
-- O QUE ESTAVA ACONTECENDO: dois gatilhos de `usuarios` pediam coisas
-- opostas para mudar a coluna `ativo`, e nenhuma gravacao passava nos dois:
--   - bloquear_alteracao_direta_de_conta_ativa (20260921103000) so aceitava
--     a service_role;
--   - protege_perfil_usuario so aceita alguem da equipe de TI logado
--     (auth.uid()), que a service_role nao tem.
-- A Edge Function atualizar-usuario grava com o token do admin que chamou
-- (para os gatilhos reconhecerem o admin), entao caia no primeiro.
--
-- A CORRECAO: o primeiro gatilho aceita tambem um administrador ativo e
-- aprovado. A Edge Function continua fazendo a parte do Auth (banir o login
-- e derrubar as sessoes) antes de gravar. Conta inativa segue sem acesso a
-- nada: a policy restritiva conta_ativa_necessaria barra qualquer tabela,
-- mesmo com um token antigo.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function public.bloquear_alteracao_direta_de_conta_ativa()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.ativo is distinct from old.ativo
     and coalesce(auth.role(), '') <> 'service_role'
     and not public.is_admin() then
    raise exception 'Somente administradores podem ativar ou inativar contas.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.bloquear_alteracao_direta_de_conta_ativa() from public, anon, authenticated;

commit;
