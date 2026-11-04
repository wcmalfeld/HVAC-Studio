"use client";
import * as React from "react";
import { safeLocalStorage } from "@/lib/utils";

export type ThemePref = "light" | "dark" | "system";
const KEY = "hvac.theme";

interface ThemeCtx {
  pref: ThemePref;
  resolved: "light" | "dark";
  setPref: (p: ThemePref) => void;
}
const Ctx = React.createContext<ThemeCtx>({ pref: "light", resolved: "light", setPref: () => {} });

function systemDark() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [pref, setPrefState] = React.useState<ThemePref>("light");
  const [sys, setSys] = React.useState(false);

  React.useEffect(() => {
    const stored = safeLocalStorage()?.getItem(KEY) as ThemePref | null;
    if (stored === "light" || stored === "dark" || stored === "system") setPrefState(stored);
    setSys(!!systemDark());
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    const on = () => setSys(mq.matches);
    mq?.addEventListener("change", on);
    return () => mq?.removeEventListener("change", on);
  }, []);

  const resolved: "light" | "dark" = pref === "system" ? (sys ? "dark" : "light") : pref;

  React.useEffect(() => {
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);

  const setPref = React.useCallback((p: ThemePref) => {
    setPrefState(p);
    safeLocalStorage()?.setItem(KEY, p);
  }, []);

  return <Ctx.Provider value={{ pref, resolved, setPref }}>{children}</Ctx.Provider>;
}

export const useTheme = () => React.useContext(Ctx);

/** Inline script to set the theme before paint (no flash). */
export const themeInitScript = `(function(){try{var p=localStorage.getItem('${KEY}')||'light';var d=p==='dark'||(p==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light';}catch(e){document.documentElement.dataset.theme='light';}})();`;
