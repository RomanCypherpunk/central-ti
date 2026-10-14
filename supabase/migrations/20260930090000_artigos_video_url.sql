-- Vídeo de procedimento: link (Vimeo ou YouTube, não listado) colado na tela
-- de nova solução e incorporado na Base e na triagem. Só guarda o link; o
-- vídeo fica hospedado fora. As policies de `artigos` já cobrem a coluna.

alter table public.artigos
  add column if not exists video_url text
    check (video_url is null or char_length(video_url) <= 300);
