
export const COMPANY = "E-P:n Sähkötekniikka";
export const COPYRIGHT_YEAR = 2025;

export const REQUIRE_ACCESS = String(import.meta.env.VITE_REQUIRE_ACCESS || "true").toLowerCase() === "true";
export const PAYMENT_LINK_URL = String(import.meta.env.VITE_PAYMENT_LINK_URL || "");

const LS_KEY = "tuntihinta_access_key";

export function hasAccess(): boolean {
  if (!REQUIRE_ACCESS) return true;
  const k = localStorage.getItem(LS_KEY) || "";
  return !!k;
}
export function grantAccess(key: string) {
  localStorage.setItem(LS_KEY, key);
}
export function currentAccessKey(): string | null {
  return localStorage.getItem(LS_KEY);
}
export function revokeAccess() {
  localStorage.removeItem(LS_KEY);
}
