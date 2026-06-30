import { useQuery } from '@tanstack/react-query';

interface Config { stadiaApiKey: string; }

async function fetchConfig(): Promise<Config> {
  try {
    const res = await fetch('/api/config');
    if (!res.ok) return { stadiaApiKey: '' };
    return res.json() as Promise<Config>;
  } catch { return { stadiaApiKey: '' }; }
}

export function useConfig(): Config {
  const { data } = useQuery({
    queryKey: ['config'],
    queryFn: fetchConfig,
    staleTime: Infinity,
    gcTime: Infinity,
  });
  return data ?? { stadiaApiKey: '' };
}
