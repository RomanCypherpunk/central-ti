-- Título do chamado aberto pela tela "Abrir chamado".
--
-- A tela manda o assunto digitado pela pessoa como título. A trigger antiga
-- só mexia quando o título vinha vazio, então o chamado ficava sem o
-- " | Ticket-N" que a equipe usa para achar o card no Portal — e o
-- solicitante não tem permissão de editar o chamado depois para completar.
--
-- Agora:
--   - sem título            -> "Categoria | Ticket-N" (como antes);
--   - título sem "Ticket-"  -> "Assunto | Ticket-N";
--   - título já com Ticket- -> não mexe (edição manual do Portal).
--
-- O número só existe depois da inserção (identity), por isso continua AFTER.

create or replace function public.preencher_titulo_chamado()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $function$
begin
  if new.titulo is null or btrim(new.titulo) = '' then
    update chamados
    set titulo = (select nome from categorias where id = new.categoria_id) || ' | Ticket-' || new.numero
    where id = new.id;
  elsif new.titulo !~* 'Ticket-[0-9]+' then
    update chamados
    set titulo = btrim(new.titulo) || ' | Ticket-' || new.numero
    where id = new.id;
  end if;

  return new;
end;
$function$;
