import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { applyTheme, getTheme, type Theme } from "@/lib/theme";

export function ThemeToggle() {
  // Começa "dark" no SSR; sincroniza com a classe real após montar.
  const [theme, setTheme] = useState<Theme>("dark");
  useEffect(() => setTheme(getTheme()), []);

  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    applyTheme(next);
    setTheme(next);
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      title={theme === "dark" ? "Modo claro" : "Modo escuro"}
      aria-label="Alternar tema"
    >
      {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}
