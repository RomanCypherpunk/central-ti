import { supabase } from "./config/supabase-config.js";

const { data: { session } } = await supabase.auth.getSession();

if (!session) {
  window.location.href = "login.html";
} else {
  document.body.style.visibility = "visible";
}

supabase.auth.onAuthStateChange((_event, novaSessao) => {
  if (!novaSessao) {
    window.location.href = "login.html";
  }
});
