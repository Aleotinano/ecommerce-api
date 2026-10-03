// Origen: Cori e-commerce-nextjs:packages/shared/types/context.ts — RECORTADO para EditFlow.
// El original junta los contextos de la tienda (carrito, catálogo, chat, direcciones…);
// acá quedan solo los que usa el shell del panel. Los contextos de cada módulo de EditFlow
// se suman abajo, uno por módulo.
import type { ReactNode } from "react";
import type { UserData } from "./auth";

export interface AuthContextType {
  user: UserData | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  logout: () => Promise<void>;
  setUser: (user: UserData | null) => void;
}

export interface SidePanelContextType {
  content: ReactNode | null;
  isOpen: boolean;
  setSidePanelContent: (node: ReactNode | null) => void;
  clearSidePanelContent: () => void;
  open: () => void;
  close: () => void;
  toggle: () => void;
  /** El dueño del contenido inyectado registra acá su propio reset de selección/modo,
   *  para que un cierre gestual del riel (swipe, backdrop, chevron) igual lo dispare.
   *  `null` desregistra. */
  registerOnClose: (handler: (() => void) | null) => void;
}

export type UISettingsPanelView = "settings" | "notifications" | "custom";

/** Contenido inyectado en el panel de UI cuando `view === "custom"`. */
export interface UISettingsPanelCustomContent {
  node: ReactNode;
  label: string;
}

export interface UISettingsPanelContextType {
  isOpen: boolean;
  view: UISettingsPanelView;
  custom: UISettingsPanelCustomContent | null;
  open: (view?: UISettingsPanelView) => void;
  close: () => void;
  toggle: (view?: UISettingsPanelView) => void;
  openCustom: (node: ReactNode, label: string) => void;
  closeCustom: () => void;
}
