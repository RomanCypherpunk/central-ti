-- Textos rápidos: respostas prontas que o analista insere no campo de
-- resposta em vez de digitar tudo de novo. Substitui a funcionalidade de
-- mesmo nome do Hipporello.
--
-- São compartilhados: a lista é uma só para toda a equipe, porque o ponto
-- é padronizar o que o usuário recebe. Quem cria e edita é a equipe de TI.

create table if not exists public.textos_rapidos (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  corpo text not null,
  ativo boolean not null default true,
  criado_por uuid references public.usuarios(id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

comment on table public.textos_rapidos is
  'Respostas prontas compartilhadas pela equipe de TI, inseridas no campo de resposta do chamado.';
comment on column public.textos_rapidos.titulo is
  'Como o texto aparece na lista de escolha (ex.: "FALTA DE INFORMAÇÕES").';
comment on column public.textos_rapidos.corpo is
  'O texto que vai para o campo de resposta, onde ainda pode ser editado antes de enviar.';
comment on column public.textos_rapidos.ativo is
  'Texto desativado some da lista sem perder o histórico de quem já usou.';

-- Busca por título e por corpo, como no Hipporello.
create index if not exists textos_rapidos_titulo_idx
  on public.textos_rapidos (lower(titulo));

alter table public.textos_rapidos enable row level security;

-- Diferente de filas/categorias, que qualquer autenticado lê: um texto
-- rápido é ferramenta interna de atendimento e não interessa ao
-- solicitante, então a leitura também é restrita à equipe.
create policy "textos_rapidos: leitura equipe TI"
  on public.textos_rapidos
  for select
  to authenticated
  using (is_equipe_ti());

create policy "textos_rapidos: escrita equipe TI"
  on public.textos_rapidos
  for all
  to authenticated
  using (is_equipe_ti())
  with check (is_equipe_ti());

-- `atualizado_em` sozinho mente: sem isto ficaria com a data da criação
-- para sempre.
create or replace function public.textos_rapidos_tocar()
returns trigger
language plpgsql
as $function$
begin
  new.atualizado_em := now();
  return new;
end;
$function$;

drop trigger if exists textos_rapidos_atualizado_em on public.textos_rapidos;

create trigger textos_rapidos_atualizado_em
  before update on public.textos_rapidos
  for each row
  execute function public.textos_rapidos_tocar();

-- Os textos que a equipe já usava no Hipporello, para a lista não nascer
-- vazia. Daqui em diante quem mantém é a própria equipe, pela tela.
insert into public.textos_rapidos (titulo, corpo)
values
  (
    'Resposta Inicial',
    'Olá, tudo bem?' || chr(10) || chr(10) ||
    'Estamos analisando e em breve daremos um retorno com a solução.'
  ),
  (
    'Falta de informações',
    'Olá, tudo bem?' || chr(10) || chr(10) ||
    'Sua solicitação será finalizada devido à ausência de informações ' ||
    'suficientes e de uma descrição detalhada do problema.' || chr(10) || chr(10) ||
    'Por favor, abra um novo chamado descrevendo o que aconteceu, em qual ' ||
    'sistema e, se possível, com um print da tela.'
  )
on conflict do nothing;
