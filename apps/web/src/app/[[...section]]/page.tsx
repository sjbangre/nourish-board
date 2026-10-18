import { notFound } from 'next/navigation';
import { Dashboard } from '@/components/dashboard';
export default async function Page({ params, searchParams }: { params: Promise<{ section?: string[] }>; searchParams: Promise<{ authError?: string }> }) {
  const { section = [] } = await params;
  if (section.length > 1 || !['', 'family', 'profile', 'foods', 'planner', 'training', 'progress', 'shopping', 'admin'].includes(section[0] || '')) notFound();
  const query = await searchParams;
  return <Dashboard section={section[0] || ''} authError={Boolean(query.authError)}/>;
}
