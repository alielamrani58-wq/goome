import RideApp from '@/components/ride-app';
import { getPortal } from '@/lib/goome-server';

export const dynamic = 'force-dynamic';

export default function Home() { return <RideApp portal={getPortal()} />; }
