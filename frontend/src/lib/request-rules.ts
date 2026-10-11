/**
 * Regra de mesma origem para requisições que alteram dados. Sem dependências
 * de servidor para poder ser usada no proxy e testada isoladamente.
 */
export function isAllowedOrigin(origin: string | null, secFetchSite: string | null, allowed: string): boolean {
  if (origin) return origin === allowed;
  // Navegadores modernos sempre mandam Origin em POST; sem ele, só aceitamos
  // se o próprio navegador atestar que a requisição é da mesma origem.
  return secFetchSite === "same-origin";
}
