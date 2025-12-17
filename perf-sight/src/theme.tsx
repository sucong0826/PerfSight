import React from "react";

export type Theme = "light" | "dark";

const THEME_KEY = "perfsight.theme";

const applyThemeToDom = (theme: Theme) => {
  const root = document.documentElement;
  if (theme === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
  // Helps native controls follow theme (inputs, scrollbars on supported platforms).
  root.style.colorScheme = theme;
};

const getInitialTheme = (): Theme => {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === "light" || v === "dark") return v;
  } catch {
    // ignore
  }
  // Preserve current behavior (default dark) unless user explicitly switches.
  return "dark";
};

type ThemeCtx = {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
};

const ThemeContext = React.createContext<ThemeCtx | null>(null);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [theme, setThemeState] = React.useState<Theme>(() => {
    const t = getInitialTheme();
    // Apply immediately to avoid "toggle doesn't work" or initial flash when darkMode is class-based.
    if (typeof document !== "undefined") applyThemeToDom(t);
    return t;
  });

  React.useLayoutEffect(() => {
    // Use layout effect so DOM class updates before paint when toggling.
    applyThemeToDom(theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // ignore
    }
  }, [theme]);

  const setTheme = React.useCallback((t: Theme) => {
    setThemeState(t);
    // Best-effort immediate application even if effects are delayed.
    try {
      applyThemeToDom(t);
    } catch {
      // ignore
    }
  }, []);
  const toggleTheme = React.useCallback(
    () =>
      setThemeState((prev) => {
        const next = prev === "dark" ? "light" : "dark";
        try {
          applyThemeToDom(next);
        } catch {
          // ignore
        }
        return next;
      }),
    []
  );

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
};


