import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface CampaignState {
  /** Which campaign folder ask_dm should point `claude` at. Persisted so the
   *  DM doesn't have to reselect it every game night. */
  activeCampaignId: string | null;
  setActiveCampaignId: (id: string | null) => void;
}

export const useCampaignStore = create<CampaignState>()(
  persist(
    (set) => ({
      activeCampaignId: null,
      setActiveCampaignId: (id) => set({ activeCampaignId: id }),
    }),
    { name: 'tavern-sheet-campaign' }
  )
);
