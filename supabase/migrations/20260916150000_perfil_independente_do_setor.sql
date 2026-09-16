-- ============================================================================
-- PERFIL DEIXA DE SER AMARRADO AO SETOR
--
-- sincronizar_setor_perfil() reescrevia o perfil a cada update com base no
-- setor: quem entrasse no setor "Administrador" virava admin, e um admin que
-- mudasse de setor era rebaixado a solicitante — silenciosamente, porque o
-- trigger e BEFORE UPDATE e altera NEW sem avisar ninguem.
--
-- Isso fazia sentido quando so existiam solicitante e admin (o setor era um
-- atalho para dizer "essa pessoa e do TI"). Com quatro perfis a regra passa a
-- atrapalhar: o admin escolhe o perfil na tela de Contatos, e o setor volta a
-- ser o que o nome diz — informacao organizacional, nao permissao.
--
-- Alem disso o trigger rodava DEPOIS de protege_perfil_usuario (ordem
-- alfabetica: protege_perfil < sincronizar_setor_perfil), entao tinha a
-- palavra final e podia desfazer a decisao de quem tinha permissao para
-- decidir.
--
-- Os 5 admins de hoje estao todos no setor "Administrador": remover o trigger
-- nao muda nenhum perfil existente, so para de reescrever daqui pra frente.
-- ============================================================================

drop trigger if exists usuarios_sincronizar_setor_perfil on public.usuarios;
drop function if exists public.sincronizar_setor_perfil();

-- bloquear_autoaprovacao() cobria perfil/status_aprovacao/setor_id exigindo
-- is_equipe_ti(). A parte de perfil e status agora esta em
-- protege_perfil_usuario(), que e mais restrito (perfil so admin) e mais
-- preciso (equipe nao aprova a si mesma). Reescrito para cuidar apenas do
-- setor_id, sem sobrepor a outra regra.
create or replace function public.bloquear_autoaprovacao()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.setor_id is distinct from old.setor_id and not is_equipe_ti() then
    raise exception 'Somente a equipe de TI pode alterar o setor'
      using errcode = '42501';
  end if;

  return new;
end;
$$;
