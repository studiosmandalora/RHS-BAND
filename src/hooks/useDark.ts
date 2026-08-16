import { useEffect, useState } from "react";

const KEY = "rhs-theme";

function initialDark(): boolean {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === "dark") return true;
    if (stored === "light") return false;
  } catch {
    /* ignore */
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function useDark(): [boolean, (v: boolean) => void] {
  const [dark, setDark] = useState<boolean>(initialDark);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    try {
      localStorage.setItem(KEY, dark ? "dark" : "light");
    } catch {
      /* ignore */
    }
  }, [dark]);

  return [dark, setDark];
}