// Configuração do Supabase.
// Console: supabase.com/dashboard > TI gasometro > Project Settings > API Keys
//
// Esta chave (anon/publishable) NÃO é segredo: ela identifica o projeto, não
// autoriza nada por si só. Quem protege os dados são as políticas de Row
// Level Security (RLS) configuradas nas tabelas e no bucket do Storage.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://pmwcfdxryjwsvwsmcufm.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_eyb7tOIsJ5DhKypU-PFZpA_xBSf99Lt";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
