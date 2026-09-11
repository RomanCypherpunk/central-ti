-- Titulo do chamado: nasce como "Categoria | Ticket-N" e depois vira texto
-- livre, editavel pelo Portal. Mudar a categoria nao reescreve o titulo —
-- senao uma edicao manual seria apagada sem aviso.

alter table chamados add column titulo text;

-- Chamados que ja existem recebem o titulo que o Portal mostrava ate agora.
update chamados c
set titulo = cat.nome || ' | Ticket-' || c.numero
from categorias cat
where cat.id = c.categoria_id and c.titulo is null;

-- Chamado novo sem titulo informado ganha o padrao. O numero e gerado na
-- propria insercao, entao isso precisa rodar depois (BEFORE nao veria o valor).
create or replace function public.preencher_titulo_chamado()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $function$
begin
  if new.titulo is null then
    update chamados
    set titulo = (select nome from categorias where id = new.categoria_id) || ' | Ticket-' || new.numero
    where id = new.id;
  end if;

  return new;
end;
$function$;

create trigger chamados_preencher_titulo
  after insert on chamados
  for each row
  execute function public.preencher_titulo_chamado();
