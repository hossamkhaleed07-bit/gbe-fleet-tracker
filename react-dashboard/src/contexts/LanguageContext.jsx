import { createContext, useContext, useEffect, useState } from "react";
import { translate } from "../lib/i18n";

const LanguageContext = createContext(null);
const STORAGE_KEY = "gbe-dashboard-lang";

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(() => localStorage.getItem(STORAGE_KEY) || "ar");

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  }, [lang]);

  function setLang(next) {
    localStorage.setItem(STORAGE_KEY, next);
    setLangState(next);
  }

  function toggleLang() {
    setLang(lang === "ar" ? "en" : "ar");
  }

  function t(key, vars) {
    return translate(lang, key, vars);
  }

  return (
    <LanguageContext.Provider value={{ lang, setLang, toggleLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLang() {
  return useContext(LanguageContext);
}
