// Copie este arquivo para supabase-config.js (fora do git) e preencha com os
// valores reais do projeto Supabase.
// Console: supabase.com/dashboard > TI gasometro > Project Settings > API Keys
//
// Este projeto usa o novo sistema de API keys do Supabase: use a chave
// "Publishable key" (formato sb_publishable_...), não a legada anon (JWT).
// Ela NÃO é secreta: identifica o projeto, mas não autoriza nada por si só.
// Quem protege os dados são as políticas de Row Level Security (RLS)
// configuradas nas tabelas e no bucket do Storage.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://pmwcfdxryjwsvwsmcufm.supabase.co";
const SUPABASE_ANON_KEY = "";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
