// Tema claro/escuro: classe `light` ou `dark` no <html>, persistida em localStorage.
// O script inline de __root aplica o tema antes da hidratação (sem flash).
export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "nina-theme";

export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t!=="light"&&t!=="dark")t="dark";var c=document.documentElement.classList;c.remove("light","dark");c.add(t);}catch(e){document.documentElement.classList.add("dark");}})();`;

export function getTheme(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.classList.contains("light") ? "light" : "dark";
}

export function applyTheme(theme: Theme): void {
  const c = document.documentElement.classList;
  c.remove("light", "dark");
  c.add(theme);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* modo privado: vale só nesta sessão */
  }
}
