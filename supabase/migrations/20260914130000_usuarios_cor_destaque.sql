-- Cor de destaque de cada membro da equipe: o anel em volta da foto no
-- rodapé do card do Portal e nos membros do detalhe do chamado.
--
-- É por pessoa, não por chamado: o analista tem uma cor só, para ser
-- reconhecido de relance no quadro inteiro. Quem troca é a equipe de TI,
-- pelo próprio detalhe do chamado — a policy de update de `usuarios` para a
-- equipe já cobre isso.
--
-- Nulo = sem anel.

alter table public.usuarios
  add column if not exists cor_destaque text
    check (cor_destaque ~ '^#[0-9a-fA-F]{6}$');

comment on column public.usuarios.cor_destaque is
  'Cor (hex #rrggbb) do anel em volta da foto no Portal. Nulo: sem anel.';
