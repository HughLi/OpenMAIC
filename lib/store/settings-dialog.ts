import { create } from 'zustand';
import type { SettingsSection } from '@/lib/types/settings';

interface SettingsDialogState {
  isOpen: boolean;
  section: SettingsSection | undefined;
  openDialog: (section?: SettingsSection) => void;
  closeDialog: () => void;
  setSection: (section?: SettingsSection) => void;
}

export const useSettingsDialogStore = create<SettingsDialogState>((set) => ({
  isOpen: false,
  section: undefined,
  openDialog: (section) => set({ isOpen: true, section }),
  closeDialog: () => set({ isOpen: false, section: undefined }),
  setSection: (section) => set({ section }),
}));
