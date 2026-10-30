import { createContext, useContext } from "react";

export const MeContext = createContext(null);

export function useMe() {
  const me = useContext(MeContext);
  const can = (perm) => !!me && (me.perms.includes("*") || me.perms.includes(perm));
  return { me, can, staff: can("staff") };
}
