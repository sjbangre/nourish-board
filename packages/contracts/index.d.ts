export type Nutrient = 'kcal' | 'protein' | 'carbs' | 'fat' | 'fiber';
export type Nutrients = Record<Nutrient, number>;
export interface Family { id: string; name: string }
export interface Couple { id: string; familyId: string; name: string }
export interface Profile { id: string; name: string; familyId: string; coupleId: string | null; sex: 'male' | 'female'; configured: boolean; age: number | ''; height: number | ''; weight: number | ''; goalWeight: number | ''; activity: number; deficit: number; proteinRate: number; wheyGrams: number; trainingDays: number; equipment: 'gym' | 'home'; experience: 'beginner' | 'intermediate'; favorites: string[]; excluded: string[]; needsReview: boolean }
export interface Food extends Nutrients { id: string; name: string; category: string; maxGrams: number; basis: string; source: string; sourceUrl?: string; provider?: string; license?: string; externalId?: string }
export interface Targets extends Nutrients { bmr: number; maintenance: number; deficit: number; bmi: number; floorApplied: boolean }
export interface Plan { profileId: string; createdAt: string; variation: number; target: Targets; actual: Nutrients; items: (Food & { grams: number })[]; gaps: { nutrient: Nutrient; delta: number; percent: number }[]; warnings: string[]; needsAdjustment: boolean }
export interface WeightLog { id: string; profile_id: string; day: string; weight: number; note: string }
export interface AppState { families: Family[]; couples: Couple[]; profiles: Profile[]; foods: Food[]; plans: Plan[]; logs: WeightLog[] }
export interface User { id: string; email: string; name: string; role: 'admin' | 'member'; status: 'active' | 'pending' | 'revoked' }
export interface SessionInfo { user: User | null; googleConfigured: boolean; localDevelopment: boolean; adminEmail: string }
export interface LookupFood extends Omit<Food, 'id' | 'maxGrams' | Nutrient> { externalId: string; kcal: number | null; protein: number | null; carbs: number | null; fat: number | null; fiber: number | null; missing: Nutrient[] }
export interface LookupResult { results: LookupFood[]; notice: string; searchedFor: string; cached: boolean; demoKey: boolean }
export interface WorkoutDay { day: string; type: string; title: string; detail: string; exercises: { name: string; dose: string }[] }
export interface Invitation { id: string; email: string; familyId: string; createdAt: string; status: string }
export interface AccessData { users: User[]; invitations: Invitation[]; memberships: { userId: string; familyId: string }[] }
