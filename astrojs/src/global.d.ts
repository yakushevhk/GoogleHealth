export {};

declare global {
  interface Window {
    /** Global hook for opening the entry modal (set in QuickWriteModal.astro). */
    openQuickWriteModal?: (defaultTab?: string) => void;
  }
}
