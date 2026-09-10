-- A tela de cadastro precisa listar setores e unidades antes do usuário
-- ter sessão (é o próprio formulário de signUp). As policies existentes só
-- liberam SELECT para "authenticated", então o cadastro via cliente anônimo
-- recebia lista vazia. São dados públicos (só nome), sem risco em liberar
-- para "anon".

create policy "setores: leitura anônima"
  on public.setores
  for select
  to anon
  using (ativo = true);

create policy "unidades: leitura anônima"
  on public.unidades
  for select
  to anon
  using (ativo = true);
