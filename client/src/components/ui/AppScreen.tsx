import type { ReactNode } from 'react';

interface AppScreenProps {
  children: ReactNode;
}

export default function AppScreen({ children }: AppScreenProps) {
  return <section className="dl-app-screen">{children}</section>;
}
