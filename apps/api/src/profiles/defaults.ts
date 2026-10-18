import type { Profile } from '@nourish/contracts';
import { defaultPreferences } from '../nutrition/engine';

/** Each new profile gets its own mutable preferences and empty measurements. */
export function newProfile(
  identity: Pick<Profile, 'id' | 'name' | 'sex' | 'familyId' | 'coupleId'>,
): Profile {
  return {
    ...identity,
    configured: false,
    age: '',
    height: '',
    weight: '',
    goalWeight: '',
    activity: 1.375,
    deficit: 15,
    proteinRate: 1.6,
    wheyGrams: 0,
    trainingDays: 3,
    equipment: 'gym',
    experience: 'beginner',
    favorites: [...defaultPreferences],
    excluded: [],
    needsReview: false,
  };
}
